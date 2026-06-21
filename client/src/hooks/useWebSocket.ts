import { useState, useEffect, useCallback, useRef } from 'react';
import type { Operation, WSMessage, NodeSnapshot } from '../../../shared/types';
import { MindMapCRDT } from '../../../shared/crdt';

interface UseWebSocketOptions {
  branchId: string;
  userId: string;
}

export function useWebSocket({ branchId, userId }: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [crdt, setCRDT] = useState<MindMapCRDT | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const crdtRef = useRef<MindMapCRDT | null>(null);
  const versionRef = useRef<number>(0);
  const pendingOpsRef = useRef<Operation[]>([]);
  const confirmedOpIdsRef = useRef<Set<string>>(new Set());
  const isReconnectingRef = useRef(false);

  const applyOperation = useCallback((op: Operation): boolean => {
    if (!crdtRef.current) return false;
    if (crdtRef.current.hasApplied(op.id)) return false;

    const newNodes = crdtRef.current.getNodes();
    const newCRDT = new MindMapCRDT(newNodes);
    for (const pendingOp of pendingOpsRef.current) {
      newCRDT.applyOperation(pendingOp);
    }
    newCRDT.applyOperation(op);
    crdtRef.current = newCRDT;
    return true;
  }, []);

  const syncCRDTState = useCallback(() => {
    if (crdtRef.current) {
      setCRDT(new MindMapCRDT(crdtRef.current.getNodes()));
    }
    setVersion(versionRef.current);
  }, []);

  const flushPendingOps = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (pendingOpsRef.current.length === 0) return;

    const opsToSend = [...pendingOpsRef.current];
    for (const op of opsToSend) {
      if (!confirmedOpIdsRef.current.has(op.id)) {
        wsRef.current.send(
          JSON.stringify({
            type: 'operation',
            payload: { operation: op },
          } as WSMessage)
        );
      }
    }
  }, []);

  const handleMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case 'join': {
        if (message.payload.clientId) {
          setClientId(message.payload.clientId);
        }
        if (message.payload.snapshot) {
          const snapshot = message.payload.snapshot as NodeSnapshot;
          const serverOps = message.payload.operations || [];

          const newCRDT = new MindMapCRDT(snapshot.nodes);
          for (const op of serverOps) {
            newCRDT.applyOperation(op);
            confirmedOpIdsRef.current.add(op.id);
          }

          const unconfirmedOps = pendingOpsRef.current.filter(
            (op) => !confirmedOpIdsRef.current.has(op.id)
          );
          for (const op of unconfirmedOps) {
            newCRDT.applyOperation(op);
          }

          crdtRef.current = newCRDT;
          versionRef.current = snapshot.version;

          pendingOpsRef.current = unconfirmedOps;

          syncCRDTState();

          if (isReconnectingRef.current && unconfirmedOps.length > 0) {
            setTimeout(() => flushPendingOps(), 100);
          }
          isReconnectingRef.current = false;
        }
        break;
      }
      case 'operation': {
        const { operation, version: newVersion, confirmed } = message.payload;

        if (confirmed) {
          confirmedOpIdsRef.current.add(operation.id);
          pendingOpsRef.current = pendingOpsRef.current.filter(
            (op) => op.id !== operation.id
          );
        }

        applyOperation(operation);

        if (newVersion !== undefined) {
          versionRef.current = newVersion;
        }

        syncCRDTState();
        break;
      }
      case 'snapshot': {
        const { nodes, version: newVersion } = message.payload;

        const newCRDT = new MindMapCRDT(nodes);
        const unconfirmedOps = pendingOpsRef.current.filter(
          (op) => !confirmedOpIdsRef.current.has(op.id)
        );
        for (const op of unconfirmedOps) {
          newCRDT.applyOperation(op);
        }

        crdtRef.current = newCRDT;
        versionRef.current = newVersion;
        pendingOpsRef.current = unconfirmedOps;

        syncCRDTState();

        if (unconfirmedOps.length > 0) {
          setTimeout(() => flushPendingOps(), 100);
        }
        break;
      }
      case 'error': {
        console.error('Server error:', message.payload);
        break;
      }
    }
  }, [applyOperation, syncCRDTState, flushPendingOps]);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const wsUrl = `${protocol}//${host}:3001/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      isReconnectingRef.current = crdtRef.current !== null;
      ws.send(
        JSON.stringify({
          type: 'join',
          payload: { branchId, userId },
        } as WSMessage)
      );
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, will reconnect...');
      setIsConnected(false);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;
        handleMessage(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };
  }, [branchId, userId, handleMessage]);

  const sendOperation = useCallback(
    (operation: Operation): boolean => {
      if (!crdtRef.current) {
        console.warn('CRDT not initialized');
        return false;
      }

      if (crdtRef.current.hasApplied(operation.id)) {
        return false;
      }

      applyOperation(operation);

      pendingOpsRef.current.push(operation);

      syncCRDTState();

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'operation',
            payload: { operation },
          } as WSMessage)
        );
      } else {
        console.warn('WebSocket not connected, operation queued');
      }

      return true;
    },
    [applyOperation, syncCRDTState]
  );

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return {
    isConnected,
    clientId,
    crdt,
    version,
    operations: pendingOpsRef.current,
    sendOperation,
  };
}
