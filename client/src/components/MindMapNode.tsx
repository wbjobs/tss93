import React, { useState, useRef, useEffect } from 'react';
import type { LayoutNode } from '../utils/layout';

interface MindMapNodeProps {
  node: LayoutNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onStartDrag: (id: string, e: React.MouseEvent) => void;
  onUpdateText: (id: string, text: string) => void;
  onToggleCollapse: (id: string) => void;
  childrenCount: number;
}

export const MindMapNode: React.FC<MindMapNodeProps> = ({
  node,
  isSelected,
  onSelect,
  onStartDrag,
  onUpdateText,
  onToggleCollapse,
  childrenCount,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(node.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isEditing) {
      onSelect(node.id);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditText(node.text);
  };

  const handleBlur = () => {
    if (editText.trim() && editText !== node.text) {
      onUpdateText(node.id, editText.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (editText.trim() && editText !== node.text) {
        onUpdateText(node.id, editText.trim());
      }
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      setEditText(node.text);
      setIsEditing(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isEditing && e.button === 0) {
      onStartDrag(node.id, e);
    }
  };

  const handleCollapseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse(node.id);
  };

  const hasChildren = childrenCount > 0;
  const textColor = isEditing ? '#1e293b' : '#ffffff';

  return (
    <g
      className={`node-group ${isSelected ? 'selected' : ''}`}
      transform={`translate(${node.x}, ${node.y - node.height / 2})`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
    >
      <rect
        className="node-rect"
        width={node.width}
        height={node.height}
        fill={node.color}
        rx={8}
        ry={8}
      />
      {isEditing ? (
        <foreignObject x={5} y={5} width={node.width - 10} height={node.height - 10}>
          <input
            ref={inputRef}
            className="edit-input"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              height: '100%',
              background: '#ffffff',
              borderRadius: '4px',
            }}
          />
        </foreignObject>
      ) : (
        <text
          className="node-text"
          x={node.width / 2}
          y={node.height / 2}
          fill={textColor}
        >
          {node.text}
        </text>
      )}
      {hasChildren && (
        <g
          className="collapse-btn"
          onClick={handleCollapseClick}
          transform={`translate(${node.width - 8}, ${node.height / 2})`}
        >
          <circle r={10} fill="#ffffff" stroke={node.color} strokeWidth={2} />
          <text
            x={0}
            y={4}
            textAnchor="middle"
            fontSize={14}
            fontWeight="bold"
            fill={node.color}
          >
            {node.collapsed ? '+' : '−'}
          </text>
        </g>
      )}
    </g>
  );
};
