import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { MindMap } from './components/MindMap';
import { BranchesPage } from './pages/BranchesPage';
import { MergesPage } from './pages/MergesPage';
import type { Branch } from '../../shared/types';

function App() {
  const [userId, setUserId] = useState(() => {
    const saved = localStorage.getItem('mindmap-user');
    return saved || `用户${Math.floor(Math.random() * 10000)}`;
  });
  const [currentBranchId, setCurrentBranchId] = useState<string>('');
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [currentVersion, setCurrentVersion] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem('mindmap-user', userId);
  }, [userId]);

  useEffect(() => {
    fetchBranches();
  }, []);

  const API_BASE = 'http://localhost:3001';

  const fetchBranches = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/branches`);
      const data = await res.json();
      const branches: Branch[] = data.branches;
      
      if (branches.length > 0) {
        const mainBranch = branches.find((b) => b.isMain);
        if (mainBranch) {
          setCurrentBranchId(mainBranch.id);
          setCurrentBranch(mainBranch);
        }
      }
    } catch (error) {
      console.error('Failed to fetch branches:', error);
    }
  };

  const handleSelectBranch = async (branchId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/branches`);
      const data = await res.json();
      const branches: Branch[] = data.branches;
      const branch = branches.find((b) => b.id === branchId);
      if (branch) {
        setCurrentBranchId(branchId);
        setCurrentBranch(branch);
        navigate('/');
      }
    } catch (error) {
      console.error('Failed to select branch:', error);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🧠 协作思维导图</h1>
        <nav>
          <NavLink to="/" end>
            编辑器
          </NavLink>
          <NavLink to="/branches">分支</NavLink>
          <NavLink to="/merges">合并请求</NavLink>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {currentBranch && (
            <span className="branch-info">
              分支: {currentBranch.name}
            </span>
          )}
          <div className="user-list">
            <div className="user-avatar" title={userId}>
              {userId.slice(0, 2)}
            </div>
          </div>
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            currentBranchId ? (
              <MindMap
                key={currentBranchId}
                branchId={currentBranchId}
                userId={userId}
                currentVersion={currentVersion}
                onVersionChange={setCurrentVersion}
              />
            ) : (
              <div className="empty-state">加载中...</div>
            )
          }
        />
        <Route
          path="/branches"
          element={
            <BranchesPage
              userId={userId}
              onSelectBranch={handleSelectBranch}
              currentBranchId={currentBranchId}
            />
          }
        />
        <Route path="/merges" element={<MergesPage userId={userId} />} />
      </Routes>
    </div>
  );
}

export default App;
