import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/contexts/auth-context";

import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Vehicles from "@/pages/vehicles";
import Riders from "@/pages/riders";
import Assignments from "@/pages/assignments";
import DailyLogs from "@/pages/daily-logs";
import Attendance from "@/pages/attendance";
import Handovers from "@/pages/handovers";
import PaySettings from "@/pages/pay-settings";
import VehicleQr from "@/pages/vehicle-qr";
import Maintenance from "@/pages/maintenance";
import Financials from "@/pages/financials";
import Salary from "@/pages/salary";
import Reports from "@/pages/reports";
import Expenses from "@/pages/expenses";
import CashCollection from "@/pages/cash-collection";
import Performance from "@/pages/performance";
import UsersPage from "@/pages/users";
import SystemLogs from "@/pages/system-logs";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  },
});

function ProtectedRoute({ component: Component, section, adminOnly }: { component: React.ComponentType; section?: string; adminOnly?: boolean }) {
  const { hasPermission, isAdmin } = useAuth();

  if (adminOnly && !isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">This section is restricted to administrators.</p>
        </div>
      </div>
    );
  }

  if (section && !hasPermission(section, "canView")) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">You don't have permission to view this section.</p>
        </div>
      </div>
    );
  }

  return <Component />;
}

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route path="/">
          <ProtectedRoute component={Dashboard} section="dashboard" />
        </Route>
        <Route path="/vehicles">
          <ProtectedRoute component={Vehicles} section="vehicles" />
        </Route>
        <Route path="/vehicle-qr">
          <ProtectedRoute component={VehicleQr} section="vehicles" />
        </Route>
        <Route path="/riders">
          <ProtectedRoute component={Riders} section="riders" />
        </Route>
        <Route path="/salary">
          <ProtectedRoute component={Salary} section="salary" />
        </Route>
        <Route path="/pay-settings">
          {/* Pay Engine config is salary domain — shares that permission section */}
          <ProtectedRoute component={PaySettings} section="salary" />
        </Route>
        <Route path="/assignments">
          <ProtectedRoute component={Assignments} section="assignments" />
        </Route>
        <Route path="/daily-logs">
          <ProtectedRoute component={DailyLogs} section="daily-logs" />
        </Route>
        <Route path="/attendance">
          <ProtectedRoute component={Attendance} section="attendance" />
        </Route>
        <Route path="/handovers">
          {/* Guard console — verifying handovers IS attendance editing, so it shares that section */}
          <ProtectedRoute component={Handovers} section="attendance" />
        </Route>
        <Route path="/maintenance">
          <ProtectedRoute component={Maintenance} section="maintenance" />
        </Route>
        <Route path="/expenses">
          <ProtectedRoute component={Expenses} section="expenses" />
        </Route>
        <Route path="/cash-collection">
          <ProtectedRoute component={CashCollection} section="cash-collection" />
        </Route>
        <Route path="/performance">
          <ProtectedRoute component={Performance} section="performance" />
        </Route>
        <Route path="/financials">
          <ProtectedRoute component={Financials} section="financials" />
        </Route>
        <Route path="/reports">
          <ProtectedRoute component={Reports} section="reports" />
        </Route>
        <Route path="/users">
          <ProtectedRoute component={UsersPage} adminOnly />
        </Route>
        <Route path="/system-logs">
          <ProtectedRoute component={SystemLogs} adminOnly />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
