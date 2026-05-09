import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Board from './pages/Board';
import Parts from './pages/Parts';
import Components from './pages/Components';
import Documents from './pages/Documents';
import BOM from './pages/BOM';
import Users from './pages/Users';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import ECN from './pages/ECN';
import Inventory from './pages/Inventory';
import Business from './pages/Business';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="board" element={<Board />} />
          <Route path="parts" element={<Parts />} />
          <Route path="components" element={<Components />} />
          <Route path="documents" element={<Documents />} />
          <Route path="bom" element={<BOM />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="ecn" element={<ECN />} />
          <Route path="business" element={<Business />} />
          <Route path="users" element={<Users />} />
          <Route path="logs" element={<Logs />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}