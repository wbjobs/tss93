import React, { useState, useEffect } from 'react';
import type { Branch, Operation } from '../../../shared/types';

interface BranchesPageProps {
  userId: string;
  onSelectBranch: (branchId: string) => void;
  currentBranchId: string;
}

const API_BASE = 'http://localhost:3001';

export const BranchesPage: React.FC<BranchesPageProps> = ({
  userId,
  onSelectBranch,
  currentBranchId,
}) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [branchHistory, setBranchHistory] = useState<{
    branch: Branch;
    operations: Operation[];
  } | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [parentBranchId, setParentBranchId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/branches`);
      const data = await res.json();
      setBranches(data.branches);
      if (data.branches.length > 0 && !parentBranchId) {
        const mainBranch = data.branches.find((b: Branch) => b.isMain);
        if (mainBranch) {
          setParentBranchId(mainBranch.id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch branches:', error);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim() || !parentBranchId) return;

    setLoading(true);
    try {
      const parentBranch = branches.find((b) => b.id === parentBranchId);
      if (!parentBranch) return;

      const historyRes = await fetch(`${API_BASE}/api/branches/${parentBranchId}/history`);
      const historyData = await historyRes.json();

      const res = await fetch(`${API_BASE}/api/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBranchName.trim(),
          parentBranchId,
          parentSnapshotVersion: historyData.snapshot?.version || 1,
          createdBy: userId,
        }),
      });

      if (res.ok) {
        await fetchBranches();
        setNewBranchName('');
        setShowCreateModal(false);
      }
    } catch (error) {
      console.error('Failed to create branch:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewHistory = async (branch: Branch) => {
    setSelectedBranch(branch);
    try {
      const res = await fetch(`${API_BASE}/api/branches/${branch.id}/history`);
      const data = await res.json();
      setBranchHistory(data);
      setShowHistoryModal(true);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  const getOperationTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      add: '添加',
      update: '更新',
      delete: '删除',
      move: '移动',
      collapse: '折叠',
      uncollapse: '展开',
    };
    return labels[type] || type;
  };

  return (
    <div className="branches-page">
      <div className="page-header">
        <h2>分支管理</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + 创建分支
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="empty-state">暂无分支</div>
      ) : (
        branches.map((branch) => (
          <div key={branch.id} className="card">
            <div className="card-header">
              <div className="card-title">
                {branch.name}
                {branch.isMain && (
                  <span className="badge badge-main" style={{ marginLeft: 8 }}>
                    主分支
                  </span>
                )}
                {branch.merged && (
                  <span className="badge badge-merged" style={{ marginLeft: 8 }}>
                    已合并
                  </span>
                )}
              </div>
              <span className={`badge ${branch.isMain ? 'badge-main' : branch.merged ? 'badge-merged' : 'badge-active'}`}>
                {branch.isMain ? '主分支' : branch.merged ? '已合并' : '活跃'}
              </span>
            </div>
            <div className="card-meta">
              创建者: {branch.createdBy} • {formatDate(branch.createdAt)}
              {branch.parentBranchId && (
                <>
                  {' • '}
                  基于: {branches.find((b) => b.id === branch.parentBranchId)?.name || '未知分支'} v{branch.parentSnapshotVersion}
                </>
              )}
            </div>
            <div className="card-actions">
              <button
                className="btn btn-primary"
                onClick={() => onSelectBranch(branch.id)}
                disabled={branch.id === currentBranchId}
              >
                {branch.id === currentBranchId ? '当前分支' : '切换到此分支'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleViewHistory(branch)}
              >
                查看历史
              </button>
            </div>
          </div>
        ))
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>创建新分支</h3>
            <form onSubmit={handleCreateBranch}>
              <div className="form-group">
                <label>分支名称</label>
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="输入分支名称..."
                  required
                />
              </div>
              <div className="form-group">
                <label>基于分支</label>
                <select
                  value={parentBranchId}
                  onChange={(e) => setParentBranchId(e.target.value)}
                  required
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? '创建中...' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showHistoryModal && branchHistory && (
        <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>分支历史 - {branchHistory.branch.name}</h3>
            <div className="form-group">
              <label>操作日志 ({branchHistory.operations.length} 条)</label>
              <div className="operation-log">
                {branchHistory.operations.length === 0 ? (
                  <div style={{ color: '#94a3b8' }}>暂无操作</div>
                ) : (
                  branchHistory.operations.map((op) => (
                    <div key={op.id} className="operation-item">
                      [{formatDate(op.timestamp)}] {op.author} -{' '}
                      <span
                        style={{
                          color:
                            op.type === 'delete'
                              ? '#ef4444'
                              : op.type === 'add'
                              ? '#10b981'
                              : '#4f46e5',
                        }}
                      >
                        {getOperationTypeLabel(op.type)}
                      </span>{' '}
                      节点 {op.nodeId.slice(0, 8)}
                      {'type' in op && 'changes' in op && (op as any).changes?.text && (
                        <> - {(op as any).changes.text}</>
                      )}
                      {'type' in op && 'node' in op && (op as any).node?.text && (
                        <> - {(op as any).node.text}</>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowHistoryModal(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
