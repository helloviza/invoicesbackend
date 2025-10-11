import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  alpha,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/PersonAddAlt1";
import KeyIcon from "@mui/icons-material/VpnKey";
import ShieldIcon from "@mui/icons-material/Security";
import ToggleOnIcon from "@mui/icons-material/ToggleOn";
import ToggleOffIcon from "@mui/icons-material/ToggleOff";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { api } from "../../api/client";
import RequireAuth from "../../components/RequireAuth";

type Role = "admin" | "staff";

type UserRow = {
  id: string;
  email: string;
  name?: string;
  role: Role;
  isActive: boolean;
  createdAt?: string;
  lastLoginAt?: string;
};

const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])[^\s]{6,18}$/;

const validPassword = (s: string) => PASSWORD_RE.test(s);

const policyHint =
  "6–18 chars, include 1 uppercase, 1 lowercase, 1 number and 1 special character.";

function maskEmail(e: string) {
  const [u, d] = e.split("@");
  if (!u || !d) return e;
  return `${u[0]}***@${d}`;
}

function useUsers() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await api.get("/api/users");
      const list = Array.isArray(r.data) ? r.data : r.data?.items || r.data?.rows || [];
      const mapped: UserRow[] = list.map((u: any) => ({
        id: String(u.id ?? u._id ?? ""),
        email: String(u.email ?? ""),
        name: u.name ?? u.fullName ?? u.displayName ?? "",
        role: (String(u.role ?? (u.isAdmin ? "admin" : "staff")) as Role) || "staff",
        isActive: (u.isActive ?? u.active ?? u.enabled ?? true) ? true : false,
        createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : undefined,
        lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : undefined,
      }));
      setRows(mapped);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || "Failed to load users");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { rows, loading, err, load, setRows, setErr };
}

export default function AccessPage() {
  const theme = useTheme();
  const { rows, loading, err, load, setRows, setErr } = useUsers();

  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const k = q.toLowerCase();
    return rows.filter((r) =>
      [r.name, r.email, r.role, r.createdAt, r.lastLoginAt]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k))
    );
  }, [q, rows]);

  return (
    <RequireAuth>
      <Container maxWidth="lg" sx={{ px: { xs: 2, md: 3, xl: 4 }, py: 3 }}>
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 2,
            borderRadius: 3,
            background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, transparent 100%)`,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems="center">
            <Typography variant="h6" fontWeight={800} sx={{ flexGrow: 1 }}>
              Access Management
            </Typography>
            <TextField
              size="small"
              placeholder="Search name/email/role…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              sx={{ minWidth: 260 }}
            />
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={load}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreating(true)}
            >
              New User
            </Button>
          </Stack>
        </Paper>

        {!!err && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
          </Alert>
        )}

        <Paper sx={{ p: 0, borderRadius: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Last Login</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length ? (
                filtered.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      <Stack spacing={0.4}>
                        <Typography fontWeight={700}>{u.name || "(no name)"}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.65 }}>
                          ID: {u.id}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{u.email ? maskEmail(u.email) : "-"}</TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={u.role}
                        onChange={async (e) => {
                          const role = e.target.value as Role;
                          try {
                            await tryRequests([
                              () => api.patch(`/api/users/${u.id}`, { role }),
                              () => api.put(`/api/users/${u.id}`, { role }),
                              () => api.post(`/api/users/${u.id}`, { role }),
                              () => api.post(`/api/admin/users/${u.id}/role`, { role }),
                            ]);
                            setRows((xs) => xs.map((r) => (r.id === u.id ? { ...r, role } : r)));
                          } catch (err2: any) {
                            setErr(err2?.response?.data?.message || err2?.message || "Update failed");
                          }
                        }}
                        sx={{ minWidth: 120 }}
                      >
                        <MenuItem value="admin">Admin</MenuItem>
                        <MenuItem value="staff">Staff</MenuItem>
                      </TextField>
                    </TableCell>
                    <TableCell>
                      {u.isActive ? (
                        <Chip size="small" color="success" label="Active" />
                      ) : (
                        <Chip size="small" color="default" label="Disabled" />
                      )}
                    </TableCell>
                    <TableCell>{u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}</TableCell>
                    <TableCell>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "-"}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Reset password">
                        <IconButton onClick={() => setResetFor(u)} size="small">
                          <KeyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={u.isActive ? "Disable" : "Enable"}>
                        <IconButton
                          size="small"
                          onClick={async () => {
                            const isActive = !u.isActive;
                            try {
                              await tryRequests([
                                () => api.patch(`/api/users/${u.id}`, { isActive }),
                                () => api.put(`/api/users/${u.id}`, { isActive }),
                                () => api.post(`/api/users/${u.id}`, { isActive }),
                                () =>
                                  api.post(`/api/admin/users/${u.id}/${isActive ? "enable" : "disable"}`),
                              ]);
                              setRows((xs) => xs.map((r) => (r.id === u.id ? { ...r, isActive } : r)));
                            } catch (err2: any) {
                              setErr(err2?.response?.data?.message || err2?.message || "Update failed");
                            }
                          }}
                        >
                          {u.isActive ? <ToggleOffIcon /> : <ToggleOnIcon />}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    {loading ? "Loading…" : "No users"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>

        {/* Create dialog */}
        {creating && (
          <CreateUserDialog
            open={creating}
            onClose={() => setCreating(false)}
            onCreated={(u) => setRows((xs) => [u, ...xs])}
          />
        )}

        {/* Reset dialog */}
        {resetFor && (
          <ResetPasswordDialog
            open
            user={resetFor}
            onClose={() => setResetFor(null)}
            onUpdated={() => {}}
          />
        )}

        <Box sx={{ mt: 3 }}>
          <Divider />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
            <ShieldIcon fontSize="small" />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Only admins can create users or reset passwords. The server enforces this.
            </Typography>
          </Stack>
        </Box>
      </Container>
    </RequireAuth>
  );
}

/* ------------------------------ dialogs ------------------------------ */

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: UserRow) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = email.trim() && validPassword(pwd);

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setErr("");
    try {
      // primary + fallbacks
      const res = await tryRequests([
        () => api.post("/api/users", { name: name || undefined, email, role, password: pwd }),
        () => api.post("/api/admin/users", { name: name || undefined, email, role, password: pwd }),
        () => api.post("/api/auth/users", { name: name || undefined, email, role, password: pwd }),
      ]);
      const u = (res?.data || res) as any;
      const row: UserRow = {
        id: String(u.id ?? u._id ?? ""),
        email: String(u.email ?? email),
        name: u.name ?? name,
        role: (String(u.role ?? role) as Role) || "staff",
        isActive: (u.isActive ?? u.active ?? true) ? true : false,
        createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : new Date().toISOString(),
        lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : undefined,
      };
      onCreated(row);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New User</DialogTitle>
      <DialogContent dividers>
        {!!err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <Stack spacing={2}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" />
          <TextField
            label="Email *"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            size="small"
            type="email"
          />
          <TextField select label="Role *" size="small" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <MenuItem value="admin">Admin</MenuItem>
            <MenuItem value="staff">Staff</MenuItem>
          </TextField>
          <TextField
            label="Password *"
            size="small"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            type={show ? "text" : "password"}
            helperText={policyHint}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShow((s) => !s)}>
                    {show ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            error={!!pwd && !validPassword(pwd)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={!canSave || saving} variant="contained">
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ResetPasswordDialog({
  open,
  user,
  onClose,
  onUpdated,
}: {
  open: boolean;
  user: UserRow;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!validPassword(pwd)) return;
    setSaving(true);
    setErr("");
    try {
      await tryRequests([
        () => api.post(`/api/users/${user.id}/reset-password`, { password: pwd }),
        () => api.post(`/api/admin/users/${user.id}/reset`, { password: pwd }),
        () => api.patch(`/api/users/${user.id}`, { password: pwd }),
      ]);
      onUpdated();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Reset Password — {user.name || user.email}</DialogTitle>
      <DialogContent dividers>
        {!!err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField
          label="New Password"
          size="small"
          fullWidth
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          type={show ? "text" : "password"}
          helperText={policyHint}
          error={!!pwd && !validPassword(pwd)}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setShow((s) => !s)}>
                  {show ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={!validPassword(pwd) || saving} variant="contained">
          Update
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------ utils ------------------------------ */

async function tryRequests(reqs: Array<() => Promise<any>>) {
  let last: any;
  for (const fn of reqs) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const s = e?.response?.status;
      if (s && ![400, 401, 403, 404, 405].includes(s)) break;
    }
  }
  throw last || new Error("No matching endpoint");
}
