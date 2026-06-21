export interface MindMapNode {
  id: string;
  parentId: string | null;
  text: string;
  x: number;
  y: number;
  collapsed: boolean;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface NodeSnapshot {
  nodes: Record<string, MindMapNode>;
  version: number;
  timestamp: number;
}

export type OperationType = 'add' | 'update' | 'delete' | 'move' | 'collapse' | 'uncollapse';

export interface BaseOperation {
  id: string;
  type: OperationType;
  nodeId: string;
  timestamp: number;
  author: string;
  branchId: string;
  lamport: number;
}

export interface AddOperation extends BaseOperation {
  type: 'add';
  node: MindMapNode;
}

export interface UpdateOperation extends BaseOperation {
  type: 'update';
  changes: Partial<Pick<MindMapNode, 'text' | 'color'>>;
  oldValue: Partial<Pick<MindMapNode, 'text' | 'color'>>;
}

export interface DeleteOperation extends BaseOperation {
  type: 'delete';
  node: MindMapNode;
}

export interface MoveOperation extends BaseOperation {
  type: 'move';
  oldParentId: string | null;
  newParentId: string | null;
  oldX: number;
  oldY: number;
  newX: number;
  newY: number;
}

export interface CollapseOperation extends BaseOperation {
  type: 'collapse' | 'uncollapse';
}

export type Operation = AddOperation | UpdateOperation | DeleteOperation | MoveOperation | CollapseOperation;

export interface Branch {
  id: string;
  name: string;
  parentBranchId: string | null;
  parentSnapshotVersion: number;
  createdAt: number;
  createdBy: string;
  isMain: boolean;
  merged: boolean;
}

export interface MergeRequest {
  id: string;
  sourceBranchId: string;
  targetBranchId: string;
  author: string;
  status: 'pending' | 'merged' | 'conflict' | 'closed';
  createdAt: number;
  conflicts?: MergeConflict[];
}

export interface MergeConflict {
  nodeId: string;
  sourceChange: Operation;
  targetChange: Operation;
  resolution?: 'source' | 'target';
}

export interface WSMessage {
  type: 'join' | 'leave' | 'operation' | 'snapshot' | 'history' | 'branches' | 'error';
  payload: any;
  clientId?: string;
}
