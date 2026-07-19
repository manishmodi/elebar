import type { ReactNode } from "react";
import { useAuth } from "@/contexts/auth";
import type { Section, SectionPermission } from "@/lib/types";

interface ProtectedRouteProps {
  section?: Section;
  action?: keyof SectionPermission;
  adminOnly?: boolean;
  children: ReactNode;
}

export function ProtectedRoute({ section, action = "view", adminOnly, children }: ProtectedRouteProps) {
  const { isAdmin, hasPermission, loading } = useAuth();

  if (loading) {
    return <div className="page-loading">Loading…</div>;
  }

  if (adminOnly && !isAdmin) {
    return <AccessDenied />;
  }

  if (section && !hasPermission(section, action)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

function AccessDenied() {
  return (
    <div className="access-denied">
      <h2>Access denied</h2>
      <p>You do not have permission to view this section. Contact an administrator if you need access.</p>
    </div>
  );
}
