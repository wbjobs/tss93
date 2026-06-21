import React, { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { MindMapNode, Operation, Branch } from '../../../shared/types';
import { MindMapCRDT } from '../../../shared/crdt';
import { useWebSocket } from '../hooks/useWebSocket';
import { calculateLayout, generateEdgePath, getRandomColor, LayoutNode } from '../utils/layout';
import { MindMapNode as MindMapNodeComponent } from './MindMapNode';
import { Timeline } from './Timeline';

interface MindMapProps {
  branchId: string;
  userId: string;
  currentVersion: number;
  onVersionChange: (version: number) => void;
}

interface TimelineEvent {
  timestamp: number;
  type: string;
  description: string;
}

export const MindMap: React.FC<MindMapProps> = ({ branchId, userId, currentVersion, onVersionChange }) => {
  const { isConnected, crdt, version, operations, sendOperation } = useWebSocket({
    branchId,
    userId,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [svgSize, setSvgSize] = useState({ width: 1200, height: 800 });
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [historyMode, setHistoryMode] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [historyCRDT, setHistoryCRDT] = useState<MindMapCRDT | null>(null);
  const [historyTime, setHistoryTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [createBranchTimestamp, setCreateBranchTimestamp] = useState(0);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const playTimerRef = useRef<number | null>(null);

  const API_BASE = 'http://localhost:3001';

  const loadTimeline = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/branches/${branchId}/timeline`);
      const data = await res.json();
      if (data.events && data.events.length > 0) {
        setTimelineEvents(data.events);
        setHistoryTime(data.events[data.events.length - 1].timestamp);
      }
    } catch (error) {
      console.error('Failed to load timeline:', error);
    }
  }, [branchId]);

  const loadSnapshotAtTime = useCallback(async (timestamp: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/branches/${branchId}/snapshot-at?timestamp=${timestamp}`);
      const data = await res.json();
      if (data.snapshot) {
        const newCRDT = new MindMapCRDT(data.snapshot.nodes);
        for (const op of data.operations || []) {
          newCRDT.applyOperation(op);
        }
        setHistoryCRDT(newCRDT);
      }
    } catch (error) {
      console.error('Failed to load snapshot:', error);
    }
  }, [branchId]);

  const handleTimeChange = useCallback((timestamp: number) => {
    setHistoryTime(timestamp);
    loadSnapshotAtTime(timestamp);
  }, [loadSnapshotAtTime]);

  const handleToggleHistoryMode = useCallback(() => {
    if (!historyMode) {
      loadTimeline();
    }
    setHistoryMode(!historyMode);
    setHistoryCRDT(null);
    setIsPlaying(false);
  }, [historyMode, loadTimeline]);

  useEffect(() => {
    if (isPlaying && timelineEvents.length > 0) {
      const startTime = timelineEvents[0].timestamp;
      const endTime = timelineEvents[timelineEvents.length - 1].timestamp;
      const totalDuration = endTime - startTime;
      const playDuration = 5000;
      const step = totalDuration / playDuration * 50;

      playTimerRef.current = window.setInterval(() => {
        setHistoryTime((prev) => {
          const next = prev + step;
          if (next >= endTime) {
            setIsPlaying(false);
            return endTime;
          }
          loadSnapshotAtTime(next);
          return next;
        });
      }, 50);
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, timelineEvents, loadSnapshotAtTime]);

  const handlePlayPause = useCallback(() => {
    if (timelineEvents.length === 0) return;
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      const endTime = timelineEvents[timelineEvents.length - 1].timestamp;
      if (historyTime >= endTime) {
        setHistoryTime(timelineEvents[0].timestamp);
        loadSnapshotAtTime(timelineEvents[0].timestamp);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, timelineEvents, historyTime, loadSnapshotAtTime]);

  const handleCreateBranch = useCallback((timestamp: number) => {
    setCreateBranchTimestamp(timestamp);
    setNewBranchName('');
    setShowCreateBranchModal(true);
  }, []);

  const handleConfirmCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;
    setCreatingBranch(true);
    try {
      const res = await fetch(`${API_BASE}/api/branches/from-timestamp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBranchName.trim(),
          parentBranchId: branchId,
          timestamp: createBranchTimestamp,
          createdBy: userId,
        }),
      });
      if (res.ok) {
        setShowCreateBranchModal(false);
        setHistoryMode(false);
      }
    } catch (error) {
      console.error('Failed to create branch:', error);
    } finally {
      setCreatingBranch(false);
    }
  }, [newBranchName, branchId, createBranchTimestamp, userId]);

  useEffect(() => {
    if (version !== currentVersion) {
      onVersionChange(version);
    }
  }, [version, currentVersion, onVersionChange]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setSvgSize({
          width: Math.max(rect.width, 1200),
          height: Math.max(rect.height, 800),
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const activeCRDT = historyMode ? historyCRDT : crdt;
  const nodes = activeCRDT?.getNodes() || {};
  const { nodes: layoutNodes, edges } = calculateLayout(nodes);

  const getChildrenCount = useCallback(
    (nodeId: string): number => {
      return Object.values(nodes).filter((n) => n.parentId === nodeId).length;
    },
    [nodes]
  );

  const createOperation = useCallback(
    (type: Operation['type'], nodeId: string, extra: Record<string, any> = {}): Operation => {
      const lamport = (crdt?.getLamportClock() || Date.now()) + 1;
      const baseOp = {
        id: uuidv4(),
        type,
        nodeId,
        timestamp: Date.now(),
        author: userId,
        branchId,
        lamport,
      };
      return { ...baseOp, ...extra } as Operation;
    },
    [branchId, userId, crdt]
  );

  const handleAddChild = useCallback(() => {
    if (!selectedNodeId || !crdt) return;

    const parent = crdt.getNode(selectedNodeId);
    if (!parent) return;

    const siblings = Object.values(crdt.getNodes()).filter((n) => n.parentId === selectedNodeId);
    const newY = parent.y + (siblings.length + 1) * 60;

    const newNode: MindMapNode = {
      id: uuidv4(),
      parentId: selectedNodeId,
      text: '新节点',
      x: parent.x + 200,
      y: newY,
      collapsed: false,
      color: getRandomColor(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const op = createOperation('add', newNode.id, { node: newNode });
    sendOperation(op);
    setSelectedNodeId(newNode.id);
  }, [selectedNodeId, crdt, createOperation, sendOperation]);

  const handleAddSibling = useCallback(() => {
    if (!selectedNodeId || !crdt) return;

    const node = crdt.getNode(selectedNodeId);
    if (!node || !node.parentId) return;

    const siblings = Object.values(crdt.getNodes()).filter((n) => n.parentId === node.parentId);
    const newY = node.y + 60;

    const newNode: MindMapNode = {
      id: uuidv4(),
      parentId: node.parentId,
      text: '新节点',
      x: node.x,
      y: newY,
      collapsed: false,
      color: getRandomColor(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const op = createOperation('add', newNode.id, { node: newNode });
    sendOperation(op);
    setSelectedNodeId(newNode.id);
  }, [selectedNodeId, crdt, createOperation, sendOperation]);

  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId || !crdt) return;

    const node = crdt.getNode(selectedNodeId);
    if (!node || node.parentId === null) return;

    const op = createOperation('delete', selectedNodeId, { node });
    sendOperation(op);
    setSelectedNodeId(node.parentId);
  }, [selectedNodeId, crdt, createOperation, sendOperation]);

  const handleUpdateText = useCallback(
    (nodeId: string, text: string) => {
      if (!crdt) return;
      const node = crdt.getNode(nodeId);
      if (!node) return;

      const op = createOperation('update', nodeId, {
        changes: { text },
        oldValue: { text: node.text },
      });
      sendOperation(op);
    },
    [crdt, createOperation, sendOperation]
  );

  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      if (!crdt) return;
      const node = crdt.getNode(nodeId);
      if (!node) return;

      const type = node.collapsed ? 'uncollapse' : 'collapse';
      const op = createOperation(type, nodeId);
      sendOperation(op);
    },
    [crdt, createOperation, sendOperation]
  );

  const handleStartDrag = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      const node = layoutNodes[nodeId];
      if (!node) return;

      const svgPoint = svgRef.current!.createSVGPoint();
      svgPoint.x = e.clientX;
      svgPoint.y = e.clientY;
      const ctm = svgRef.current!.getScreenCTM();
      if (!ctm) return;
      const point = svgPoint.matrixTransform(ctm.inverse());

      setDraggingNodeId(nodeId);
      setDragOffset({
        x: point.x - node.x,
        y: point.y - (node.y - node.height / 2),
      });
    },
    [layoutNodes]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingNodeId || !crdt || !svgRef.current) return;

      const node = crdt.getNode(draggingNodeId);
      if (!node) return;

      const svgPoint = svgRef.current.createSVGPoint();
      svgPoint.x = e.clientX;
      svgPoint.y = e.clientY;
      const ctm = svgRef.current.getScreenCTM();
      if (!ctm) return;
      const point = svgPoint.matrixTransform(ctm.inverse());

      const newX = point.x - dragOffset.x;
      const newY = point.y - dragOffset.y + layoutNodes[draggingNodeId].height / 2;

      let newParentId: string | null = null;
      for (const [id, layoutNode] of Object.entries(layoutNodes)) {
        if (id === draggingNodeId) continue;
        const nodeCenterX = layoutNode.x + layoutNode.width / 2;
        const nodeCenterY = layoutNode.y;
        const distance = Math.sqrt(Math.pow(newX - nodeCenterX, 2) + Math.pow(newY - nodeCenterY, 2));
        if (distance < 80) {
          newParentId = id;
          break;
        }
      }

      if (newX !== node.x || newY !== node.y || newParentId !== node.parentId) {
        const op = createOperation('move', draggingNodeId, {
          oldParentId: node.parentId,
          newParentId: newParentId !== undefined ? newParentId : node.parentId,
          oldX: node.x,
          oldY: node.y,
          newX: newX,
          newY: newY,
        });
        sendOperation(op);
      }
    },
    [draggingNodeId, crdt, dragOffset, layoutNodes, createOperation, sendOperation]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingNodeId(null);
  }, []);

  const handleSvgClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteNode();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleAddChild();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAddSibling();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (selectedNodeId) {
          handleToggleCollapse(selectedNodeId);
        }
      }
    },
    [handleDeleteNode, handleAddChild, handleAddSibling, handleToggleCollapse, selectedNodeId]
  );

  return (
    <div
      className="content"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="toolbar">
        <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot"></span>
          {isConnected ? '已连接' : '连接中...'}
        </span>
        <span className="branch-info">
          <span>版本: v{version}</span>
        </span>
        <div style={{ flex: 1 }} />
        <button
          className={`btn ${historyMode ? 'btn-warning' : 'btn-secondary'}`}
          onClick={handleToggleHistoryMode}
        >
          {historyMode ? '退出历史模式' : '⏱ 时间轴'}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleAddChild}
          disabled={!selectedNodeId || historyMode}
        >
          + 子节点 (Tab)
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleAddSibling}
          disabled={!selectedNodeId || activeCRDT?.getNode(selectedNodeId)?.parentId === null || historyMode}
        >
          + 兄弟节点 (Enter)
        </button>
        <button
          className="btn btn-danger"
          onClick={handleDeleteNode}
          disabled={!selectedNodeId || activeCRDT?.getNode(selectedNodeId)?.parentId === null || historyMode}
        >
          删除节点 (Del)
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => selectedNodeId && handleToggleCollapse(selectedNodeId)}
          disabled={!selectedNodeId || getChildrenCount(selectedNodeId) === 0 || historyMode}
        >
          {selectedNodeId && activeCRDT?.getNode(selectedNodeId)?.collapsed ? '展开' : '折叠'} (空格)
        </button>
      </div>

      {historyMode && timelineEvents.length > 0 && (
        <Timeline
          events={timelineEvents}
          startTime={timelineEvents[0].timestamp}
          endTime={timelineEvents[timelineEvents.length - 1].timestamp}
          currentTime={historyTime}
          isPlaying={isPlaying}
          onTimeChange={handleTimeChange}
          onPlayPause={handlePlayPause}
          onCreateBranch={handleCreateBranch}
        />
      )}

      {historyMode && (
        <div className="history-mode-banner">
          <span>📜 历史预览模式 - 拖动时间轴查看任意时刻的状态</span>
        </div>
      )}
      <div className="mindmap-container" ref={containerRef}>
        <svg
          ref={svgRef}
          className="mindmap-svg"
          width={svgSize.width}
          height={svgSize.height}
          onClick={handleSvgClick}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="2" dy="2" stdDeviation="3" floodOpacity="0.2" />
            </filter>
          </defs>
          <g>
            {edges.map((edge, index) => {
              const fromNode = layoutNodes[edge.from];
              const toNode = layoutNodes[edge.to];
              if (!fromNode || !toNode) return null;
              return (
                <path
                  key={`edge-${index}`}
                  className="edge-path"
                  d={generateEdgePath(
                    fromNode.x,
                    fromNode.y,
                    fromNode.width,
                    toNode.x,
                    toNode.y
                  )}
                />
              );
            })}
          </g>
          <g filter="url(#shadow)">
            {Object.values(layoutNodes).map((node) => (
              <MindMapNodeComponent
                key={node.id}
                node={node as LayoutNode}
                isSelected={node.id === selectedNodeId}
                onSelect={setSelectedNodeId}
                onStartDrag={handleStartDrag}
                onUpdateText={handleUpdateText}
                onToggleCollapse={handleToggleCollapse}
                childrenCount={getChildrenCount(node.id)}
              />
            ))}
          </g>
        </svg>
      </div>

      {showCreateBranchModal && (
        <div className="modal-overlay" onClick={() => setShowCreateBranchModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>从时间点创建新分支</h3>
            <p style={{ color: '#64748b', marginBottom: 16 }}>
              基于 {new Date(createBranchTimestamp).toLocaleString('zh-CN')} 的状态创建新分支
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleConfirmCreateBranch(); }}>
              <div className="form-group">
                <label>分支名称</label>
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="输入分支名称..."
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateBranchModal(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={creatingBranch}>
                  {creatingBranch ? '创建中...' : '创建分支'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
