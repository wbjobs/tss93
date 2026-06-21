import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { MindMapNode, Operation, Branch, MergeRequest, NodeSnapshot, MergeConflict } from '../../shared/types';

const dbPath = path.join(__dirname, '..', 'mindmap.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parentBranchId TEXT,
      parentSnapshotVersion INTEGER,
      createdAt INTEGER NOT NULL,
      createdBy TEXT NOT NULL,
      isMain INTEGER NOT NULL DEFAULT 0,
      merged INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (parentBranchId) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branchId TEXT NOT NULL,
      version INTEGER NOT NULL,
      nodes TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (branchId) REFERENCES branches(id),
      UNIQUE(branchId, version)
    );

    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      branchId TEXT NOT NULL,
      type TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      author TEXT NOT NULL,
      lamport INTEGER NOT NULL,
      snapshotVersion INTEGER NOT NULL,
      FOREIGN KEY (branchId) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS merge_requests (
      id TEXT PRIMARY KEY,
      sourceBranchId TEXT NOT NULL,
      targetBranchId TEXT NOT NULL,
      author TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      conflicts TEXT,
      FOREIGN KEY (sourceBranchId) REFERENCES branches(id),
      FOREIGN KEY (targetBranchId) REFERENCES branches(id)
    );
  `);

  const mainBranch = db.prepare('SELECT * FROM branches WHERE isMain = 1').get();
  if (!mainBranch) {
    const mainId = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO branches (id, name, parentBranchId, parentSnapshotVersion, createdAt, createdBy, isMain, merged)
      VALUES (?, ?, NULL, 0, ?, ?, 1, 0)
    `).run(mainId, 'main', now, 'system');

    const rootNode: MindMapNode = {
      id: uuidv4(),
      parentId: null,
      text: '中心主题',
      x: 400,
      y: 300,
      collapsed: false,
      color: '#4F46E5',
      createdAt: now,
      updatedAt: now,
    };

    const initialSnapshot: NodeSnapshot = {
      nodes: { [rootNode.id]: rootNode },
      version: 1,
      timestamp: now,
    };

    db.prepare(`
      INSERT INTO snapshots (branchId, version, nodes, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(mainId, 1, JSON.stringify(initialSnapshot.nodes), now);
  }
}

export function getBranches(): Branch[] {
  const rows = db.prepare('SELECT * FROM branches ORDER BY createdAt ASC').all() as any[];
  return rows.map(row => ({
    ...row,
    isMain: !!row.isMain,
    merged: !!row.merged,
  }));
}

export function getBranch(branchId: string): Branch | null {
  const row = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId) as any;
  if (!row) return null;
  return {
    ...row,
    isMain: !!row.isMain,
    merged: !!row.merged,
  };
}

export function createBranch(name: string, parentBranchId: string, parentSnapshotVersion: number, createdBy: string): Branch {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(`
    INSERT INTO branches (id, name, parentBranchId, parentSnapshotVersion, createdAt, createdBy, isMain, merged)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
  `).run(id, name, parentBranchId, parentSnapshotVersion, now, createdBy);

  const parentSnapshot = getSnapshot(parentBranchId, parentSnapshotVersion);
  if (parentSnapshot) {
    db.prepare(`
      INSERT INTO snapshots (branchId, version, nodes, timestamp)
      VALUES (?, 1, ?, ?)
    `).run(id, JSON.stringify(parentSnapshot.nodes), now);
  }

  return {
    id,
    name,
    parentBranchId,
    parentSnapshotVersion,
    createdAt: now,
    createdBy,
    isMain: false,
    merged: false,
  };
}

export function getSnapshot(branchId: string, version?: number): NodeSnapshot | null {
  let row: any;
  if (version !== undefined) {
    row = db.prepare('SELECT * FROM snapshots WHERE branchId = ? AND version = ?').get(branchId, version);
  } else {
    row = db.prepare('SELECT * FROM snapshots WHERE branchId = ? ORDER BY version DESC LIMIT 1').get(branchId);
  }
  if (!row) return null;
  return {
    nodes: JSON.parse(row.nodes),
    version: row.version,
    timestamp: row.timestamp,
  };
}

export function getLatestVersion(branchId: string): number {
  const row = db.prepare('SELECT MAX(version) as maxVersion FROM snapshots WHERE branchId = ?').get(branchId) as any;
  return row?.maxVersion || 0;
}

export function saveSnapshot(branchId: string, nodes: Record<string, MindMapNode>): number {
  const latestVersion = getLatestVersion(branchId);
  const newVersion = latestVersion + 1;
  const now = Date.now();
  db.prepare(`
    INSERT INTO snapshots (branchId, version, nodes, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(branchId, newVersion, JSON.stringify(nodes), now);
  return newVersion;
}

export function saveOperation(op: Operation, snapshotVersion: number): void {
  db.prepare(`
    INSERT INTO operations (id, branchId, type, nodeId, data, timestamp, author, lamport, snapshotVersion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(op.id, op.branchId, op.type, op.nodeId, JSON.stringify(op), op.timestamp, op.author, op.lamport, snapshotVersion);
}

export function getOperations(branchId: string, fromVersion?: number): Operation[] {
  let query = 'SELECT * FROM operations WHERE branchId = ?';
  const params: any[] = [branchId];
  if (fromVersion !== undefined) {
    query += ' AND snapshotVersion > ?';
    params.push(fromVersion);
  }
  query += ' ORDER BY lamport ASC, timestamp ASC';
  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(row => JSON.parse(row.data));
}

export function createMergeRequest(sourceBranchId: string, targetBranchId: string, author: string, conflicts?: MergeConflict[]): MergeRequest {
  const id = uuidv4();
  const now = Date.now();
  const status = conflicts && conflicts.length > 0 ? 'conflict' : 'pending';
  db.prepare(`
    INSERT INTO merge_requests (id, sourceBranchId, targetBranchId, author, status, createdAt, conflicts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sourceBranchId, targetBranchId, author, status, now, conflicts ? JSON.stringify(conflicts) : null);

  return {
    id,
    sourceBranchId,
    targetBranchId,
    author,
    status,
    createdAt: now,
    conflicts,
  };
}

export function getMergeRequests(): MergeRequest[] {
  const rows = db.prepare('SELECT * FROM merge_requests ORDER BY createdAt DESC').all() as any[];
  return rows.map(row => ({
    ...row,
    conflicts: row.conflicts ? JSON.parse(row.conflicts) : undefined,
  }));
}

export function updateMergeRequestStatus(id: string, status: MergeRequest['status'], conflicts?: MergeConflict[]): void {
  db.prepare(`
    UPDATE merge_requests SET status = ?, conflicts = ? WHERE id = ?
  `).run(status, conflicts ? JSON.stringify(conflicts) : null, id);
}

export function markBranchMerged(branchId: string): void {
  db.prepare('UPDATE branches SET merged = 1 WHERE id = ?').run(branchId);
}

export { db };
