import { type ReactNode, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './components/ThemeProvider';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Onboarding } from './pages/Onboarding';
import { Spinner } from './components/ui/Spinner';

const OpsCenter = lazy(() => import('./pages/OpsCenter').then((m) => ({ default: m.OpsCenter })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Customers = lazy(() => import('./pages/Customers').then((m) => ({ default: m.Customers })));
const CustomerDetail = lazy(() =>
  import('./pages/CustomerDetail').then((m) => ({ default: m.CustomerDetail })),
);
const Interactions = lazy(() =>
  import('./pages/Interactions').then((m) => ({ default: m.Interactions })),
);
const AgentActivity = lazy(() =>
  import('./pages/AgentActivity').then((m) => ({ default: m.AgentActivity })),
);
const Compliance = lazy(() =>
  import('./pages/Compliance').then((m) => ({ default: m.Compliance })),
);
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const Notifications = lazy(() =>
  import('./pages/Notifications').then((m) => ({ default: m.Notifications })),
);
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Marketplace = lazy(() =>
  import('./pages/Marketplace').then((m) => ({ default: m.Marketplace })),
);
const DeveloperConsole = lazy(() =>
  import('./pages/DeveloperConsole').then((m) => ({ default: m.DeveloperConsole })),
);
const HealthcareDashboard = lazy(() =>
  import('./pages/HealthcareDashboard').then((m) => ({ default: m.HealthcareDashboard })),
);
const PartnerDashboard = lazy(() =>
  import('./pages/PartnerDashboard').then((m) => ({ default: m.PartnerDashboard })),
);
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const ReportBuilder = lazy(() =>
  import('./pages/ReportBuilder').then((m) => ({ default: m.ReportBuilder })),
);
const ReportView = lazy(() =>
  import('./pages/ReportView').then((m) => ({ default: m.ReportView })),
);
const ScheduledReports = lazy(() =>
  import('./pages/ScheduledReports').then((m) => ({ default: m.ScheduledReports })),
);
const HelpCenter = lazy(() =>
  import('./pages/HelpCenter').then((m) => ({ default: m.HelpCenter })),
);
const HelpArticle = lazy(() =>
  import('./pages/HelpArticle').then((m) => ({ default: m.HelpArticlePage })),
);
const HelpCategoryPage = lazy(() =>
  import('./pages/HelpCategoryPage').then((m) => ({ default: m.HelpCategoryPage })),
);
const Tickets = lazy(() => import('./pages/Tickets').then((m) => ({ default: m.Tickets })));
const TicketDetail = lazy(() =>
  import('./pages/TicketDetail').then((m) => ({ default: m.TicketDetail })),
);
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const TeamManagement = lazy(() =>
  import('./pages/TeamManagement').then((m) => ({ default: m.TeamManagement })),
);
const SampleDashboard = lazy(() =>
  import('./pages/SampleDashboard').then((m) => ({ default: m.SampleDashboard })),
);
const AuditLog = lazy(() => import('./pages/AuditLog').then((m) => ({ default: m.AuditLog })));
const Workflows = lazy(() => import('./pages/Workflows').then((m) => ({ default: m.Workflows })));
const Integrations = lazy(() =>
  import('./pages/Integrations').then((m) => ({ default: m.Integrations })),
);
const SchedulerMonitor = lazy(() =>
  import('./pages/SchedulerMonitor').then((m) => ({ default: m.SchedulerMonitor })),
);
const Billing = lazy(() => import('./pages/Billing').then((m) => ({ default: m.Billing })));
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })));
const SlaMonitor = lazy(() =>
  import('./pages/SlaMonitor').then((m) => ({ default: m.SlaMonitor })),
);
const DsrManagement = lazy(() =>
  import('./pages/DsrManagement').then((m) => ({ default: m.DsrManagement })),
);

// Demo pages — public, dark topology aesthetic
const DemoLayout = lazy(() =>
  import('./pages/demo/DemoLayout').then((m) => ({ default: m.DemoLayout })),
);
const DemoOperations = lazy(() =>
  import('./pages/demo/DemoOperations').then((m) => ({ default: m.DemoOperations })),
);
const DemoAgentRuntime = lazy(() =>
  import('./pages/demo/DemoAgentRuntime').then((m) => ({ default: m.DemoAgentRuntime })),
);
const DemoCustomerIntel = lazy(() =>
  import('./pages/demo/DemoCustomerIntel').then((m) => ({ default: m.DemoCustomerIntel })),
);
const DemoChannelCommand = lazy(() =>
  import('./pages/demo/DemoChannelCommand').then((m) => ({ default: m.DemoChannelCommand })),
);
const DemoCompliance = lazy(() =>
  import('./pages/demo/DemoCompliance').then((m) => ({ default: m.DemoCompliance })),
);
const DemoEventStream = lazy(() =>
  import('./pages/demo/DemoEventStream').then((m) => ({ default: m.DemoEventStream })),
);
const DemoAnalytics = lazy(() =>
  import('./pages/demo/DemoAnalytics').then((m) => ({ default: m.DemoAnalytics })),
);

function PageLoader(): ReactNode {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner size="lg" label="Loading" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }): ReactNode {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function GuestRoute({ children }: { children: ReactNode }): ReactNode {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

export function App(): ReactNode {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public */}
              <Route path="/" element={<Landing />} />
              <Route
                path="/login"
                element={
                  <GuestRoute>
                    <Login />
                  </GuestRoute>
                }
              />

              {/* Protected — full-screen (no Layout shell) */}
              <Route
                path="/onboarding"
                element={
                  <ProtectedRoute>
                    <Onboarding />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/ops"
                element={
                  <ProtectedRoute>
                    <OpsCenter />
                  </ProtectedRoute>
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
                <Route path="/reports" element={<Reports />} />
                <Route path="/reports/builder" element={<ReportBuilder />} />
                <Route path="/reports/:id" element={<ReportView />} />
                <Route path="/reports/scheduled" element={<ScheduledReports />} />
                <Route path="/help" element={<HelpCenter />} />
                <Route path="/help/article/:slug" element={<HelpArticle />} />
                <Route path="/help/category/:categoryId" element={<HelpCategoryPage />} />
                <Route path="/tickets" element={<Tickets />} />
                <Route path="/tickets/:id" element={<TicketDetail />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/team" element={<TeamManagement />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route path="/integrations" element={<Integrations />} />
                <Route path="/scheduler" element={<SchedulerMonitor />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/search" element={<Search />} />
                <Route path="/sla" element={<SlaMonitor />} />
                <Route path="/dsr" element={<DsrManagement />} />
              </Route>

              {/* Public demo — full ORDR-Connect experience */}
              <Route path="/demo" element={<DemoLayout />}>
                <Route index element={<DemoOperations />} />
                <Route path="agents" element={<DemoAgentRuntime />} />
                <Route path="customers" element={<DemoCustomerIntel />} />
                <Route path="channels" element={<DemoChannelCommand />} />
                <Route path="compliance" element={<DemoCompliance />} />
                <Route path="events" element={<DemoEventStream />} />
                <Route path="analytics" element={<DemoAnalytics />} />
              </Route>

              {/* Legacy sample demo */}
              <Route path="/demo/sample" element={<SampleDashboard />} />

              {/* Catch-all */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
