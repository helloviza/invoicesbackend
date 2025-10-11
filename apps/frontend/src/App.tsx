// apps/frontend/src/App.tsx
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppBar, Box, Button, CssBaseline, Toolbar, CircularProgress, Alert } from "@mui/material";

import DashboardPage from "./pages/dashboard/DashboardPage";
import ImportPage from "./pages/import/ImportPage";
import InvoicePage from "./pages/InvoicePage";
import BillToPage from "./pages/billto/BillToPage";
import LoginPage from "./pages/LoginPage";
import HistoryPage from "./pages/history/HistoryPage";
import ProformaInvoicePage from "./pages/invoices/ProformaInvoicePage";
import AccessPage from "./pages/admin/AccessPage";
import { api } from "./api/client";

const JWT_KEY = "jwt";
const REDIRECT_KEY = "redirectAfterAuth";

/* ---------------- Error Boundary ---------------- */
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [err, setErr] = useState<Error | null>(null);
  useEffect(() => {
    const handler = (event: ErrorEvent) => setErr(event.error || new Error(event.message));
    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);
  if (err) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">Something went wrong: {String(err?.message || err)}</Alert>
      </Box>
    );
  }
  return <>{children}</>;
}

/* ---------------- Helpers ---------------- */
const navBtnSx = {
  borderColor: "rgba(255,255,255,0.45)",
  color: "#fff",
  "&:hover": { borderColor: "#fff", background: "rgba(255,255,255,0.08)" },
} as const;

type RoleKind = "admin" | "staff" | "guest";

function looksAdminFromStrings(email?: string, username?: string, role?: string) {
  const e = String(email ?? "").toLowerCase();
  const u = String(username ?? "").toLowerCase();
  const r = String(role ?? "").toLowerCase();
  return e === "admin@plumtrips.com" || u === "admin" || ["admin", "owner", "superadmin"].includes(r);
}

function parseJwtClaims(rawToken?: string): any | null {
  try {
    if (!rawToken) return null;
    const parts = rawToken.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(decodeURIComponent(escape(atob(payload))));
    return decoded && typeof decoded === "object" ? decoded : null;
  } catch {
    return null;
  }
}

function initialRoleFromJWT(): RoleKind {
  const jwt = localStorage.getItem(JWT_KEY) || "";
  const claims = parseJwtClaims(jwt) || {};
  const email =
    claims.email ||
    claims.user?.email ||
    claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];
  const username =
    claims.username || claims.preferred_username || claims.name || claims.user?.username;
  const role =
    claims.role ||
    claims.roles?.[0] ||
    claims["https://hasura.io/jwt/claims"]?.["x-hasura-default-role"] ||
    claims.user?.role;

  if (claims.isAdmin === true || looksAdminFromStrings(email, username, role)) return "admin";
  return jwt ? "staff" : "guest";
}

async function fetchMeAndDecideRole(): Promise<RoleKind> {
  try {
    const r = await api.get("/api/auth/me", { params: { t: Date.now() } });
    const me = r?.data ?? {};
    const user = me.user ?? me.data?.user ?? me.profile ?? me.account ?? me;
    const isAdmin =
      Boolean(user?.isAdmin) ||
      looksAdminFromStrings(user?.email, user?.username || user?.name, user?.role);
    return isAdmin ? "admin" : "staff";
  } catch {
    return initialRoleFromJWT();
  }
}

/* ---------------- Admin guard ---------------- */
function RequireAdmin({ role, children }: { role: RoleKind; children: React.ReactNode }) {
  if (role !== "admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/* ---------------- App ---------------- */
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [role, setRole] = useState<RoleKind>(initialRoleFromJWT());
  const [loadingMe, setLoadingMe] = useState(false);

  // Initial auth state
  useEffect(() => {
    setAuthed(Boolean(localStorage.getItem(JWT_KEY)));
  }, []);

  // Save intended route if unauthenticated user hits a protected route
  useEffect(() => {
    const isAuthPage = location.pathname === "/login";
    if (authed === false && !isAuthPage) {
      const intended = location.pathname + location.search;
      sessionStorage.setItem(REDIRECT_KEY, intended);
    }
  }, [authed, location.pathname, location.search]);

  // After login, bounce back to intended path
  useEffect(() => {
    if (authed) {
      const intended = sessionStorage.getItem(REDIRECT_KEY);
      if (intended) {
        sessionStorage.removeItem(REDIRECT_KEY);
        navigate(intended, { replace: true });
      }
    }
  }, [authed, navigate]);

  // Sync auth across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === JWT_KEY) {
        const has = Boolean(localStorage.getItem(JWT_KEY));
        setAuthed(has);
        setRole(has ? initialRoleFromJWT() : "guest");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Refine role
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authed) return;
      setLoadingMe(true);
      const decided = await fetchMeAndDecideRole();
      if (!cancelled) setRole(decided);
      setLoadingMe(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const handleLogout = () => {
    localStorage.removeItem(JWT_KEY);
    setAuthed(false);
    setRole("guest");
    navigate("/login", { replace: true });
  };

  const Header = useMemo(
    () => (
      <AppBar
        position="static"
        elevation={0}
        sx={{
          background: "linear-gradient(90deg, #00477f 0%, #0a6fb3 100%)",
          borderRadius: "0 0 18px 18px",
        }}
      >
        <Toolbar sx={{ gap: 12, minHeight: 64 }}>
          {/* Logo */}
          <Box
            component={Link}
            to={authed ? "/dashboard" : "/login"}
            sx={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
          >
            <img src="/assets/logo.png" alt="PlumTrips" style={{ height: 32, display: "block" }} />
          </Box>

          <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexGrow: 1 }}>
            {authed ? (
              <>
                <Button component={Link} to="/dashboard" variant="outlined" sx={navBtnSx}>
                  Dashboard
                </Button>
                <Button component={Link} to="/invoice" variant="outlined" sx={navBtnSx}>
                  Invoice
                </Button>
                <Button component={Link} to="/billto" variant="outlined" sx={navBtnSx}>
                  Bill-To
                </Button>
                <Button component={Link} to="/history" variant="outlined" sx={navBtnSx}>
                  History
                </Button>
                <Button component={Link} to="/import" variant="outlined" sx={navBtnSx}>
                  Import
                </Button>
                {role === "admin" && (
                  <Button component={Link} to="/access" variant="outlined" sx={navBtnSx}>
                    Access
                  </Button>
                )}
              </>
            ) : (
              <Button component={Link} to="/login" variant="outlined" sx={navBtnSx}>
                Login
              </Button>
            )}
          </Box>

          {authed ? (
            <Button onClick={handleLogout} sx={{ color: "#fff" }}>
              {loadingMe ? "…" : "Logout"}
            </Button>
          ) : null}
        </Toolbar>
      </AppBar>
    ),
    [authed, role, loadingMe]
  );

  return (
    <>
      <CssBaseline />
      {Header}

      {authed === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <ErrorBoundary>
          <Suspense
            fallback={
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            }
          >
            <Routes>
              {!authed ? (
                <>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="*" element={<Navigate to="/login" replace />} />
                </>
              ) : (
                <>
                  {/* Landing */}
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />

                  {/* Main */}
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/invoice" element={<InvoicePage />} />
                  <Route path="/billto" element={<BillToPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/import" element={<ImportPage />} />

                  {/* Proforma page — two routes */}
                  <Route path="/invoices/:id/proforma" element={<ProformaInvoicePage />} />
                  <Route path="/invoices/proforma" element={<ProformaInvoicePage />} />

                  {/* Admin-only */}
                  <Route
                    path="/access"
                    element={
                      <RequireAdmin role={role}>
                        <AccessPage />
                      </RequireAdmin>
                    }
                  />

                  {/* Fallbacks */}
                  <Route path="/invoices" element={<Navigate to="/invoice" replace />} />
                  <Route path="/login" element={<Navigate to="/dashboard" replace />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </>
              )}
            </Routes>
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}
