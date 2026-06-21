import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { initDatabase } from './database';
import {
  createWebSocketServer,
  handleCreateBranch,
  handleGetBranches,
  handleGetBranchHistory,
  handleCreateMergeRequest,
  handleGetMergeRequests,
  handleResolveMergeConflict,
  handleMergeRequest,
} from './websocket';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(cors());
app.use(express.json());

initDatabase();
createWebSocketServer(wss);

server.on('upgrade', (request, socket, head) => {
  console.log('WebSocket upgrade request:', request.url);
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

app.get('/api/branches', (req, res) => {
  try {
    const branches = handleGetBranches();
    res.json({ branches });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/branches', (req, res) => {
  try {
    const { name, parentBranchId, parentSnapshotVersion, createdBy } = req.body;
    if (!name || !parentBranchId || !parentSnapshotVersion || !createdBy) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const branch = handleCreateBranch(name, parentBranchId, parentSnapshotVersion, createdBy);
    res.json({ branch });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/branches/:branchId/history', (req, res) => {
  try {
    const { branchId } = req.params;
    const history = handleGetBranchHistory(branchId);
    res.json(history);
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

app.get('/api/merge-requests', (req, res) => {
  try {
    const mrs = handleGetMergeRequests();
    res.json({ mergeRequests: mrs });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/merge-requests', (req, res) => {
  try {
    const { sourceBranchId, targetBranchId, author } = req.body;
    if (!sourceBranchId || !targetBranchId || !author) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const mr = handleCreateMergeRequest(sourceBranchId, targetBranchId, author);
    res.json({ mergeRequest: mr });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/merge-requests/:id/resolve', (req, res) => {
  try {
    const { id } = req.params;
    const { nodeId, resolution } = req.body;
    if (!nodeId || !resolution) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = handleResolveMergeConflict(id, nodeId, resolution);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/merge-requests/:id/merge', (req, res) => {
  try {
    const { id } = req.params;
    const result = handleMergeRequest(id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});
