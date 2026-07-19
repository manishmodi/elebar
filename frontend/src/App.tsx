import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Riders } from "@/pages/Riders";
import { Vehicles } from "@/pages/Vehicles";
import { Assignments } from "@/pages/Assignments";
import { DailyLogs } from "@/pages/DailyLogs";
import { Attendance } from "@/pages/Attendance";
import { Handovers } from "@/pages/Handovers";
import { Maintenance } from "@/pages/Maintenance";
import { Expenses } from "@/pages/Expenses";
import { CashCollection } from "@/pages/CashCollection";
import { Salary } from "@/pages/Salary";
import { PaySettings } from "@/pages/PaySettings";
import { Performance } from "@/pages/Performance";
import { Financials } from "@/pages/Financials";
import { Reports } from "@/pages/Reports";
import { Users } from "@/pages/Users";
import { SystemLogs } from "@/pages/SystemLogs";
import { NotFound } from "@/pages/NotFound";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={!loading && isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <ProtectedRoute section="dashboard">
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="riders"
          element={
            <ProtectedRoute section="riders">
              <Riders />
            </ProtectedRoute>
          }
        />
        <Route
          path="vehicles"
          element={
            <ProtectedRoute section="vehicles">
              <Vehicles />
            </ProtectedRoute>
          }
        />
        <Route
          path="assignments"
          element={
            <ProtectedRoute section="assignments">
              <Assignments />
            </ProtectedRoute>
          }
        />
        <Route
          path="daily-logs"
          element={
            <ProtectedRoute section="daily-logs">
              <DailyLogs />
            </ProtectedRoute>
          }
        />
        <Route
          path="attendance"
          element={
            <ProtectedRoute section="attendance">
              <Attendance />
            </ProtectedRoute>
          }
        />
        <Route
          path="handovers"
          element={
            <ProtectedRoute section="attendance">
              <Handovers />
            </ProtectedRoute>
          }
        />
        <Route
          path="maintenance"
          element={
            <ProtectedRoute section="maintenance">
              <Maintenance />
            </ProtectedRoute>
          }
        />
        <Route
          path="expenses"
          element={
            <ProtectedRoute section="expenses">
              <Expenses />
            </ProtectedRoute>
          }
        />
        <Route
          path="cash-collection"
          element={
            <ProtectedRoute section="cash-collection">
              <CashCollection />
            </ProtectedRoute>
          }
        />
        <Route
          path="salary"
          element={
            <ProtectedRoute section="salary">
              <Salary />
            </ProtectedRoute>
          }
        />
        <Route
          path="pay-settings"
          element={
            <ProtectedRoute section="salary">
              <PaySettings />
            </ProtectedRoute>
          }
        />
        <Route
          path="performance"
          element={
            <ProtectedRoute section="performance">
              <Performance />
            </ProtectedRoute>
          }
        />
        <Route
          path="financials"
          element={
            <ProtectedRoute section="financials">
              <Financials />
            </ProtectedRoute>
          }
        />
        <Route
          path="reports"
          element={
            <ProtectedRoute section="reports">
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute adminOnly>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="system-logs"
          element={
            <ProtectedRoute adminOnly>
              <SystemLogs />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
