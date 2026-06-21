import { initDatabase, getBranches, createBranch, saveSnapshot, getSnapshot, saveOperation, createMergeRequest } from './src/database';
import { handleCreateMergeRequest, handleMergeRequest } from './src/websocket';

initDatabase();

console.log('=== 完整合并测试 ===');

const branches: any[] = getBranches();
const mainBranch: any = branches.find((b: any) => b.isMain);
if (!mainBranch) {
  console.error('Main branch not found');
  process.exit(1);
}

console.log('Main branch:', mainBranch.name);

const mainSnapshot = getSnapshot(mainBranch.id);
if (!mainSnapshot) {
  console.error('Main snapshot not found');
  process.exit(1);
}

console.log('Main nodes:', Object.keys(mainSnapshot.nodes).length);
console.log('Main snapshot version:', mainSnapshot.version);

const testDeleteBranch = createBranch(
  'test-delete-' + Date.now(),
  mainBranch.id,
  mainSnapshot.version,
  '测试用户'
);
console.log('\nCreated test-delete branch:', testDeleteBranch.id);

const testModifyBranch = createBranch(
  'test-modify-' + Date.now(),
  mainBranch.id,
  mainSnapshot.version,
  '测试用户'
);
console.log('Created test-modify branch:', testModifyBranch.id);

const nodeIds = Object.keys(mainSnapshot.nodes);
const targetNodeId = nodeIds.find(id => id !== mainBranch.id && mainSnapshot.nodes[id].parentId) || nodeIds[1];
console.log('Target node for operations:', targetNodeId.slice(0, 10));

const childNodeId = 'test-child-' + Date.now();
const addOp: any = {
  id: 'add-op-' + Date.now(),
  type: 'add',
  nodeId: childNodeId,
  branchId: testModifyBranch.id,
  node: {
    id: childNodeId,
    text: '测试孙子节点',
    parentId: targetNodeId,
    x: 200,
    y: 0,
    color: '#4a90d9',
    collapsed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  parentId: targetNodeId,
  lamport: Date.now() + 100,
  timestamp: Date.now() + 100,
  author: 'test',
};

const modifySnapshot = getSnapshot(testModifyBranch.id);
if (modifySnapshot) {
  const modifyNodes = { ...modifySnapshot.nodes };
  modifyNodes[childNodeId] = addOp.node;
  saveSnapshot(testModifyBranch.id, modifyNodes);
  saveOperation(addOp, 2);
  console.log('Added child node to modify branch');
}

const deleteOp: any = {
  id: 'delete-op-' + Date.now(),
  type: 'delete',
  nodeId: targetNodeId,
  branchId: testDeleteBranch.id,
  lamport: Date.now() + 200,
  timestamp: Date.now() + 200,
  author: 'test',
};

const deleteSnapshot = getSnapshot(testDeleteBranch.id);
if (deleteSnapshot) {
  const deleteNodes = { ...deleteSnapshot.nodes };
  delete deleteNodes[targetNodeId];
  const descendants: string[] = [];
  const stack = [targetNodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const [id, node] of Object.entries(deleteSnapshot.nodes)) {
      if (node.parentId === current) {
        descendants.push(id);
        stack.push(id);
        delete deleteNodes[id];
      }
    }
  }
  saveSnapshot(testDeleteBranch.id, deleteNodes);
  saveOperation(deleteOp, 2);
  console.log('Deleted target node from delete branch');
}

const modifyAfter = getSnapshot(testModifyBranch.id);
const deleteAfter = getSnapshot(testDeleteBranch.id);
console.log('\nModify branch nodes:', Object.keys(modifyAfter?.nodes || {}).length);
console.log('Delete branch nodes:', Object.keys(deleteAfter?.nodes || {}).length);

console.log('\n--- Creating merge request (modify -> delete) ---');
try {
  const mr = handleCreateMergeRequest(testModifyBranch.id, testDeleteBranch.id, '测试用户');
  console.log('Merge request created:', mr.id);
  console.log('Status:', mr.status);
  console.log('Conflicts:', mr.conflicts?.length || 0);
  if (mr.conflicts) {
    console.log('Conflict details:', mr.conflicts.map(c => ({
      nodeId: c.nodeId.slice(0, 10),
      sourceType: c.sourceChange.type,
      targetType: c.targetChange.type,
    })));
  }

  console.log('\n--- Executing merge ---');
  const result = handleMergeRequest(mr.id);
  console.log('Merge result:', result.merged);
  console.log('New version:', result.version);

  const finalSnapshot = getSnapshot(testDeleteBranch.id);
  console.log('Final nodes:', Object.keys(finalSnapshot?.nodes || {}).length);
  if (finalSnapshot) {
    console.log('Nodes:', Object.values(finalSnapshot.nodes).map(n => ({
      id: n.id.slice(0, 10),
      text: n.text,
      parentId: n.parentId?.slice(0, 10) || null,
    })));
  }

  const hasOrphan = Object.values(finalSnapshot?.nodes || {}).some(n =>
    n.parentId && !(n.parentId in (finalSnapshot?.nodes || {}))
  );
  console.log('Has orphan nodes:', hasOrphan);

} catch (error) {
  console.error('Error:', error);
}

console.log('\n=== 测试完成 ===');
