import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/api";
import type { LoginResponse, Section, SectionPermission, User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  hasPermission: (section: Section, action: keyof SectionPermission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      if (!getAccessToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<User>("/api/auth/me/");
        setUser(me);
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    };
    void bootstrap();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.post<LoginResponse>("/api/auth/login/", { email, password });
    setTokens(data.access, data.refresh);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      // Send the refresh token so the server can blacklist it.
      await api.post("/api/auth/logout/", { refresh: getRefreshToken() ?? "" });
    } catch {
      // ignore network errors on logout
    }
    clearTokens();
    setUser(null);
  };

  const hasPermission = (section: Section, action: keyof SectionPermission): boolean => {
    if (!user) return false;
    if (user.is_admin) return true;
    const perm = user.permissions?.[section];
    return Boolean(perm?.[action]);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isAdmin: Boolean(user?.is_admin),
      loading,
      hasPermission,
      login,
      logout,
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
