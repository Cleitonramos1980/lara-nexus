import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type LaraUserPerfil = "ADMIN" | "FINANCEIRO" | "OPERACIONAL" | "CONSULTA" | "MEDICO_TRABALHO" | "SESMT" | "DIRETOR_EXECUTIVO_SST";

export type LaraUser = {
  id: string;
  nome: string;
  email: string;
  perfil: LaraUserPerfil;
};

type AuthContextValue = {
  user: LaraUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
};

const TOKEN_KEY = "lara_auth_token";
const USER_KEY = "lara_auth_user";
const API_BASE = (import.meta.env.VITE_LARA_API_BASE_URL || "/api").replace(/\/+$/, "");

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
    return JSON.parse(atob(`${payload}${padding}`)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return payload.exp <= Math.floor(Date.now() / 1000);
}

function userFromToken(token: string): LaraUser | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  if (isTokenExpired(token)) return null;
  return {
    id: String(payload.sub ?? ""),
    nome: String(payload.nome ?? ""),
    email: String(payload.email ?? ""),
    perfil: (payload.perfil as LaraUserPerfil) ?? "CONSULTA",
  };
}

function getDefaultUser(): LaraUser | null {
  const defaultRole = String(import.meta.env.VITE_LARA_DEFAULT_ROLE ?? "").trim() as LaraUserPerfil;
  if (!defaultRole) return null;
  return { id: "default", nome: "Usuário", email: "", perfil: defaultRole };
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  login: async () => {},
  logout: () => {},
  isLoading: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LaraUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && !isTokenExpired(token)) {
      const resolved = userFromToken(token);
      if (resolved) {
        setUser(resolved);
        setIsLoading(false);
        return;
      }
    }
    // Token ausente ou expirado — usar perfil padrão do env
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(getDefaultUser());
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.error?.message ?? "Credenciais inválidas.");
    }
    const data = (await res.json()) as { token: string; user: LaraUser };
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(getDefaultUser());
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthUser(): LaraUser | null {
  return useContext(AuthContext).user;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// Leitura síncrona do perfil — para uso fora de componentes React (em permissions.ts)
export function getCurrentUserPerfil(): LaraUserPerfil {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && !isTokenExpired(token)) {
      const u = userFromToken(token);
      if (u) return u.perfil;
    }
    const stored = localStorage.getItem(USER_KEY);
    if (stored) {
      const u = JSON.parse(stored) as LaraUser;
      if (u?.perfil) return u.perfil;
    }
  } catch {
    // ignore
  }
  const defaultRole = String(import.meta.env.VITE_LARA_DEFAULT_ROLE ?? "ADMIN").trim() as LaraUserPerfil;
  return defaultRole || "ADMIN";
}
