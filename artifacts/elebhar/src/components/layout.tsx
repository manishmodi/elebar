import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { 
  LayoutDashboard, 
  Car, 
  Users, 
  CalendarDays, 
  ClipboardList, 
  Wrench, 
  BarChart3,
  Menu,
  X,
  Bell,
  Search,
  User,
  Wallet,
  LogOut,
  Settings,
  ScrollText,
  Banknote,
  Receipt,
  HandCoins,
  Trophy,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, section: "dashboard" },
  { href: "/daily-logs", label: "Daily Logs", icon: ClipboardList, section: "daily-logs" },
  { href: "/vehicles", label: "Vehicles", icon: Car, section: "vehicles" },
  { href: "/riders", label: "Riders", icon: Users, section: "riders" },
  { href: "/salary", label: "Salary", icon: Banknote, section: "salary" },
  { href: "/pay-settings", label: "Pay Settings", icon: Settings, section: "salary" },
  { href: "/assignments", label: "Assignments", icon: CalendarDays, section: "assignments" },
  { href: "/attendance", label: "Attendance", icon: CalendarDays, section: "attendance" },
  { href: "/handovers", label: "Handovers", icon: ShieldCheck, section: "attendance" },
  { href: "/maintenance", label: "Maintenance & Servicing", icon: Wrench, section: "maintenance" },
  { href: "/expenses", label: "Expenses", icon: Receipt, section: "expenses" },
  { href: "/cash-collection", label: "Cash Collection", icon: HandCoins, section: "cash-collection" },
  { href: "/performance", label: "Performance", icon: Trophy, section: "performance" },
  { href: "/financials", label: "Financials", icon: Wallet, section: "financials" },
  { href: "/reports", label: "Reports", icon: BarChart3, section: "reports" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { user, logout, hasPermission, isAdmin } = useAuth();

  const visibleNav = NAV_ITEMS.filter((item) => hasPermission(item.section, "canView"));

  const AdminNavLinks = () => {
    const isUsersActive = location === "/users";
    const isLogsActive = location === "/system-logs";
    return (
      <div className="px-3 mt-4 pt-4 border-t border-sidebar-border/30 space-y-1">
        <Link href="/users" onClick={() => setIsMobileOpen(false)} className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
          isUsersActive
            ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        )}>
          <Settings className={cn("w-5 h-5", isUsersActive ? "text-primary-foreground" : "text-sidebar-foreground/50")} />
          User Management
        </Link>
        <Link href="/system-logs" onClick={() => setIsMobileOpen(false)} className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
          isLogsActive
            ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        )}>
          <ScrollText className={cn("w-5 h-5", isLogsActive ? "text-primary-foreground" : "text-sidebar-foreground/50")} />
          System Logs
        </Link>
      </div>
    );
  };

  const Logo = () => (
    <div className="flex items-center gap-3 px-4 py-6">
      <img src={`${import.meta.env.BASE_URL}images/logo-icon.png`} alt="Elebhar Logo" className="w-8 h-8 object-contain" />
      <span className="font-display font-bold text-xl tracking-tight text-sidebar-foreground">
        Elebhar<span className="text-primary">FMS</span>
      </span>
    </div>
  );

  const NavLinks = () => (
    <nav className="flex-1 px-3 space-y-1 mt-4">
      {visibleNav.map((item) => {
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} onClick={() => setIsMobileOpen(false)} className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
            isActive 
              ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" 
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          )}>
            <item.icon className={cn("w-5 h-5", isActive ? "text-primary-foreground" : "text-sidebar-foreground/50")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const UserSection = () => (
    <div className="p-4 border-t border-sidebar-border/50">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
          <User className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-sidebar-foreground truncate">
            {user?.fullName}
          </p>
          <p className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</p>
        </div>
      </div>
      <button
        onClick={logout}
        className="mt-2 w-full flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground rounded-lg transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans">
      <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-border sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}images/logo-icon.png`} alt="Logo" className="w-6 h-6" />
          <span className="font-display font-bold text-lg">ElebharFMS</span>
        </div>
        <button onClick={() => setIsMobileOpen(true)} className="p-2 text-foreground">
          <Menu className="w-6 h-6" />
        </button>
      </div>

      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setIsMobileOpen(false)}
            />
            <motion.aside 
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="fixed inset-y-0 left-0 w-72 bg-sidebar border-r border-sidebar-border z-50 flex flex-col md:hidden"
            >
              <div className="flex items-center justify-between pr-4">
                <Logo />
                <button onClick={() => setIsMobileOpen(false)} className="p-2 text-sidebar-foreground/70 hover:text-sidebar-foreground rounded-lg hover:bg-sidebar-accent">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <NavLinks />
              {isAdmin && <AdminNavLinks />}
              <UserSection />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0">
        <Logo />
        <NavLinks />
        {isAdmin && <AdminNavLinks />}
        <UserSection />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="hidden md:flex h-16 bg-white border-b border-border items-center justify-between px-8 sticky top-0 z-20">
          <div className="flex-1 flex items-center">
            <div className="relative w-96">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="text" placeholder="Search riders, vehicles, logs..." className="w-full pl-9 pr-4 py-2 bg-muted/50 border-none rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full border-2 border-white"></span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-slate-50/50 p-4 md:p-8">
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
