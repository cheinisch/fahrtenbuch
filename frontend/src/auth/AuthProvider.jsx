import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  refresh as refreshRequest,
} from "../api/auth.js";

const STORAGE_KEY = "fahrtenbuch.auth";
const AuthContext = createContext(null);

function clearStoredAuth() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

function readStoredAuth() {
  const localValue =
    localStorage.getItem(STORAGE_KEY);
  const sessionValue =
    sessionStorage.getItem(STORAGE_KEY);

  const rawValue = localValue || sessionValue;

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    clearStoredAuth();
    return null;
  }
}

function storeAuth(auth, remember) {
  clearStoredAuth();

  const storage = remember
    ? localStorage
    : sessionStorage;

  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...auth,
      remember,
    }),
  );
}

function applyTheme(themeMode) {
  const root = document.documentElement;

  if (
    themeMode === "light" ||
    themeMode === "dark"
  ) {
    root.dataset.theme = themeMode;
  } else {
    delete root.dataset.theme;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    applyTheme(auth?.user?.themeMode || "system");
  }, [auth?.user?.themeMode]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const storedAuth = readStoredAuth();

      if (!storedAuth) {
        if (!cancelled) {
          setLoading(false);
        }

        return;
      }

      try {
        const user = await getCurrentUser(
          storedAuth.accessToken,
        );

        const restoredAuth = {
          ...storedAuth,
          user,
        };

        storeAuth(
          restoredAuth,
          storedAuth.remember,
        );

        if (!cancelled) {
          setAuth(restoredAuth);
        }
      } catch (error) {
        if (
          error.status === 401 &&
          storedAuth.refreshToken
        ) {
          try {
            const tokens = await refreshRequest(
              storedAuth.refreshToken,
            );

            const user = await getCurrentUser(
              tokens.accessToken,
            );

            const refreshedAuth = {
              ...storedAuth,
              ...tokens,
              user,
            };

            storeAuth(
              refreshedAuth,
              storedAuth.remember,
            );

            if (!cancelled) {
              setAuth(refreshedAuth);
            }
          } catch {
            clearStoredAuth();
          }
        } else {
          clearStoredAuth();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(credentials, remember) {
    const result = await loginRequest(credentials);

    const nextAuth = {
      ...result,
      remember,
    };

    storeAuth(nextAuth, remember);
    setAuth(nextAuth);

    return result.user;
  }

  function updateUser(user) {
    setAuth((current) => {
      if (!current) {
        return current;
      }

      const nextAuth = {
        ...current,
        user,
      };

      storeAuth(
        nextAuth,
        current.remember,
      );

      return nextAuth;
    });
  }

  async function signOut() {
    try {
      if (auth?.accessToken) {
        await logoutRequest(auth.accessToken);
      }
    } catch {
      // Die lokale Sitzung wird trotzdem entfernt.
    } finally {
      clearStoredAuth();
      setAuth(null);
    }
  }

  const value = useMemo(
    () => ({
      user: auth?.user || null,
      accessToken:
        auth?.accessToken || null,
      isAuthenticated: Boolean(
        auth?.accessToken && auth?.user,
      ),
      loading,
      signIn,
      signOut,
      updateUser,
    }),
    [auth, loading],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth muss innerhalb des AuthProvider verwendet werden.",
    );
  }

  return context;
}
