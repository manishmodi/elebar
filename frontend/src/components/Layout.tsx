import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth";
import type { Section } from "@/lib/types";

interface NavItem {
  to: string;
  label: string;
  section?: Section;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", section: "dashboard" },
  { to: "/riders", label: "Riders", section: "riders" },
  { to: "/vehicles", label: "Vehicles", section: "vehicles" },
  { to: "/assignments", label: "Assignments", section: "assignments" },
  { to: "/daily-logs", label: "Daily Logs", section: "daily-logs" },
  { to: "/attendance", label: "Attendance", section: "attendance" },
  { to: "/handovers", label: "Handovers", section: "attendance" },
  { to: "/maintenance", label: "Maintenance", section: "maintenance" },
  { to: "/expenses", label: "Expenses", section: "expenses" },
  { to: "/cash-collection", label: "Cash Collection", section: "cash-collection" },
  { to: "/salary", label: "Salary", section: "salary" },
  { to: "/pay-settings", label: "Pay Settings", section: "salary" },
  { to: "/performance", label: "Performance", section: "performance" },
  { to: "/financials", label: "Financials", section: "financials" },
  { to: "/reports", label: "Reports", section: "reports" },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: "/users", label: "Users", adminOnly: true },
  { to: "/system-logs", label: "System Logs", adminOnly: true },
];

export function Layout() {
  const { user, isAdmin, hasPermission, logout } = useAuth();
  const navigate = useNavigate();

  const visibleItems = NAV_ITEMS.filter((item) => !item.section || hasPermission(item.section, "view"));

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">SF</span>
          <span className="brand-name">Sherpa Fleet</span>
        </div>
        <nav className="sidebar-nav">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
          {isAdmin && (
            <>
              <div className="sidebar-section-title">Admin</div>
              {ADMIN_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <div className="header-spacer" />
          <div className="header-user">
            <span className="user-name">{user?.full_name}</span>
            <span className="user-role">{isAdmin ? "Administrator" : "Staff"}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
