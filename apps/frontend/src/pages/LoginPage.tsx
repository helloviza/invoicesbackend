// apps/frontend/src/pages/LoginPage.tsx
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  TextField,
  Typography,
} from "@mui/material";

export type LoginPageProps = {
  /** Optional callback fired after we store the JWT. */
  onLoggedIn?: () => void;
};

type FieldErrors = Record<string, string[] | undefined>;

const JWT_KEY = "jwt";

export default function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [identifier, setIdentifier] = useState(""); // username or email
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const isEmail = (v: string) => /\S+@\S+\.\S+/.test(v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const id = identifier.trim();

      // Backend now requires `username`. We always send it.
      // If the user typed an email, also send `email` to satisfy validators that accept either.
      const body: Record<string, any> = {
        username: id,
        password,
      };
      if (isEmail(id)) body.email = id;

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      // Try to parse JSON either way (many error responses are JSON)
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // ignore; could be plain text
      }

      // Handle non-2xx or { ok:false } zod-style payloads
      if (!res.ok || (data && data.ok === false)) {
        const fErrs: FieldErrors =
          data?.errors?.fieldErrors || // zod-style
          {};
        setFieldErrors(fErrs);

        const topMsg =
          data?.message ||
          data?.error ||
          // zod style form errors
          (Array.isArray(data?.errors?.formErrors) && data.errors.formErrors.join(", ")) ||
          // join first messages from fieldErrors
          Object.values(fErrs)
            ?.flat()
            ?.join(", ") ||
          `Login failed (${res.status})`;

        throw new Error(topMsg);
      }

      // Success: extract token from common shapes
      let token: string =
        data?.token ||
        data?.jwt ||
        data?.accessToken ||
        data?.idToken ||
        data?.data?.token ||
        data?.data?.jwt ||
        "";
      if (!token) {
        // If backend returned plain text token
        try {
          const txt = typeof data === "string" ? data : "";
          token = txt?.trim();
        } catch {}
      }
      if (!token) throw new Error("No token returned by server.");

      localStorage.setItem(JWT_KEY, token);

      // Prefer SPA callback; otherwise hard redirect (bulletproof)
      if (typeof onLoggedIn === "function") onLoggedIn();
      else window.location.replace("/invoices/new");
    } catch (err: any) {
      setError(err?.message || "Login failed");
      setSubmitting(false);
    }
  };

  const usernameError =
    fieldErrors.username?.[0] ||
    fieldErrors.email?.[0] || // some backends may key errors on email
    "";

  const passwordError = fieldErrors.password?.[0] || "";

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 64px)",
        background:
          "radial-gradient(1200px 500px at 80% -20%, rgba(208,101,73,0.18), transparent 60%), linear-gradient(180deg, #f6f9fc 0%, #ffffff 30%, #f6f9fc 100%)",
        display: "flex",
        alignItems: "center",
      }}
    >
      <Container maxWidth="sm">
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3.5, sm: 5 },
            borderRadius: 4,
            backdropFilter: "blur(8px)",
            backgroundColor: "rgba(255,255,255,0.85)",
            boxShadow:
              "0 20px 60px rgba(0,0,0,0.08), 0 6px 18px rgba(0,0,0,0.06)",
          }}
        >
          <Typography variant="h5" sx={{ mb: 2, fontWeight: 700, color: "#0b2a43" }}>
            Sign in
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2, bgcolor: "#fff" }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <TextField
              fullWidth
              label="Username or Email"
              // Important: allow usernames (not just emails)
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
              error={Boolean(usernameError)}
              helperText={usernameError || " "}
              sx={{
                mb: 2,
                "& .MuiInputBase-root": {
                  borderRadius: 2,
                  background: "rgba(0,71,127,0.06)",
                },
              }}
            />

            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              error={Boolean(passwordError)}
              helperText={passwordError || " "}
              sx={{
                mb: 3,
                "& .MuiInputBase-root": {
                  borderRadius: 2,
                  background: "rgba(0,71,127,0.06)",
                },
              }}
            />

            <Button
              fullWidth
              type="submit"
              disabled={submitting}
              sx={{
                py: 1.2,
                borderRadius: 2,
                fontWeight: 700,
                letterSpacing: 0.2,
                background: "linear-gradient(90deg, #00477f 0%, #0a6fb3 100%)",
                color: "#fff",
                "&:hover": {
                  background: "linear-gradient(90deg, #003e6e 0%, #0a62a0 100%)",
                },
                boxShadow:
                  "0 8px 20px rgba(0,71,127,0.35), 0 3px 8px rgba(0,71,127,0.25)",
              }}
            >
              {submitting ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : "Sign in"}
            </Button>

            <Typography
              variant="body2"
              sx={{ mt: 2, color: "rgba(0,0,0,0.54)", textAlign: "center" }}
            >
              Need access? Contact your administrator.
            </Typography>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
