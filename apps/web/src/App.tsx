import { type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './components/ThemeProvider';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { Interactions } from './pages/Interactions';
import { AgentActivity } from './pages/AgentActivity';
import { Compliance } from './pages/Compliance';
import { Analytics } from './pages/Analytics';
import { Notifications } from './pages/Notifications';
import { Settings } from './pages/Settings';
import { Marketplace } from './pages/Marketplace';
import { DeveloperConsole } from './pages/DeveloperConsole';
import { HealthcareDashboard } from './pages/HealthcareDashboard';
import { PartnerDashboard } from './pages/PartnerDashboard';

/**
 * Protected route wrapper — redirects to /login when unauthenticated.
 * Token is in-memory only (HIPAA §164.312 — no browser storage).
 */
function ProtectedRoute({ children }: { children: ReactNode }): ReactNode {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

/**
 * Guest route wrapper — redirects to /dashboard when already authenticated.
 */
function GuestRoute({ children }: { children: ReactNode }): ReactNode {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export function App(): ReactNode {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
        <Routes>
          {/* Public */}
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />

          {/* Protected — inside Layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/interactions" element={<Interactions />} />
            <Route path="/agents" element={<AgentActivity />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/developer" element={<DeveloperConsole />} />
            <Route path="/healthcare" element={<HealthcareDashboard />} />
            <Route path="/partner" element={<PartnerDashboard />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
