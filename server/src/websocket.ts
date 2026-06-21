import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { Operation, WSMessage, MindMapNode } from '../../shared/types';
import { MindMapCRDT, mergeBranches, resolveConflict } from '../../shared/crdt';
import {
  getSnapshot,
  saveOperation,
  saveSnapshot,
  getOperations,
  getLatestVersion,
  createBranch,
  getBranches,
  getBranch,
  createMergeRequest,
  getMergeRequests,
  updateMergeRequestStatus,
  markBranchMerged,
} from './database';

interface Client {
  ws: WebSocket;
  clientId: string;
  branchId: string;
  userId: string;
}

interface BranchState {
  crdt: MindMapCRDT;
  version: number;
  clients: Set<string>;
}

const clients = new Map<string, Client>();
const branchStates = new Map<string, BranchState>();

function getOrCreateBranchState(branchId: string): BranchState {
  let state = branchStates.get(branchId);
  if (!state) {
    const snapshot = getSnapshot(branchId);
    const crdt = new MindMapCRDT(snapshot?.nodes || {});
    state = {
      crdt,
      version: snapshot?.version || 0,
      clients: new Set(),
    };
    branchStates.set(branchId, state);
  }
  return state;
}

function broadcastToBranch(branchId: string, message: WSMessage, excludeClientId?: string): void {
  const state = branchStates.get(branchId);
  if (!state) return;
  for (const clientId of state.clients) {
    if (clientId === excludeClientId) continue;
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }
}

function handleJoin(ws: WebSocket, payload: { branchId: string; userId: string }): void {
  console.log('Join request:', payload);
  const clientId = uuidv4();
  const { branchId, userId } = payload;

  const client: Client = { ws, clientId, branchId, userId };
  clients.set(clientId, client);

  const state = getOrCreateBranchState(branchId);
  state.clients.add(clientId);

  const snapshot = getSnapshot(branchId);
  const operations = getOperations(branchId);

  ws.send(
    JSON.stringify({
      type: 'join',
      payload: {
        clientId,
        branchId,
        snapshot,
        operations,
      },
    } as WSMessage)
  );

  broadcastToBranch(branchId, {
    type: 'join',
    payload: { clientId, userId, message: `${userId} joined the branch` },
  });
}

function handleOperation(client: Client, payload: { operation: Operation }): void {
  const { operation } = payload;
  const state = getOrCreateBranchState(client.branchId);

  if (state.crdt.hasApplied(operation.id)) {
    return;
  }

  const applied = state.crdt.applyOperation(operation);
  if (!applied) return;

  const newVersion = saveSnapshot(client.branchId, state.crdt.getNodes());
  state.version = newVersion;

  saveOperation(operation, newVersion);

  broadcastToBranch(
    client.branchId,
    {
      type: 'operation',
      payload: { operation, version: newVersion },
    },
    client.clientId
  );

  client.ws.send(
    JSON.stringify({
      type: 'operation',
      payload: { operation, version: newVersion, confirmed: true },
    })
  );
}

function handleLeave(client: Client): void {
  const state = branchStates.get(client.branchId);
  if (state) {
    state.clients.delete(client.clientId);
    if (state.clients.size === 0) {
      branchStates.delete(client.branchId);
    }
  }

  broadcastToBranch(client.branchId, {
    type: 'leave',
    payload: { clientId: client.clientId, userId: client.userId, message: `${client.userId} left` },
  });

  clients.delete(client.clientId);
}

export function createWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (ws, request) => {
    console.log('New WebSocket connection from:', request.socket.remoteAddress);
    let currentClient: Client | null = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;

        if (message.type === 'join') {
          handleJoin(ws, message.payload);
          currentClient = clients.get(message.payload.clientId) || null;
          if (!currentClient) {
            const clientEntry = Array.from(clients.values()).find((c) => c.ws === ws);
            if (clientEntry) {
              currentClient = clientEntry;
            }
          }
        } else if (currentClient && message.type === 'operation') {
          handleOperation(currentClient, message.payload);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid message format' },
          })
        );
      }
    });

    ws.on('close', () => {
      if (currentClient) {
        handleLeave(currentClient);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
}

export function handleCreateBranch(
  name: string,
  parentBranchId: string,
  parentSnapshotVersion: number,
  createdBy: string
) {
  return createBranch(name, parentBranchId, parentSnapshotVersion, createdBy);
}

export function handleGetBranches() {
  return getBranches();
}

export function handleGetBranchHistory(branchId: string) {
  const branch = getBranch(branchId);
  if (!branch) throw new Error('Branch not found');
  const operations = getOperations(branchId);
  const snapshot = getSnapshot(branchId);
  return { branch, operations, snapshot };
}

export function handleCreateMergeRequest(
  sourceBranchId: string,
  targetBranchId: string,
  author: string
) {
  const sourceBranch = getBranch(sourceBranchId);
  const targetBranch = getBranch(targetBranchId);
  if (!sourceBranch || !targetBranch) {
    throw new Error('Branch not found');
  }

  const baseSnapshot = getSnapshot(sourceBranch.parentBranchId!, sourceBranch.parentSnapshotVersion);
  if (!baseSnapshot) {
    throw new Error('Base snapshot not found');
  }

  const sourceOps = getOperations(sourceBranchId, 0);
  const targetOps = getOperations(targetBranchId, sourceBranch.parentSnapshotVersion);

  const { conflicts } = mergeBranches(baseSnapshot.nodes, sourceOps, targetOps);

  return createMergeRequest(sourceBranchId, targetBranchId, author, conflicts);
}

export function handleGetMergeRequests() {
  return getMergeRequests();
}

export function handleResolveMergeConflict(
  mergeRequestId: string,
  nodeId: string,
  resolution: 'source' | 'target'
) {
  const mrs = getMergeRequests();
  const mr = mrs.find((m) => m.id === mergeRequestId);
  if (!mr) throw new Error('Merge request not found');
  if (!mr.conflicts) throw new Error('No conflicts to resolve');

  const conflictIndex = mr.conflicts.findIndex((c) => c.nodeId === nodeId);
  if (conflictIndex === -1) throw new Error('Conflict not found');

  const targetSnapshot = getSnapshot(mr.targetBranchId);
  if (!targetSnapshot) throw new Error('Target snapshot not found');

  const conflict = mr.conflicts[conflictIndex];
  const resolvedNodes = resolveConflict(targetSnapshot.nodes, conflict, resolution);

  const newVersion = saveSnapshot(mr.targetBranchId, resolvedNodes);

  mr.conflicts[conflictIndex] = { ...conflict, resolution };

  const allResolved = mr.conflicts.every((c) => c.resolution !== undefined);
  const newStatus = allResolved ? ('pending' as const) : ('conflict' as const);

  updateMergeRequestStatus(mergeRequestId, newStatus, mr.conflicts);

  const targetState = branchStates.get(mr.targetBranchId);
  if (targetState) {
    targetState.crdt = new MindMapCRDT(resolvedNodes);
    targetState.version = newVersion;
    broadcastToBranch(mr.targetBranchId, {
      type: 'snapshot',
      payload: { nodes: resolvedNodes, version: newVersion },
    });
  }

  return { mr, allResolved };
}

export function handleMergeRequest(mergeRequestId: string) {
  const mrs = getMergeRequests();
  const mr = mrs.find((m) => m.id === mergeRequestId);
  if (!mr) throw new Error('Merge request not found');
  if (mr.status === 'conflict' && mr.conflicts?.some((c) => !c.resolution)) {
    throw new Error('Please resolve all conflicts first');
  }

  const sourceBranch = getBranch(mr.sourceBranchId);
  const targetBranch = getBranch(mr.targetBranchId);
  if (!sourceBranch || !targetBranch) {
    throw new Error('Branch not found');
  }

  const baseSnapshot = getSnapshot(sourceBranch.parentBranchId!, sourceBranch.parentSnapshotVersion);
  if (!baseSnapshot) throw new Error('Base snapshot not found');

  const sourceOps = getOperations(mr.sourceBranchId, 0);
  const targetOps = getOperations(mr.targetBranchId, sourceBranch.parentSnapshotVersion);

  let { mergedNodes } = mergeBranches(baseSnapshot.nodes, sourceOps, targetOps);

  if (mr.conflicts) {
    for (const conflict of mr.conflicts) {
      if (conflict.resolution) {
        mergedNodes = resolveConflict(mergedNodes, conflict, conflict.resolution);
      }
    }
  }

  const newVersion = saveSnapshot(mr.targetBranchId, mergedNodes);

  const sourceState = branchStates.get(mr.sourceBranchId);
  if (sourceState) {
    sourceState.crdt = new MindMapCRDT(mergedNodes);
    sourceState.version = newVersion;
    broadcastToBranch(mr.sourceBranchId, {
      type: 'snapshot',
      payload: { nodes: mergedNodes, version: newVersion },
    });
  }

  const targetState = branchStates.get(mr.targetBranchId);
  if (targetState) {
    targetState.crdt = new MindMapCRDT(mergedNodes);
    targetState.version = newVersion;
    broadcastToBranch(mr.targetBranchId, {
      type: 'snapshot',
      payload: { nodes: mergedNodes, version: newVersion },
    });
  }

  updateMergeRequestStatus(mergeRequestId, 'merged');
  markBranchMerged(mr.sourceBranchId);

  return { merged: true, version: newVersion };
}
