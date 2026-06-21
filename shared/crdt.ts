import type { MindMapNode, Operation, AddOperation, UpdateOperation, DeleteOperation, MoveOperation, CollapseOperation, MergeConflict } from './types';

export class MindMapCRDT {
  private nodes: Record<string, MindMapNode> = {};
  private lamportClock: number = 0;
  private appliedOperations: Set<string> = new Set();

  constructor(initialNodes: Record<string, MindMapNode> = {}) {
    this.nodes = { ...initialNodes };
    this.lamportClock = this.calculateInitialLamport();
  }

  private calculateInitialLamport(): number {
    let max = 0;
    for (const node of Object.values(this.nodes)) {
      max = Math.max(max, node.createdAt, node.updatedAt);
    }
    return max;
  }

  getNodes(): Record<string, MindMapNode> {
    return { ...this.nodes };
  }

  getNode(id: string): MindMapNode | null {
    return this.nodes[id] || null;
  }

  getLamportClock(): number {
    return this.lamportClock;
  }

  tick(receivedLamport?: number): number {
    if (receivedLamport !== undefined) {
      this.lamportClock = Math.max(this.lamportClock, receivedLamport) + 1;
    } else {
      this.lamportClock++;
    }
    return this.lamportClock;
  }

  hasApplied(opId: string): boolean {
    return this.appliedOperations.has(opId);
  }

  applyOperation(op: Operation): boolean {
    if (this.hasApplied(op.id)) {
      return false;
    }

    this.tick(op.lamport);
    this.appliedOperations.add(op.id);

    switch (op.type) {
      case 'add':
        this.applyAdd(op);
        break;
      case 'update':
        this.applyUpdate(op);
        break;
      case 'delete':
        this.applyDelete(op);
        break;
      case 'move':
        this.applyMove(op);
        break;
      case 'collapse':
      case 'uncollapse':
        this.applyCollapse(op);
        break;
    }

    return true;
  }

  private applyAdd(op: AddOperation): void {
    if (!this.nodes[op.node.id]) {
      this.nodes[op.node.id] = { ...op.node };
    } else {
      if (op.lamport > this.nodes[op.node.id].updatedAt) {
        this.nodes[op.node.id] = { ...op.node };
      }
    }
  }

  private applyUpdate(op: UpdateOperation): void {
    const node = this.nodes[op.nodeId];
    if (!node) return;

    if (op.lamport >= node.updatedAt) {
      this.nodes[op.nodeId] = {
        ...node,
        ...op.changes,
        updatedAt: Math.max(node.updatedAt, op.timestamp),
      };
    }
  }

  private applyDelete(op: DeleteOperation): void {
    const node = this.nodes[op.nodeId];
    if (!node) return;

    if (op.lamport >= node.updatedAt) {
      const descendants = this.getDescendants(op.nodeId);
      for (const descId of descendants) {
        delete this.nodes[descId];
      }
      delete this.nodes[op.nodeId];
    }
  }

  private applyMove(op: MoveOperation): void {
    const node = this.nodes[op.nodeId];
    if (!node) return;

    if (op.lamport >= node.updatedAt) {
      if (op.newParentId && this.wouldCreateCycle(op.nodeId, op.newParentId)) {
        return;
      }

      this.nodes[op.nodeId] = {
        ...node,
        parentId: op.newParentId,
        x: op.newX,
        y: op.newY,
        updatedAt: Math.max(node.updatedAt, op.timestamp),
      };
    }
  }

  private applyCollapse(op: CollapseOperation): void {
    const node = this.nodes[op.nodeId];
    if (!node) return;

    if (op.lamport >= node.updatedAt) {
      this.nodes[op.nodeId] = {
        ...node,
        collapsed: op.type === 'collapse',
        updatedAt: Math.max(node.updatedAt, op.timestamp),
      };
    }
  }

  private getDescendants(nodeId: string): string[] {
    const descendants: string[] = [];
    const stack = [nodeId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const [id, node] of Object.entries(this.nodes)) {
        if (node.parentId === current) {
          descendants.push(id);
          stack.push(id);
        }
      }
    }
    return descendants;
  }

  private wouldCreateCycle(nodeId: string, newParentId: string): boolean {
    let current: string | null = newParentId;
    while (current !== null) {
      if (current === nodeId) return true;
      current = this.nodes[current]?.parentId || null;
    }
    return false;
  }

  getChildren(parentId: string | null): MindMapNode[] {
    return Object.values(this.nodes)
      .filter(node => node.parentId === parentId)
      .sort((a, b) => a.y - b.y);
  }

  getRootNode(): MindMapNode | null {
    const roots = Object.values(this.nodes).filter(n => n.parentId === null);
    return roots[0] || null;
  }
}

export function mergeBranches(
  baseNodes: Record<string, MindMapNode>,
  sourceOps: Operation[],
  targetOps: Operation[]
): {
  mergedNodes: Record<string, MindMapNode>;
  conflicts: MergeConflict[];
} {
  const sourceCRDT = new MindMapCRDT(baseNodes);
  for (const op of sourceOps) {
    sourceCRDT.applyOperation(op);
  }

  const targetCRDT = new MindMapCRDT(baseNodes);
  for (const op of targetOps) {
    targetCRDT.applyOperation(op);
  }

  const sourceNodes = sourceCRDT.getNodes();
  const targetNodes = targetCRDT.getNodes();

  const sourceDeletedNodes = getDeletedNodes(baseNodes, sourceNodes, sourceOps);
  const targetDeletedNodes = getDeletedNodes(baseNodes, targetNodes, targetOps);

  const sourceOpsByNode = groupOpsByNode(sourceOps);
  const targetOpsByNode = groupOpsByNode(targetOps);

  const conflicts: MergeConflict[] = [];
  let mergedNodes: Record<string, MindMapNode> = { ...baseNodes };

  const allNodeIds = new Set([
    ...Object.keys(sourceNodes),
    ...Object.keys(targetNodes),
    ...Object.keys(baseNodes),
    ...sourceDeletedNodes.keys(),
    ...targetDeletedNodes.keys(),
  ]);

  for (const nodeId of allNodeIds) {
    const inBase = nodeId in baseNodes;
    const inSource = nodeId in sourceNodes;
    const inTarget = nodeId in targetNodes;
    const sourceDeleted = sourceDeletedNodes.has(nodeId);
    const targetDeleted = targetDeletedNodes.has(nodeId);

    if (sourceDeleted && targetDeleted) {
      delete mergedNodes[nodeId];
      continue;
    }

    if (sourceDeleted && !targetDeleted) {
      const sourceDeleteOp = sourceDeletedNodes.get(nodeId);
      const targetLastOp = findLastOpForNode(targetOpsByNode[nodeId] || []);
      if (targetLastOp && sourceDeleteOp) {
        if (targetLastOp.lamport > sourceDeleteOp.lamport) {
          if (inTarget) {
            mergedNodes[nodeId] = targetNodes[nodeId];
          }
          conflicts.push({
            nodeId,
            sourceChange: sourceDeleteOp,
            targetChange: targetLastOp,
          });
        } else {
          delete mergedNodes[nodeId];
        }
      } else if (sourceDeleteOp) {
        delete mergedNodes[nodeId];
      }
      continue;
    }

    if (!sourceDeleted && targetDeleted) {
      const targetDeleteOp = targetDeletedNodes.get(nodeId);
      const sourceLastOp = findLastOpForNode(sourceOpsByNode[nodeId] || []);
      if (sourceLastOp && targetDeleteOp) {
        if (sourceLastOp.lamport > targetDeleteOp.lamport) {
          if (inSource) {
            mergedNodes[nodeId] = sourceNodes[nodeId];
          }
          conflicts.push({
            nodeId,
            sourceChange: sourceLastOp,
            targetChange: targetDeleteOp,
          });
        } else {
          delete mergedNodes[nodeId];
        }
      } else if (targetDeleteOp) {
        delete mergedNodes[nodeId];
      }
      continue;
    }

    if (!inBase && inSource && !inTarget) {
      mergedNodes[nodeId] = sourceNodes[nodeId];
    } else if (!inBase && !inSource && inTarget) {
      mergedNodes[nodeId] = targetNodes[nodeId];
    } else if (!inBase && inSource && inTarget) {
      if (nodesEqual(sourceNodes[nodeId], targetNodes[nodeId])) {
        mergedNodes[nodeId] = sourceNodes[nodeId];
      } else {
        const sourceOp = findLastOpForNode(sourceOpsByNode[nodeId] || []);
        const targetOp = findLastOpForNode(targetOpsByNode[nodeId] || []);
        if (sourceOp && targetOp) {
          conflicts.push({
            nodeId,
            sourceChange: sourceOp,
            targetChange: targetOp,
          });
          mergedNodes[nodeId] = sourceOp.lamport >= targetOp.lamport ? sourceNodes[nodeId] : targetNodes[nodeId];
        }
      }
    } else if (inBase && inSource && inTarget) {
      const baseNode = baseNodes[nodeId];
      const sourceChanged = !nodesEqual(baseNode, sourceNodes[nodeId]);
      const targetChanged = !nodesEqual(baseNode, targetNodes[nodeId]);

      if (sourceChanged && !targetChanged) {
        mergedNodes[nodeId] = sourceNodes[nodeId];
      } else if (!sourceChanged && targetChanged) {
        mergedNodes[nodeId] = targetNodes[nodeId];
      } else if (sourceChanged && targetChanged) {
        if (nodesEqual(sourceNodes[nodeId], targetNodes[nodeId])) {
          mergedNodes[nodeId] = sourceNodes[nodeId];
        } else {
          const sourceOp = findLastOpForNode(sourceOpsByNode[nodeId] || []);
          const targetOp = findLastOpForNode(targetOpsByNode[nodeId] || []);
          if (sourceOp && targetOp) {
            conflicts.push({
              nodeId,
              sourceChange: sourceOp,
              targetChange: targetOp,
            });
            mergedNodes[nodeId] = sourceOp.lamport >= targetOp.lamport ? sourceNodes[nodeId] : targetNodes[nodeId];
          }
        }
      } else {
        mergedNodes[nodeId] = baseNode;
      }
    }
  }

  mergedNodes = cleanupOrphanNodes(mergedNodes);

  return { mergedNodes, conflicts };
}

function getDeletedNodes(
  baseNodes: Record<string, MindMapNode>,
  finalNodes: Record<string, MindMapNode>,
  ops: Operation[]
): Map<string, Operation> {
  const deleted = new Map<string, Operation>();
  const deleteOps: Operation[] = [];

  for (const op of ops) {
    if (op.type === 'delete') {
      deleteOps.push(op);
    }
  }

  const tempCRDT = new MindMapCRDT(baseNodes);
  for (const op of deleteOps) {
    const beforeIds = new Set(Object.keys(tempCRDT.getNodes()));
    tempCRDT.applyOperation(op);
    const afterIds = new Set(Object.keys(tempCRDT.getNodes()));
    for (const id of beforeIds) {
      if (!afterIds.has(id)) {
        deleted.set(id, op);
      }
    }
  }

  for (const nodeId of Object.keys(baseNodes)) {
    if (!(nodeId in finalNodes) && !deleted.has(nodeId)) {
      const deleteOp = deleteOps.find(o => o.nodeId === nodeId);
      if (deleteOp) {
        deleted.set(nodeId, deleteOp);
      }
    }
  }

  return deleted;
}

function cleanupOrphanNodes(nodes: Record<string, MindMapNode>): Record<string, MindMapNode> {
  const result: Record<string, MindMapNode> = {};
  const rootIds = new Set<string>();

  for (const [id, node] of Object.entries(nodes)) {
    if (node.parentId === null) {
      rootIds.add(id);
      result[id] = node;
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of Object.entries(nodes)) {
      if (id in result) continue;
      if (node.parentId && node.parentId in result) {
        result[id] = node;
        changed = true;
      }
    }
  }

  return result;
}

function groupOpsByNode(ops: Operation[]): Record<string, Operation[]> {
  const groups: Record<string, Operation[]> = {};
  for (const op of ops) {
    if (!groups[op.nodeId]) {
      groups[op.nodeId] = [];
    }
    groups[op.nodeId].push(op);
  }
  return groups;
}

function findLastOpForNode(ops: Operation[]): Operation | null {
  if (ops.length === 0) return null;
  return ops.reduce((latest, op) => (op.lamport > latest.lamport ? op : latest));
}

function nodesEqual(a: MindMapNode, b: MindMapNode): boolean {
  return (
    a.id === b.id &&
    a.parentId === b.parentId &&
    a.text === b.text &&
    a.x === b.x &&
    a.y === b.y &&
    a.collapsed === b.collapsed &&
    a.color === b.color
  );
}

export function resolveConflict(
  currentNodes: Record<string, MindMapNode>,
  conflict: MergeConflict,
  resolution: 'source' | 'target'
): Record<string, MindMapNode> {
  const result = { ...currentNodes };
  const chosenOp = resolution === 'source' ? conflict.sourceChange : conflict.targetChange;

  const crdt = new MindMapCRDT(result);
  crdt.applyOperation(chosenOp);

  return crdt.getNodes();
}
