// apps/frontend/src/pages/billto/BillToPage.tsx
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Alert,
  Stack,
  Chip,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import EditIcon from "@mui/icons-material/Edit";

import { useEffect, useMemo, useState, ChangeEvent } from "react";
import { api } from "../../api/client";
import { CONTRACT } from "../../api/contract";

/* ------------------------ Types ------------------------ */
export type BillTo = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  website?: string;
  logoUrl?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
};

/* ------------------------ Small helpers ------------------------ */
const getPath = (obj: any, path: string) =>
  path.split(".").reduce((o: any, k: string) => (o ? o[k] : undefined), obj);

const pick = (obj: any, keys: string[]) => {
  for (const k of keys) {
    const v = k.includes(".") ? getPath(obj, k) : obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
};

const toNested = (f: Partial<BillTo>) => ({
  name: f.name?.trim(),
  email: f.email || undefined,
  phone: f.phone || undefined,
  gstin: f.gstin || undefined,
  pan: f.pan || undefined,
  website: f.website || undefined,
  logoUrl: f.logoUrl || undefined,
  address: {
    line1: f.addressLine1 || undefined,
    line2: f.addressLine2 || undefined,
    city: f.city || undefined,
    state: f.state || undefined,
    postalCode: f.postalCode || undefined,
    country: f.country || undefined,
  },
});
const toFlat = (f: Partial<BillTo>) => ({
  name: f.name?.trim(),
  email: f.email || undefined,
  phone: f.phone || undefined,
  gstin: f.gstin || undefined,
  pan: f.pan || undefined,
  website: f.website || undefined,
  logoUrl: f.logoUrl || undefined,
  addressLine1: f.addressLine1 || undefined,
  addressLine2: f.addressLine2 || undefined,
  city: f.city || undefined,
  state: f.state || undefined,
  postalCode: f.postalCode || undefined,
  country: f.country || undefined,
});
const toMinimal = (f: Partial<BillTo>) => ({
  name: f.name?.trim(),
  email: f.email || undefined,
  phone: f.phone || undefined,
  address: {
    line1: f.addressLine1 || undefined,
    city: f.city || undefined,
    country: f.country || undefined,
  },
});

const toCsv = (rows: Record<string, any>[]) => {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (!rows.length) return "id,name\n";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
};
const download = (filename: string, text: string) => {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/* ------------------------ Page ------------------------ */
export default function BillToPage() {
  const [list, setList] = useState<BillTo[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BillTo | null>(null);
  const [lastError, setLastError] = useState<string>("");
  const [showRaw, setShowRaw] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setLastError("");
    try {
      const r = await api.get(CONTRACT.endpoints.clients);
      const rows = CONTRACT
        .unwrapList(r)
        .map(CONTRACT.normalizeClient)
        .map((c: any) => ({
          id: String(c.id ?? c._id ?? c.clientId ?? ""),
          name: c.name,
          ...c,
        })) as BillTo[];
      setList(rows);
    } catch (e: any) {
      console.error(e);
      setLastError(
        `Load failed${e?.response?.status ? ` (HTTP ${e.response.status})` : ""}: ` +
          (e?.response?.data?.message || e.message || "Unknown error")
      );
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return list;
    const k = q.toLowerCase();
    return list.filter((b) =>
      [
        b.id,
        b.name,
        b.email || pick(b, ["contactEmail", "billingEmail", "mail"]),
        b.phone || pick(b, ["contactPhone", "mobile", "telephone"]),
        pick(b, ["gstin", "GSTIN", "gst", "gstNumber", "taxId"]),
        pick(b, ["pan", "PAN", "panNumber"]),
        pick(b, ["city", "address.city", "billingAddress.city", "billing.city"]),
        pick(b, ["country", "address.country", "billingAddress.country", "billing.country"]),
      ]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(k))
    );
  }, [q, list]);

  const exportCsv = () => {
    const rows = (filtered.length ? filtered : list).map((b) => ({
      id: b.id || pick(b, ["_id", "clientId"]),
      name: b.name || "",
      email: b.email || pick(b, ["contactEmail", "billingEmail", "mail"]),
      phone: b.phone || pick(b, ["contactPhone", "mobile", "telephone"]),
      gstin: b.gstin || pick(b, ["GSTIN", "gst", "gstNumber", "taxId"]),
      pan: b.pan || pick(b, ["PAN", "panNumber"]),
      website: b.website || "",
      logoUrl: b.logoUrl || "",
      addressLine1: b.addressLine1 || pick(b, ["address.line1", "billingAddress.line1"]),
      addressLine2: b.addressLine2 || pick(b, ["address.line2", "billingAddress.line2"]),
      city: b.city || pick(b, ["address.city", "billingAddress.city"]),
      state: b.state || pick(b, ["address.state", "billingAddress.state"]),
      postalCode: b.postalCode || pick(b, ["address.postalCode", "billingAddress.postalCode"]),
      country: b.country || pick(b, ["address.country", "billingAddress.country"]),
      createdAt: b.createdAt || pick(b, ["createdAt", "created_at"]),
      updatedAt: b.updatedAt || pick(b, ["updatedAt", "updated_at"]),
    }));
    if (!rows.length) {
      download("BillTo.csv", "id,name\n");
      return;
    }
    download("BillTo.csv", toCsv(rows));
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={800} mb={2}>
        Bill-To Management
      </Typography>

      {!!lastError && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: "pre-line" }}>
          {lastError}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 1 }}>
        <Stack direction={{ xs: "column", md: "row" }} gap={2} alignItems="center" justifyContent="space-between" flexWrap="wrap">
          <TextField
            size="small"
            label="Search (id/name/email/GSTIN/PAN/city/country)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ minWidth: 360, flex: 1 }}
          />
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
              Refresh
            </Button>
            <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportCsv}>
              Export
            </Button>
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              Add Bill To
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: 0 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>GSTIN</TableCell>
              <TableCell>PAN</TableCell>
              <TableCell>City</TableCell>
              <TableCell>Country</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(filtered.length ? filtered : list).length > 0 ? (
              (filtered.length ? filtered : list).map((b) => (
                <TableRow key={b.id || pick(b, ["_id", "clientId"])} hover>
                  <TableCell sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    {b.id || pick(b, ["_id", "clientId"])}
                  </TableCell>
                  <TableCell>{b.name}</TableCell>
                  <TableCell>{b.email || pick(b, ["contactEmail", "billingEmail", "mail"])}</TableCell>
                  <TableCell>{b.phone || pick(b, ["contactPhone", "mobile", "telephone"])}</TableCell>
                  <TableCell>{pick(b, ["gstin", "GSTIN", "gst", "gstNumber", "taxId"])}</TableCell>
                  <TableCell>{pick(b, ["pan", "PAN", "panNumber"])}</TableCell>
                  <TableCell>{pick(b, ["city", "address.city", "billingAddress.city", "billing.city"])}</TableCell>
                  <TableCell>{pick(b, ["country", "address.country", "billingAddress.country", "billing.country"])}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" gap={1} justifyContent="flex-end" flexWrap="wrap">
                      {/* ✅ Details button restored */}
                      <Button
                        size="small"
                        startIcon={<InfoOutlinedIcon />}
                        onClick={() => setShowRaw(b)}
                      >
                        Details
                      </Button>
                      <Button
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={() => {
                          setEditing(b);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  {loading ? "Loading..." : "No records"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <BillToDialog
        open={open}
        initial={editing || undefined}
        existing={list}
        onClose={() => setOpen(false)}
        onSaved={async () => {
          setOpen(false);
          await load();
        }}
      />

      {/* Raw JSON viewer for Details */}
      <Dialog open={!!showRaw} onClose={() => setShowRaw(null)} maxWidth="md" fullWidth>
        <DialogTitle>Bill-To — Raw JSON</DialogTitle>
        <DialogContent dividers>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(showRaw, null, 2)}
          </pre>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRaw(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Import dialog */}
      <ImportClientsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          setImportOpen(false);
          await load();
        }}
      />
    </Box>
  );
}

/* ------------------------ Inline Upsert Dialog ------------------------ */
function BillToDialog({
  open,
  onClose,
  onSaved,
  initial,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  initial?: BillTo;
  existing: BillTo[];
}) {
  const [form, setForm] = useState<Partial<BillTo>>(initial || { name: "", country: "India" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [attemptsMsg, setAttemptsMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  // If true: on EDIT failure (no update route), ask user to create NEW record
  const ALLOW_CREATE_ON_EDIT_FAILURE = true;

  useEffect(() => {
    setForm(initial || { name: "", country: "India" });
    setErr("");
    setAttemptsMsg("");
    setInfoMsg("");
  }, [initial, open]);

  const upd = (k: keyof BillTo) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const norm = (s?: string) => (s || "").trim().toLowerCase();

  const possibleDuplicates = useMemo(() => {
    const nm = norm(form.name);
    const em = norm(form.email);
    const gs = norm(form.gstin);
    if (!nm && !em && !gs) return [];
    return existing.filter((x) => {
      if (initial?.id && x.id === initial.id) return false;
      const nameMatch = nm && norm(x.name) === nm;
      const emailMatch = em && norm(x.email) === em;
      const gstinMatch = gs && norm((x as any).gstin || "") === gs;
      return nameMatch || emailMatch || gstinMatch;
    });
  }, [existing, form, initial?.id]);

  const tryRequests = async (reqs: Array<() => Promise<any>>) => {
    const logs: string[] = [];
    let last: any = null;
    for (const fn of reqs) {
      try {
        const res = await fn();
        setAttemptsMsg(logs.concat("✅ success").join("\n"));
        return res;
      } catch (e: any) {
        const s = e?.response?.status ?? "ERR";
        const u = e?.config?.url ?? "";
        const m = e?.response?.data?.message || e.message || "error";
        logs.push(`❌ ${e?.config?.method?.toUpperCase() || "REQ"} ${u} → ${s} ${m}`);
        last = e;
        // Accept 404/405/400 as "try next"
        if (s !== 404 && s !== 405 && s !== 400) {
          setAttemptsMsg(logs.join("\n"));
          throw e;
        }
      }
    }
    setAttemptsMsg(logs.join("\n"));
    throw last || new Error("No matching endpoint");
  };

  const create = async (f: Partial<BillTo>) => {
    const bNested = toNested(f);
    const bFlat = toFlat(f);
    const bMin = toMinimal(f);
    return tryRequests([
      () => api.post(`/api/clients`, bNested),
      () => api.post(`/api/clients`, bFlat),
      () => api.post(`/api/clients`, bMin),
      () => api.post(`/api/client`, bNested),
      () => api.post(`/api/client`, bFlat),
      () => api.post(`/api/client`, bMin),
    ]);
  };

  const update = async (id: string, f: Partial<BillTo>) => {
    const bN = { ...toNested(f), id, _id: id };
    const bF = { ...toFlat(f), id, _id: id };
    const bM = { ...toMinimal(f), id, _id: id };
    return tryRequests([
      () => api.put(`/api/clients/${id}`, bN),
      () => api.patch(`/api/clients/${id}`, bN),
      () => api.post(`/api/clients/${id}`, bN),

      () => api.post(`/api/clients/update/${id}`, bN),
      () => api.post(`/api/clients/${id}/update`, bN),
      () => api.post(`/api/clients/${id}/edit`, bN),
      () => api.post(`/api/clients/edit/${id}`, bN),

      () => api.post(`/api/clients/update`, bN),
      () => api.put(`/api/clients`, bN),

      () => api.put(`/api/client/${id}`, bN),
      () => api.post(`/api/client/${id}`, bN),
      () => api.post(`/api/client/update/${id}`, bN),
      () => api.post(`/api/client/update`, bN),

      // Alternate shapes if server is picky
      () => api.put(`/api/clients/${id}`, bF),
      () => api.patch(`/api/clients/${id}`, bF),
      () => api.post(`/api/clients/${id}`, bF),
      () => api.post(`/api/clients/update`, bF),

      () => api.put(`/api/clients/${id}`, bM),
      () => api.patch(`/api/clients/${id}`, bM),
      () => api.post(`/api/clients/${id}`, bM),
    ]);
  };

  const save = async () => {
    if (!form.name?.trim()) {
      setErr("Name is required");
      return;
    }

    // Prevent duplicate on Create
    if (!initial?.id && possibleDuplicates.length > 0) {
      setErr(
        `Possible duplicate found (${possibleDuplicates.length}). ` +
          `Close this dialog and click "Edit" on the existing row instead.`
      );
      return;
    }

    setSaving(true);
    setErr("");
    setAttemptsMsg("");
    setInfoMsg("");

    try {
      if (initial?.id) {
        try {
          await update(initial.id, form);
        } catch (e) {
          if (ALLOW_CREATE_ON_EDIT_FAILURE) {
            const ok = window.confirm(
              "Your backend has no update route for clients.\n\n" +
                "Do you want to CREATE a NEW client with these edited details?"
            );
            if (!ok) throw e;
            await create(form);
            setInfoMsg("A NEW client was created because no update endpoint exists.");
          } else {
            throw e;
          }
        }
      } else {
        await create(form);
      }
      await onSaved();
    } catch (e: any) {
      console.error(e);
      const status = e?.response?.status;
      const msg = e?.response?.data?.message || e.message || "Save failed";
      setErr(`Save failed${status ? ` (HTTP ${status})` : ""}: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial?.id ? "Edit Bill To" : "Add Bill To"}</DialogTitle>
      <DialogContent dividers>
        {!!err && (
          <Alert severity="error" sx={{ mb: 2, whiteSpace: "pre-line" }}>
            {err}
          </Alert>
        )}
        {!!infoMsg && <Alert severity="warning" sx={{ mb: 2 }}>{infoMsg}</Alert>}
        {!!(!initial?.id && possibleDuplicates.length > 0) && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            A similar record already exists. Use <b>Edit</b> from the table instead of creating a new one.
          </Alert>
        )}
        {!!attemptsMsg && (
          <Alert
            severity="info"
            sx={{ mb: 2, whiteSpace: "pre-line", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {attemptsMsg}
          </Alert>
        )}

        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12}>
            <TextField label="Name *" value={form.name || ""} onChange={upd("name")} fullWidth size="small" required />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Email" value={form.email || ""} onChange={upd("email")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Phone" value={form.phone || ""} onChange={upd("phone")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="GSTIN" value={form.gstin || ""} onChange={upd("gstin")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="PAN" value={form.pan || ""} onChange={upd("pan")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Website" value={form.website || ""} onChange={upd("website")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Logo URL" value={form.logoUrl || ""} onChange={upd("logoUrl")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Address Line 1"
              value={form.addressLine1 || ""}
              onChange={upd("addressLine1")}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Address Line 2"
              value={form.addressLine2 || ""}
              onChange={upd("addressLine2")}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="City" value={form.city || ""} onChange={upd("city")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="State" value={form.state || ""} onChange={upd("state")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Postal Code"
              value={form.postalCode || ""}
              onChange={upd("postalCode")}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Country" value={form.country || ""} onChange={upd("country")} fullWidth size="small" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------ Import Dialog ------------------------ */
function ImportClientsDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] || null);
    setPreview([]);
    setErr("");
  };

  // local helper: sample row + download CSV template
  const downloadTemplateForImport = () => {
    const rows = [
      {
        id: "", // optional on create
        name: "Acme Corp",
        email: "billing@acme.com",
        phone: "+91 90000 00000",
        gstin: "22AAAAA0000A1Z5",
        pan: "AAAAA0000A",
        website: "https://acme.com",
        logoUrl: "",
        addressLine1: "221B Baker St",
        addressLine2: "",
        city: "Delhi",
        state: "DL",
        postalCode: "110001",
        country: "India",
      },
    ];
    download("BillTo-Template.csv", toCsv(rows));
  };

  const fetchPreview = async () => {
    if (!file) return;
    setLoading(true);
    setErr("");
    setPreview([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.post("/api/import/clients/preview", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const rows: any[] = r.data?.rows || r.data?.items || r.data || [];
      setPreview(rows);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!preview.length) return;
    setCommitting(true);
    setErr("");
    try {
      await api.post("/api/import/clients/commit", { rows: preview });
      await onImported();
    } catch (e: any) {
      setErr(e?.response?.data?.message || e.message || "Import failed");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Import Bill-To</DialogTitle>
      <DialogContent dividers>
        {!!err && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
          </Alert>
        )}

        <Stack direction={{ xs: "column", sm: "row" }} gap={2} alignItems="center" sx={{ mb: 2 }}>
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
            Choose CSV/XLSX
            <input type="file" accept=".csv,.xlsx,.xls" hidden onChange={onPick} />
          </Button>
          <Chip label={file ? file.name : "No file selected"} />
          <Button size="small" onClick={downloadTemplateForImport} startIcon={<FileDownloadIcon />}>
            Download Template
          </Button>
          <Button variant="outlined" onClick={fetchPreview} disabled={!file || loading}>
            Preview
          </Button>
        </Stack>

        {preview.length > 0 ? (
          <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 360, overflow: "auto" }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Preview ({preview.length} rows)
            </Typography>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {JSON.stringify(preview.slice(0, 50), null, 2)}
            </pre>
            {preview.length > 50 && (
              <Typography variant="caption" color="text.secondary">
                Showing first 50 rows…
              </Typography>
            )}
          </Paper>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Select a file and click <b>Preview</b> to see parsed rows before importing.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading || committing}>
          Cancel
        </Button>
        <Button variant="contained" onClick={commit} disabled={!preview.length || committing}>
          {committing ? "Importing…" : "Import"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
