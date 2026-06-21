import { MindMapCRDT, mergeBranches } from '../shared/crdt';

const baseNodes: Record<string, any> = {
  'root': {
    id: 'root',
    text: '根节点',
    parentId: null,
    x: 0,
    y: 0,
    color: '#4a90d9',
    collapsed: false,
    createdAt: 1,
    updatedAt: 1,
  },
  'child1': {
    id: 'child1',
    text: '子节点1',
    parentId: 'root',
    x: 100,
    y: 0,
    color: '#4a90d9',
    collapsed: false,
    createdAt: 1,
    updatedAt: 1,
  },
  'child2': {
    id: 'child2',
    text: '子节点2',
    parentId: 'root',
    x: 100,
    y: 50,
    color: '#4a90d9',
    collapsed: false,
    createdAt: 1,
    updatedAt: 1,
  },
};

console.log('=== 测试幽灵节点问题 ===');
console.log('基础节点数:', Object.keys(baseNodes).length);

const deleteOps: any[] = [
  {
    id: 'delete-op-1',
    type: 'delete',
    nodeId: 'child1',
    lamport: 10,
    timestamp: Date.now(),
    snapshotVersion: 2,
  },
];

const modifyOps: any[] = [
  {
    id: 'add-op-1',
    type: 'add',
    nodeId: 'grandchild',
    node: {
      id: 'grandchild',
      text: '孙子节点',
      parentId: 'child1',
      x: 200,
      y: 0,
      color: '#4a90d9',
      collapsed: false,
      createdAt: 5,
      updatedAt: 5,
    },
    parentId: 'child1',
    lamport: 5,
    timestamp: 5,
    snapshotVersion: 2,
  },
];

console.log('\n--- 场景：分支A删除child1，分支B给child1添加子节点');
console.log('删除操作时间戳: 10');
console.log('添加操作时间戳: 5');

const sourceCRDT = new MindMapCRDT(baseNodes);
for (const op of modifyOps) {
  sourceCRDT.applyOperation(op);
}
console.log('\n源分支节点:', Object.keys(sourceCRDT.getNodes()));

const targetCRDT = new MindMapCRDT(baseNodes);
for (const op of deleteOps) {
  targetCRDT.applyOperation(op);
}
console.log('目标分支节点:', Object.keys(targetCRDT.getNodes()));

const result = mergeBranches(baseNodes, modifyOps, deleteOps);

console.log('\n合并后节点数:', Object.keys(result.mergedNodes).length);
console.log('合并后节点:', Object.values(result.mergedNodes).map(n => ({ id: n.id, text: n.text, parentId: n.parentId })));
console.log('冲突数:', result.conflicts.length);
console.log('冲突详情:', result.conflicts.map(c => ({ nodeId: c.nodeId, sourceType: c.sourceChange.type, targetType: c.targetChange.type })));

const hasOrphan = Object.values(result.mergedNodes).some(n => 
  n.parentId && !(n.parentId in result.mergedNodes)
);
console.log('是否有悬浮节点:', hasOrphan);

console.log('\n--- 场景：分支A删除child1，分支B修改child1的文本');
console.log('删除操作时间戳: 10');
console.log('修改操作时间戳: 15（更新）');

const updateOps: any[] = [
  {
    id: 'update-op-1',
    type: 'update',
    nodeId: 'child1',
    changes: { text: '修改后的子节点1' },
    lamport: 15,
    timestamp: 15,
    snapshotVersion: 2,
  },
];

const result2 = mergeBranches(baseNodes, updateOps, deleteOps);

console.log('\n合并后节点数:', Object.keys(result2.mergedNodes).length);
console.log('合并后节点:', Object.values(result2.mergedNodes).map(n => ({ id: n.id, text: n.text, parentId: n.parentId })));
console.log('冲突数:', result2.conflicts.length);
console.log('冲突详情:', result2.conflicts.map(c => ({ nodeId: c.nodeId, sourceType: c.sourceChange.type, targetType: c.targetChange.type, sourceLamport: c.sourceChange.lamport, targetLamport: c.targetChange.lamport })));

console.log('\n=== 测试完成 ===');
