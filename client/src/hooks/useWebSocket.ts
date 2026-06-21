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
  const [crdt, setCRDT] = useState<MindMapCRDT | null>(null);
  const [version, setVersion] = useState(0);
  const [operations, setOperations] = useState<Operation[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const wsUrl = `${protocol}//${host}:3001/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(
        JSON.stringify({
          type: 'join',
          payload: { branchId, userId },
        } as WSMessage)
      );
    };

    ws.onclose = () => {
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
  }, [branchId, userId]);

  const handleMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case 'join': {
        if (message.payload.clientId) {
          setClientId(message.payload.clientId);
          if (message.payload.snapshot) {
            const snapshot = message.payload.snapshot as NodeSnapshot;
            const newCRDT = new MindMapCRDT(snapshot.nodes);
            for (const op of message.payload.operations || []) {
              newCRDT.applyOperation(op);
            }
            setCRDT(newCRDT);
            setVersion(snapshot.version);
            setOperations(message.payload.operations || []);
          }
        }
        break;
      }
      case 'operation': {
        const { operation, version: newVersion } = message.payload;
        setOperations((prev) => {
          if (prev.some((op) => op.id === operation.id)) {
            return prev;
          }
          return [...prev, operation];
        });
        setCRDT((prev) => {
          if (!prev) return prev;
          const newCRDT = new MindMapCRDT(prev.getNodes());
          for (const op of operations) {
            newCRDT.applyOperation(op);
          }
          newCRDT.applyOperation(operation);
          return newCRDT;
        });
        setVersion(newVersion);
        break;
      }
      case 'snapshot': {
        const { nodes, version: newVersion } = message.payload;
        const newCRDT = new MindMapCRDT(nodes);
        setCRDT(newCRDT);
        setVersion(newVersion);
        break;
      }
      case 'error': {
        console.error('Server error:', message.payload);
        break;
      }
    }
  }, [operations]);

  const sendOperation = useCallback(
    (operation: Operation) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('WebSocket not connected');
        return false;
      }
      setOperations((prev) => {
        if (prev.some((op) => op.id === operation.id)) {
          return prev;
        }
        return [...prev, operation];
      });
      setCRDT((prev) => {
        if (!prev) return prev;
        const newCRDT = new MindMapCRDT(prev.getNodes());
        for (const op of operations) {
          newCRDT.applyOperation(op);
        }
        newCRDT.applyOperation(operation);
        return newCRDT;
      });
      wsRef.current.send(
        JSON.stringify({
          type: 'operation',
          payload: { operation },
        } as WSMessage)
      );
      return true;
    },
    [operations]
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
    operations,
    sendOperation,
  };
}
