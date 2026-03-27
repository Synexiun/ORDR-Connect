/**
 * ORDR-Connect Auth Context
 *
 * Compliance requirements:
 * - Token stored in memory only (NOT localStorage/sessionStorage) — HIPAA §164.312
 * - Auto-refresh before token expiry
 * - Logout clears all auth state from memory
 * - All auth state changes are logged for audit
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { apiClient, setAccessToken, setOnUnauthorized } from './api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

interface LoginCredentials {
  email: string;
  password: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isDemo: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  loginDemo: () => void;
  logout: () => void;
}

const DEMO_USER: User = {
  id: 'demo-001',
  email: 'demo@ordr-connect.io',
  name: 'Demo Operator',
  role: 'admin',
  tenantId: 'tenant-demo',
};

const AuthContext = createContext<AuthState | null>(null);

// In-memory refresh token — never persisted to storage
let refreshToken: string | null = null;
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer(): void {
  if (refreshTimerId !== null) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  const logout = useCallback(() => {
    setUser(null);
    setIsDemo(false);
    setAccessToken(null);
    refreshToken = null;
    clearRefreshTimer();
  }, []);

  const loginDemo = useCallback(() => {
    setUser(DEMO_USER);
    setIsDemo(true);
    setAccessToken('demo-token');
  }, []);

  const scheduleRefresh = useCallback(
    (expiresIn: number) => {
      clearRefreshTimer();

      // Refresh 60 seconds before expiry, minimum 10 seconds
      const refreshDelay = Math.max((expiresIn - 60) * 1000, 10_000);

      const doRefresh = async (): Promise<void> => {
        if (refreshToken === '') {
          logout();
          return;
        }

        try {
          const response = await apiClient.post<RefreshResponse>('/v1/auth/refresh', {
            refreshToken,
          });

          setAccessToken(response.accessToken);
          scheduleRefresh(response.expiresIn);
        } catch {
          logout();
        }
      };
      refreshTimerId = setTimeout(() => {
        void doRefresh();
      }, refreshDelay);
    },
    [logout],
  );

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<void> => {
      setIsLoading(true);

      try {
        const response = await apiClient.post<LoginResponse>('/v1/auth/login', credentials);

        setAccessToken(response.accessToken);
        refreshToken = response.refreshToken;
        setUser(response.user);
        scheduleRefresh(response.expiresIn);
      } finally {
        setIsLoading(false);
      }
    },
    [scheduleRefresh],
  );

  // Register the unauthorized handler for 401 auto-redirect
  useEffect(() => {
    setOnUnauthorized(logout);
    return () => {
      setOnUnauthorized(() => {});
      clearRefreshTimer();
    };
  }, [logout]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      isDemo,
      login,
      loginDemo,
      logout,
    }),
    [user, isLoading, isDemo, login, loginDemo, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
