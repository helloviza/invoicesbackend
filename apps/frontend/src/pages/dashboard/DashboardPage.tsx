// apps/frontend/src/pages/dashboard/DashboardPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import {
  alpha,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import SummarizeIcon from "@mui/icons-material/Summarize";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import PriceChangeIcon from "@mui/icons-material/PriceChange";
import { api } from "../../api/client";
import BillToSelect from "../../components/BillToSelect";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

/* ============================== Types =================================== */
type SummaryNorm = {
  totals: { count: number; subtotal: number; tax: number; total: number };
  byServiceType: Array<{ key: string; subtotal: number; total: number; count?: number }>;
  byStatus: Array<{ key: string; count: number }>;
};
type DailyNorm = Array<{ date: string; total: number }>;

/* ============================== Helpers ================================= */
const COLORS = ["#5B8DEF", "#00C49F", "#FF9F43", "#E24B6A", "#845EC2", "#2FD2FF", "#FF66C4", "#FFD166"];

const fmt = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const k = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`);

const toNum = (v: any, d = 0) => {
  const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  return Number.isFinite(n) ? n : d;
};

const normKey = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(obj: any, keys: string[], d?: any) {
  if (!obj || typeof obj !== "object") return d;
  const map = new Map<string, string>();
  Object.keys(obj).forEach((k) => map.set(normKey(k), k));
  for (const k of keys) {
    const real = map.get(normKey(k));
    if (real !== undefined) {
      const v = (obj as any)[real];
      if (v !== undefined && v !== null) return v;
    }
  }
  return d;
}

function normalizeSummary(raw: any): SummaryNorm {
  const base = raw || {};
  const bucket =
    base.totals ||
    base.summary ||
    base.data ||
    (typeof base.count === "number" || typeof base.total === "number" ? base : {});

  const totals = {
    count: toNum(pick(bucket, ["count", "invoiceCount", "invoices", "totalInvoices", "numInvoices"], 0)),
    subtotal: toNum(pick(bucket, ["subtotal", "subTotal", "sumSubtotal", "sub_total", "amountSubtotal"], 0)),
    tax: toNum(pick(bucket, ["tax", "taxes", "taxTotal", "tax_total"], 0)),
    total: toNum(pick(bucket, ["total", "grandTotal", "sumTotal", "grand_total", "amountTotal"], 0)),
  };

  let byServiceType: Array<{ key: string; subtotal: number; total: number; count?: number }> = [];
  const bst = base.byServiceType || base.serviceType || base.type || [];
  if (Array.isArray(bst)) {
    byServiceType = bst.map((r: any) => ({
      key: String(pick(r, ["key", "type", "serviceType"], "OTHERS")).toUpperCase(),
      subtotal: toNum(pick(r, ["subtotal", "subTotal"], pick(r, ["total"], 0))),
      total: toNum(pick(r, ["total"], pick(r, ["subtotal", "subTotal"], 0))),
      count: toNum(pick(r, ["count", "qty", "num"], 0)),
    }));
  } else if (bst && typeof bst === "object") {
    byServiceType = Object.keys(bst).map((k) => {
      const v = (bst as any)[k];
      if (v && typeof v === "object") {
        return {
          key: String(k).toUpperCase(),
          subtotal: toNum(pick(v, ["subtotal", "subTotal"], pick(v, ["total"], 0))),
          total: toNum(pick(v, ["total"], pick(v, ["subtotal", "subTotal"], 0))),
          count: toNum(pick(v, ["count", "qty", "num"], 0)),
        };
      }
      return { key: String(k).toUpperCase(), subtotal: toNum(v, 0), total: toNum(v, 0) };
    });
  }

  let byStatus: Array<{ key: string; count: number }> = [];
  const bs = base.byStatus || base.status || [];
  if (Array.isArray(bs)) {
    byStatus = bs.map((r: any) => ({
      key: String(pick(r, ["key", "status"], "Unknown")),
      count: toNum(pick(r, ["count", "value", "num"], 0)),
    }));
  } else if (bs && typeof bs === "object") {
    byStatus = Object.keys(bs).map((k) => ({ key: k, count: toNum((bs as any)[k], 0) }));
  }

  if (!totals.total && byServiceType.length) {
    totals.total = byServiceType.reduce((a, b) => a + toNum(b.total || b.subtotal), 0);
  }
  if (!totals.subtotal && byServiceType.length) {
    totals.subtotal = byServiceType.reduce((a, b) => a + toNum(b.subtotal || b.total), 0);
  }
  if (!totals.count && byStatus.length) {
    totals.count = byStatus.reduce((a, b) => a + toNum(b.count), 0);
  }

  return { totals, byServiceType, byStatus };
}

function normalizeDaily(raw: any): DailyNorm {
  if (!raw) return [];
  const arr = raw.points || raw.rows || raw.series || (Array.isArray(raw) ? raw : null) || [];
  if (Array.isArray(arr)) {
    return arr.map((p: any) => ({
      date: String(p.date || p.day || p._id || ""),
      total: toNum(p.total ?? p.subtotal ?? p.value ?? 0),
    }));
  }
  if (typeof raw === "object") {
    return Object.keys(raw).map((k) => ({ date: k, total: toNum((raw as any)[k], 0) }));
  }
  return [];
}

/* ============================== UI bits ================================= */
function StatCard({
  title,
  value,
  icon,
  color = "#5B8DEF",
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 3,
        background: `linear-gradient(135deg, ${alpha(color, 0.12)} 0%, ${alpha(color, 0.04)} 100%)`,
        border: `1px solid ${alpha(color, 0.22)}`,
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            p: 1.2,
            borderRadius: 2,
            bgcolor: alpha(color, 0.18),
            color: color,
            display: "inline-flex",
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="overline" sx={{ letterSpacing: 1.1, opacity: 0.7 }}>
            {title}
          </Typography>
          <Typography variant="h5" fontWeight={800}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

function EmptyView() {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ height: 1, color: "text.secondary" }}>
      <Typography variant="body2">No data in this range.</Typography>
    </Stack>
  );
}

/* ============================== Page ==================================== */
export default function DashboardPage() {
  const theme = useTheme();

  // Filters
  const [clientId, setClientId] = useState<string>("");
  const [from, setFrom] = useState<string>(dayjs().subtract(30, "day").format("YYYY-MM-DD"));
  const [to, setTo] = useState<string>(dayjs().format("YYYY-MM-DD"));

  // Data
  const [summary, setSummary] = useState<SummaryNorm | null>(null);
  const [daily, setDaily] = useState<DailyNorm>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const queryParams = useMemo(
    () => ({ clientId: clientId || undefined, from, to }),
    [clientId, from, to]
  );

  const fetchAll = async () => {
    setLoading(true);
    setErr("");
    try {
      const [s, d] = await Promise.all([
        api.get("/api/dashboard/summary", { params: queryParams }),
        api.get("/api/dashboard/daily", { params: queryParams }),
      ]);
      setSummary(normalizeSummary(s.data));
      setDaily(normalizeDaily(d.data));
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  };

  // 🔄 Auto-refresh when filters change (tiny debounce to avoid double hits)
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(fetchAll, 150);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, from, to]);

  const totals = summary?.totals || { count: 0, subtotal: 0, tax: 0, total: 0 };
  const byType = (summary?.byServiceType || []).slice().sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const byStatus = summary?.byStatus || [];

  return (
    <Container maxWidth={false} sx={{ px: { xs: 2, md: 3, xl: 4 }, py: 3 }}>
      {/* SLICERS */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2.5,
          borderRadius: 3,
          background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
        }}
      >
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems="center">
          {/* Bill-To selector (wrap in Box for width; component doesn't accept sx) */}
          <Box sx={{ minWidth: 320 }}>
            <BillToSelect value={clientId} onChange={setClientId} />
          </Box>

          <TextField
            label="From"
            type="date"
            size="small"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />
          <TextField
            label="To"
            type="date"
            size="small"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />

          <Stack direction="row" spacing={1}>
            {[
              { label: "Last 7", days: 7 },
              { label: "30", days: 30 },
              { label: "90", days: 90 },
            ].map((q) => (
              <Chip
                key={q.label}
                label={q.label}
                variant="outlined"
                onClick={() => {
                  setFrom(dayjs().subtract(q.days, "day").format("YYYY-MM-DD"));
                  setTo(dayjs().format("YYYY-MM-DD"));
                }}
                sx={{ borderRadius: 999 }}
              />
            ))}
          </Stack>

          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={fetchAll}
            sx={{ borderRadius: 999, px: 2.2 }}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </Stack>
      </Paper>

      {/* KPI TILES */}
      <Grid container spacing={2.25} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Invoices" value={fmt(totals.count)} icon={<SummarizeIcon />} color="#5B8DEF" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Subtotal" value={fmt(totals.subtotal)} icon={<LocalAtmIcon />} color="#00C49F" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Taxes" value={fmt(totals.tax)} icon={<PriceChangeIcon />} color="#FF9F43" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Total" value={fmt(totals.total)} icon={<QueryStatsIcon />} color="#E24B6A" />
        </Grid>
      </Grid>

      {/* CHARTS */}
      <Grid container spacing={2.25}>
        <Grid item xs={12} lg={7}>
          <Paper sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography fontWeight={800}>By Service Type</Typography>
              <IconButton size="small" onClick={fetchAll} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Divider sx={{ mb: 1.5 }} />
            <Box sx={{ height: 340 }}>
              {loading ? (
                <Stack alignItems="center" justifyContent="center" sx={{ height: 1 }}>
                  <CircularProgress />
                </Stack>
              ) : byType.length === 0 ? (
                <EmptyView />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byType.map((r) => ({
                      name: (r.key || "OTHERS").toUpperCase(),
                      subtotal: Number(r.subtotal || 0),
                      total: Number(r.total || 0),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tickMargin={10} />
                    <YAxis tickFormatter={k} />
                    <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
                    <Legend />
                    <Bar dataKey="subtotal" name="Subtotal" fill={COLORS[0]} radius={[8, 8, 0, 0]} />
                    <Bar dataKey="total" name="Total" fill={COLORS[2]} radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper sx={{ p: 2, borderRadius: 3 }}>
            <Typography fontWeight={800} sx={{ mb: 1 }}>
              By Status
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Box sx={{ height: 340 }}>
              {loading ? (
                <Stack alignItems="center" justifyContent="center" sx={{ height: 1 }}>
                  <CircularProgress />
                </Stack>
              ) : (summary?.byStatus || []).length === 0 ? (
                <EmptyView />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(summary?.byStatus || []).map((s) => ({ name: s.key, value: Number(s.count || 0) }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={110}
                      label={(p) => `${p.name}: ${p.value}`}
                      paddingAngle={2}
                    >
                      {(summary?.byStatus || []).map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2, borderRadius: 3 }}>
            <Typography fontWeight={800} sx={{ mb: 1 }}>
              Daily Total
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Box sx={{ height: 340 }}>
              {loading ? (
                <Stack alignItems="center" justifyContent="center" sx={{ height: 1 }}>
                  <CircularProgress />
                </Stack>
              ) : daily.length === 0 ? (
                <EmptyView />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" minTickGap={24} />
                    <YAxis tickFormatter={k} />
                    <Tooltip formatter={(v: any) => Number(v).toLocaleString()} />
                    <Line type="monotone" dataKey="total" stroke={COLORS[0]} strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {!!err && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {err}
        </Alert>
      )}
    </Container>
  );
}
