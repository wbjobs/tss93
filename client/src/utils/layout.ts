import type { MindMapNode } from '../../../shared/types';

const NODE_WIDTH = 140;
const NODE_HEIGHT = 44;
const HORIZONTAL_GAP = 60;
const VERTICAL_GAP = 20;

export interface LayoutNode extends MindMapNode {
  width: number;
  height: number;
  subtreeHeight: number;
}

export function calculateLayout(
  nodes: Record<string, MindMapNode>
): { nodes: Record<string, LayoutNode>; edges: Array<{ from: string; to: string }> } {
  const nodeMap: Record<string, LayoutNode> = {};
  const edges: Array<{ from: string; to: string }> = [];

  for (const [id, node] of Object.entries(nodes)) {
    nodeMap[id] = {
      ...node,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      subtreeHeight: 0,
    };
  }

  const roots = Object.values(nodeMap).filter((n) => n.parentId === null);
  if (roots.length === 0) {
    return { nodes: nodeMap, edges };
  }

  const root = roots[0];
  root.x = 100;
  root.y = 300;

  const getChildren = (parentId: string): LayoutNode[] => {
    return Object.values(nodeMap).filter((n) => n.parentId === parentId);
  };

  function calculateSubtreeHeight(node: LayoutNode): number {
    const children = getChildren(node.id);
    if (children.length === 0 || node.collapsed) {
      node.subtreeHeight = node.height;
      return node.subtreeHeight;
    }

    let totalHeight = 0;
    for (const child of children) {
      totalHeight += calculateSubtreeHeight(child);
    }
    totalHeight += (children.length - 1) * VERTICAL_GAP;

    node.subtreeHeight = Math.max(node.height, totalHeight);
    return node.subtreeHeight;
  }

  function layoutChildren(node: LayoutNode, startY: number): number {
    const children = getChildren(node.id);
    if (children.length === 0 || node.collapsed) {
      node.y = startY + node.subtreeHeight / 2;
      return startY + node.subtreeHeight;
    }

    node.y = startY + node.subtreeHeight / 2;

    let currentY = startY;
    for (const child of children) {
      child.x = node.x + node.width + HORIZONTAL_GAP;
      edges.push({ from: node.id, to: child.id });
      currentY = layoutChildren(child, currentY);
      currentY += VERTICAL_GAP;
    }

    return startY + node.subtreeHeight;
  }

  calculateSubtreeHeight(root);
  layoutChildren(root, 300 - root.subtreeHeight / 2);

  return { nodes: nodeMap, edges };
}

export function generateEdgePath(
  fromX: number,
  fromY: number,
  fromWidth: number,
  toX: number,
  toY: number
): string {
  const startX = fromX + fromWidth;
  const startY = fromY;
  const endX = toX;
  const endY = toY;

  const midX = (startX + endX) / 2;

  return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
}

export function getNodeColors(): string[] {
  return [
    '#4F46E5',
    '#10B981',
    '#F59E0B',
    '#EF4444',
    '#8B5CF6',
    '#EC4899',
    '#06B6D4',
    '#84CC16',
  ];
}

export function getRandomColor(): string {
  const colors = getNodeColors();
  return colors[Math.floor(Math.random() * colors.length)];
}
