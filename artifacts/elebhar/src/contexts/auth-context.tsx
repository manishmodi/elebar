import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type PermissionSet = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type Permissions = Record<string, PermissionSet>;

export type AuthUser = {
  id: number;
  fullName: string;
  email: string;
};

type AuthState = {
  user: AuthUser | null;
  permissions: Permissions;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (section: string, action: keyof PermissionSet) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

const API_BASE = `${import.meta.env.BASE_URL}api`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Permissions>({});
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setPermissions(data.permissions);
      } else {
        setUser(null);
        setPermissions({});
      }
    } catch {
      setUser(null);
      setPermissions({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    }

    const data = await res.json();
    setUser(data.user);
    setPermissions(data.permissions);
  };

  const logout = async () => {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    setPermissions({});
  };

  const hasPermission = (section: string, action: keyof PermissionSet): boolean => {
    return permissions[section]?.[action] ?? false;
  };

  const isAdmin = Object.keys(permissions).length > 0 &&
    Object.values(permissions).every((p) => p.canView && p.canCreate && p.canEdit && p.canDelete);

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        isLoading,
        isAuthenticated: !!user,
        isAdmin,
        login,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
