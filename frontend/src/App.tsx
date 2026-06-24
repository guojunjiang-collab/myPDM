import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuthStore } from './stores/auth';
import Layout from './components/Layout';
import { ToastContainer } from './components/Toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Board from './pages/Board';
import Parts from './pages/Parts';
import Components from './pages/Components';
import Documents from './pages/Documents';
import BOM from './pages/BOM/BOM';
import Users from './pages/Users';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import EC from './pages/EC';
import Configuration from './pages/Configuration';
import Inventory from './pages/Inventory';
import Projects from './pages/Project/Projects';
import DataManagement from './pages/DataManagement';
const STPViewer = lazy(() => import('./pages/STPViewer'));
const OfficeReader = lazy(() => import('./pages/OfficeReader'));

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
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/stp-viewer"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="w-screen h-screen flex items-center justify-center text-gray-400">加载中...</div>}>
                <STPViewer />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/office-reader"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="w-screen h-screen flex items-center justify-center text-gray-400">加载中...</div>}>
                <OfficeReader />
              </Suspense>
            </ProtectedRoute>
          }
        />
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
          <Route path="configuration" element={<Configuration />} />
          <Route path="bom" element={<BOM />} />
          <Route path="ec" element={<EC />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="projects" element={<Projects />} />
          <Route path="users" element={<Users />} />
          <Route path="logs" element={<Logs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="data-management" element={<DataManagement />} />
          <Route path="datamanagement" element={<DataManagement />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}