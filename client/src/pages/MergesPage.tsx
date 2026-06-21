import React, { useState, useEffect } from 'react';
import type { Branch, MergeRequest, MergeConflict } from '../../../shared/types';

interface MergesPageProps {
  userId: string;
}

const API_BASE = 'http://localhost:3001';

export const MergesPage: React.FC<MergesPageProps> = ({ userId }) => {
  const [mergeRequests, setMergeRequests] = useState<MergeRequest[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [selectedMR, setSelectedMR] = useState<MergeRequest | null>(null);
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [mrRes, branchesRes] = await Promise.all([
        fetch(`${API_BASE}/api/merge-requests`),
        fetch(`${API_BASE}/api/branches`),
      ]);
      const mrData = await mrRes.json();
      const branchesData = await branchesRes.json();
      setMergeRequests(mrData.mergeRequests);
      setBranches(branchesData.branches);
      if (branchesData.branches.length > 0) {
        const mainBranch = branchesData.branches.find((b: Branch) => b.isMain);
        if (mainBranch) {
          setTargetBranchId(mainBranch.id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  const handleCreateMR = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceBranchId || !targetBranchId) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/merge-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceBranchId,
          targetBranchId,
          author: userId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        await fetchData();
        setShowCreateModal(false);
        setSourceBranchId('');
        if (data.mergeRequest.status === 'conflict') {
          setSelectedMR(data.mergeRequest);
          setShowResolveModal(true);
        }
      }
    } catch (error) {
      console.error('Failed to create MR:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveConflict = async (nodeId: string, resolution: 'source' | 'target') => {
    if (!selectedMR) return;

    try {
      const res = await fetch(`${API_BASE}/api/merge-requests/${selectedMR.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId,
          resolution,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSelectedMR(data.mr);
        await fetchData();
      }
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  };

  const handleMerge = async (mrId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/merge-requests/${mrId}/merge`, {
        method: 'POST',
      });

      if (res.ok) {
        await fetchData();
        if (selectedMR?.id === mrId) {
          setShowResolveModal(false);
          setSelectedMR(null);
        }
      }
    } catch (error) {
      console.error('Failed to merge:', error);
    }
  };

  const getBranchName = (branchId: string) => {
    return branches.find((b) => b.id === branchId)?.name || branchId;
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { className: string; label: string }> = {
      pending: { className: 'badge-pending', label: '待合并' },
      merged: { className: 'badge-merged', label: '已合并' },
      conflict: { className: 'badge-conflict', label: '有冲突' },
      closed: { className: 'badge-secondary', label: '已关闭' },
    };
    return statusMap[status] || { className: 'badge-secondary', label: status };
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  const getOperationSummary = (op: any) => {
    if (op.type === 'update' && op.changes?.text) {
      return `更新文本为: "${op.changes.text}"`;
    }
    if (op.type === 'add' && op.node?.text) {
      return `添加节点: "${op.node.text}"`;
    }
    if (op.type === 'delete' && op.node?.text) {
      return `删除节点: "${op.node.text}"`;
    }
    return `${op.type}操作`;
  };

  const availableSourceBranches = branches.filter(
    (b) => !b.isMain && !b.merged && b.id !== targetBranchId
  );

  return (
    <div className="merges-page">
      <div className="page-header">
        <h2>合并请求</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + 发起合并请求
        </button>
      </div>

      {mergeRequests.length === 0 ? (
        <div className="empty-state">暂无合并请求</div>
      ) : (
        mergeRequests.map((mr) => {
          const status = getStatusBadge(mr.status);
          return (
            <div key={mr.id} className="card">
              <div className="card-header">
                <div className="card-title">
                  {getBranchName(mr.sourceBranchId)} → {getBranchName(mr.targetBranchId)}
                </div>
                <span className={`badge ${status.className}`}>{status.label}</span>
              </div>
              <div className="card-meta">
                发起人: {mr.author} • {formatDate(mr.createdAt)}
                {mr.conflicts && mr.conflicts.length > 0 && (
                  <> • {mr.conflicts.length} 个冲突</>
                )}
              </div>
              <div className="card-actions">
                {mr.status === 'conflict' && (
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      setSelectedMR(mr);
                      setShowResolveModal(true);
                    }}
                  >
                    解决冲突
                  </button>
                )}
                {mr.status === 'pending' && (
                  <button
                    className="btn btn-success"
                    onClick={() => handleMerge(mr.id)}
                  >
                    合并
                  </button>
                )}
                {mr.conflicts && mr.conflicts.length > 0 && mr.status === 'conflict' && (
                  <button
                    className="btn btn-success"
                    onClick={() => handleMerge(mr.id)}
                    disabled={mr.conflicts.some((c) => !c.resolution)}
                  >
                    强制合并
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>发起合并请求</h3>
            <form onSubmit={handleCreateMR}>
              <div className="form-group">
                <label>源分支</label>
                <select
                  value={sourceBranchId}
                  onChange={(e) => setSourceBranchId(e.target.value)}
                  required
                >
                  <option value="">请选择源分支</option>
                  {availableSourceBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>目标分支</label>
                <select
                  value={targetBranchId}
                  onChange={(e) => setTargetBranchId(e.target.value)}
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
                  {loading ? '创建中...' : '发起合并'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResolveModal && selectedMR && selectedMR.conflicts && (
        <div className="modal-overlay" onClick={() => setShowResolveModal(false)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              解决冲突 - {getBranchName(selectedMR.sourceBranchId)} →{' '}
              {getBranchName(selectedMR.targetBranchId)}
            </h3>
            <p style={{ marginBottom: 16, color: '#64748b' }}>
              共 {selectedMR.conflicts.length} 个冲突需要解决
            </p>

            {selectedMR.conflicts.map((conflict, index) => (
              <div
                key={conflict.nodeId}
                className={`conflict-item ${conflict.resolution ? 'resolved' : ''}`}
              >
                <div className="conflict-header">
                  <span className={`conflict-title ${conflict.resolution ? 'resolved' : ''}`}>
                    冲突 #{index + 1}: 节点 {conflict.nodeId.slice(0, 8)}
                  </span>
                  {conflict.resolution && (
                    <span className="badge badge-active">
                      已选择: {conflict.resolution === 'source' ? '源分支' : '目标分支'}
                    </span>
                  )}
                </div>
                <div className="conflict-versions">
                  <div
                    className={`version-card ${conflict.resolution === 'source' ? 'selected' : ''}`}
                  >
                    <h4>源分支 ({getBranchName(selectedMR.sourceBranchId)})</h4>
                    <div className="version-content">
                      <div style={{ marginBottom: 4 }}>
                        操作: {conflict.sourceChange.author} @{' '}
                        {formatDate(conflict.sourceChange.timestamp)}
                      </div>
                      <div>{getOperationSummary(conflict.sourceChange)}</div>
                    </div>
                  </div>
                  <div
                    className={`version-card ${conflict.resolution === 'target' ? 'selected' : ''}`}
                  >
                    <h4>目标分支 ({getBranchName(selectedMR.targetBranchId)})</h4>
                    <div className="version-content">
                      <div style={{ marginBottom: 4 }}>
                        操作: {conflict.targetChange.author} @{' '}
                        {formatDate(conflict.targetChange.timestamp)}
                      </div>
                      <div>{getOperationSummary(conflict.targetChange)}</div>
                    </div>
                  </div>
                </div>
                {!conflict.resolution && (
                  <div className="conflict-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleResolveConflict(conflict.nodeId, 'source')}
                    >
                      保留源分支版本
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleResolveConflict(conflict.nodeId, 'target')}
                    >
                      保留目标分支版本
                    </button>
                  </div>
                )}
              </div>
            ))}

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowResolveModal(false);
                  setSelectedMR(null);
                }}
              >
                关闭
              </button>
              <button
                className="btn btn-success"
                onClick={() => handleMerge(selectedMR.id)}
                disabled={selectedMR.conflicts.some((c) => !c.resolution)}
              >
                完成合并
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
