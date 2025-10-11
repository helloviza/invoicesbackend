// apps/frontend/src/pages/history/HistoryPage.tsx
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  IconButton,
  Menu,
} from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* ========================== Types ========================== */
type BillTo = { id: string; name: string };
type InvoiceRow = Record<string, any>;

/* ========================== Helpers ========================== */
const isObjectId = (s: string) => /^[0-9a-f]{24}$/i.test(s);
const JWT_KEY = "jwt";
const authHeaders = (): HeadersInit => {
  const jwt = localStorage.getItem(JWT_KEY);
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
};

const LIST_ENDPOINTS_GET = ["/api/invoices"];
const LIST_ENDPOINTS_POST = ["/api/invoices/search", "/api/invoices/list"];
const CSV_ENDPOINTS = ["/api/invoices/export.csv"];
const XLSX_ENDPOINTS = ["/api/invoices/export.xlsx"];
const PDF_ENDPOINTS = ["/api/invoices/export.pdf"];

/* ---- query builder with alias fan-out ---- */
function buildQueryMulti(
  base: Record<string, any>,
  aliases: Record<string, ReadonlyArray<string>>
) {
  const pairs: string[] = [];
  const push = (k: string, v: any) => {
    if (
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    )
      return;
    if (Array.isArray(v)) {
      v.forEach((x) =>
        pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`)
      );
    } else {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  };
  Object.entries(base).forEach(([k, v]) => {
    if (!aliases[k]) push(k, v);
  });
  Object.entries(aliases).forEach(([srcKey, aliasKeys]) => {
    const v = (base as any)[srcKey];
    if (
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    )
      return;
    aliasKeys.forEach((k) => push(k, v));
  });
  return pairs.join("&");
}

const toDateInput = (iso?: any) => (iso ? String(iso).slice(0, 10) : "");
const toLocalStartOfDayISO = (yyyyMmDd?: string) => {
  if (!yyyyMmDd) return undefined;
  const d = new Date(yyyyMmDd);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const toLocalEndOfDayISO = (yyyyMmDd?: string) => {
  if (!yyyyMmDd) return undefined;
  const d = new Date(yyyyMmDd);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

/* ====================== Normalize list payload ====================== */
function normalizeList(data: any): { items: InvoiceRow[]; total: number } {
  if (Array.isArray(data)) return { items: data, total: data.length };
  if (Array.isArray(data?.items))
    return { items: data.items, total: Number(data.total ?? data.items.length) };
  if (Array.isArray(data?.results))
    return {
      items: data.results,
      total: Number(data.total ?? data.count ?? data.results.length),
    };
  if (Array.isArray(data?.data?.items))
    return {
      items: data.data.items,
      total: Number(data.data.total ?? data.data.items.length),
    };
  if (Array.isArray(data?.data))
    return { items: data.data, total: Number(data.total ?? data.data.length) };
  return { items: [], total: 0 };
}

/* ====================== Tolerant accessors ====================== */
const getId = (r: InvoiceRow) => String(r.id ?? r._id ?? r.invoiceId ?? "");
const getNo = (r: InvoiceRow) => String(r.invoiceNo ?? r.number ?? r.no ?? "—");
const getDate = (r: InvoiceRow) =>
  toDateInput(r.issueDate ?? r.date ?? r.issuedOn ?? r.createdAt);
const getBillTo = (r: InvoiceRow) =>
  r.billTo?.name ?? r.billToName ?? r.client?.name ?? r.customer?.name ?? "—";
const getCurrency = (r: InvoiceRow) => String(r.currency ?? "INR");
const num = (v: any, d = 0) => (Number.isFinite(+v) ? +v : d);

/* ---------- Document type detection (Invoice | Performa) ---------- */
const getDocTypeRaw = (r: InvoiceRow): "invoice" | "performa" | "" => {
  if (typeof r.isProforma === "boolean") return r.isProforma ? "performa" : "invoice";
  if (typeof r.meta?.isProforma === "boolean")
    return r.meta.isProforma ? "performa" : "invoice";

  const candidates = [
    r.docType,
    r.documentType,
    r.invoiceType,
    r.type,
    r.doc,
    r.status,
    r.meta?.documentKind,
    r.meta?.docType,
    r.meta?.status,
  ]
    .filter(Boolean)
    .map((x: any) => String(x).toLowerCase());

  for (const s of candidates) {
    if (/pro-?forma|per-?forma|^pi$|^proforma(_invoice)?$|^performa(_invoice)?$/.test(s))
      return "performa";
    if (/^tax(\s+invoice)?$|^invoice$/.test(s)) return "invoice";
  }

  const no = getNo(r).toUpperCase();
  if (/(^|[^A-Z])PI[-/]/.test(no)) return "performa";
  return "";
};
const prettyDocType = (v: string) =>
  v === "performa" ? "Performa" : v === "invoice" ? "Invoice" : "—";

/* ------------------------------------------------------------------ */
/*             Canonical amounts (fixes wrong totals)                 */
/* ------------------------------------------------------------------ */
function itemsFromRow(r: InvoiceRow): any[] {
  const pools = [
    r.items,
    r.lines,
    r.meta?.items,
    r.meta?.lines,
    r.meta?.services,
    r.flights,
    r.hotels,
    r.visas,
    r.holidays,
    r.mice,
    r.stationary ?? r.stationery,
    r.gifts ?? r.giftItems,
    r.goodies,
    r.others ?? r.other,
    r.services,
  ];
  const out: any[] = [];
  for (const p of pools) {
    if (Array.isArray(p)) out.push(...p);
    else if (typeof p === "string") {
      try {
        const j = JSON.parse(p);
        if (Array.isArray(j)) out.push(...j);
      } catch {}
    }
  }
  return out;
}

function computeAmounts(r: InvoiceRow) {
  const items = itemsFromRow(r);

  const taxPct =
    r.taxPct ?? r.taxPercent ?? r.tax_percentage ?? r.tax_rate ?? r.tax ?? 0;
  const svcPct =
    r.svcPct ??
    r.servicePct ??
    r.servicePercent ??
    r.service_percentage ??
    r.service ??
    0;

  let subtotalFromItems = 0;
  if (items.length) {
    subtotalFromItems = items.reduce((acc: number, it: any) => {
      const q = num(it.qty ?? it.quantity ?? 1);
      const unit = num(it.unitPrice ?? it.price ?? it.rate ?? 0);
      const disc = num(it.discount ?? it.disc ?? 0);
      const base = num(it.amount, q * unit - disc);
      return acc + base;
    }, 0);
  }

  const rawSubtotal = num(r.subtotal ?? r.subTotal ?? r.sub_total);
  const rawTaxAmt = num(r.taxAmt ?? r.taxTotal ?? r.tax_total);
  const rawSvcAmt = num(r.svcAmt ?? r.serviceCharges ?? r.service_total);
  const rawTotal = num(r.total ?? r.grandTotal ?? r.grand_total);

  let subtotal = subtotalFromItems || rawSubtotal;
  const taxAmt0 =
    rawTaxAmt || (num(taxPct) ? (num(taxPct) / 100) * (subtotal || rawTotal) : 0);
  const svcAmt0 =
    rawSvcAmt || (num(svcPct) ? (num(svcPct) / 100) * (subtotal || rawTotal) : 0);
  const derivedSubtotal = rawTotal ? rawTotal - taxAmt0 - svcAmt0 : 0;

  if (!subtotal || Math.abs(subtotal + taxAmt0 + svcAmt0 - rawTotal) > 0.5) {
    subtotal = subtotalFromItems || derivedSubtotal || rawSubtotal;
  }

  const taxAmt = rawTaxAmt || (num(taxPct) ? (num(taxPct) / 100) * subtotal : 0);
  const svcAmt = rawSvcAmt || (num(svcPct) ? (num(svcPct) / 100) * subtotal : 0);
  const total = rawTotal || subtotal + taxAmt + svcAmt;

  return {
    subtotal,
    taxPct: num(taxPct) || "",
    taxAmt,
    svcPct: num(svcPct) || "",
    svcAmt,
    total,
  };
}

/* ========================== Component ========================== */
export default function HistoryPage() {
  const navigate = useNavigate();

  // Filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [docType, setDocType] = useState<string>(""); // "" | "invoice" | "performa"
  const [billTo, setBillTo] = useState<BillTo | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Data + pagination
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);

  // Bill-To list
  const [clients, setClients] = useState<BillTo[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  // Selection
  const [selected, setSelected] = useState<string[]>([]);
  const hasSelection = selected.length > 0;

  // Remember which endpoint style worked
  const lastModeRef = useRef<"GET" | "POST-SEARCH" | "POST-LIST" | null>(null);

  // ---- Selection totals ----
  const computeSelectedTotals = (sel: string[], list: InvoiceRow[]) => {
    const map = new Map(list.map((r) => [getId(r), r]));
    let subtotal = 0,
      taxAmt = 0,
      svcAmt = 0,
      totalAmt = 0;
    sel.forEach((id) => {
      const r = map.get(id);
      if (r) {
        const a = computeAmounts(r);
        subtotal += a.subtotal;
        taxAmt += a.taxAmt;
        svcAmt += a.svcAmt;
        totalAmt += a.total;
      }
    });
    return { subtotal, taxAmt, svcAmt, totalAmt };
  };
  const selectedTotals = computeSelectedTotals(selected, rows);

  /* ---------------------- Bill-To load ---------------------- */
  useEffect(() => {
    const loadClients = async () => {
      try {
        setLoadingClients(true);
        const res = await fetch(`/api/clients?limit=200`, {
          headers: { ...authHeaders(), "Cache-Control": "no-store" },
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Clients fetch failed (${res.status})`);
        const data = await res.json();
        const raw: any[] = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
          ? data
          : data?.data ?? [];
        setClients(
          raw.map((c: any) => ({
            id: String(c.id ?? c._id ?? c.clientId ?? c.customerId ?? ""),
            name: String(c.name ?? c.company_name ?? c.displayName ?? "—"),
          }))
        );
      } catch (e: any) {
        console.warn("Bill-To list error:", e?.message || e);
      } finally {
        setLoadingClients(false);
      }
    };
    loadClients();
  }, []);

  /* ---------------------- Client-side filter (fallback) ---------------------- */
  const filtersActive =
    q.trim() !== "" || !!billTo || !!status || !!docType || !!dateFrom || !!dateTo;

  function applyLocalFilters(items: InvoiceRow[]): InvoiceRow[] {
    if (!filtersActive) return items;

    const qText = q.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom).setHours(0, 0, 0, 0) : undefined;
    const to = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : undefined;
    const billToId = billTo?.id;
    const billToName = (billTo?.name || "").toLowerCase();
    const statusNorm = status.toLowerCase();
    const docTypeNorm = docType.toLowerCase();

    return items.filter((r) => {
      if (qText) {
        const hay = `${getNo(r)} ${getBillTo(r)}`.toLowerCase();
        if (!hay.includes(qText)) return false;
      }
      if (billToId) {
        const idMatch =
          String(r.billToId ?? r.clientId ?? r.customerId ?? r.client?.id ?? "") ===
          billToId;
        const nameMatch = (getBillTo(r) || "").toLowerCase().includes(billToName);
        if (!(idMatch || nameMatch)) return false;
      }
      if (status) {
        const s = String(r.status || "").toLowerCase();
        if (s !== statusNorm) return false;
      }
      if (docType) {
        const t = getDocTypeRaw(r);
        if (
          (docTypeNorm === "performa" && t !== "performa") ||
          (docTypeNorm === "invoice" && t !== "invoice")
        )
          return false;
      }
      if (from !== undefined || to !== undefined) {
        const iso =
          r.issueDate ?? r.date ?? r.issuedOn ?? r.createdAt ?? r.updatedAt;
        const t = iso ? new Date(iso).getTime() : undefined;
        if (t === undefined) return false;
        if (from !== undefined && t < from) return false;
        if (to !== undefined && t > to) return false;
      }
      return true;
    });
  }

  /* ---------------------- Filters + pagination -> load ---------------------- */
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const fromISO = toLocalStartOfDayISO(dateFrom);
        const toISO = toLocalEndOfDayISO(dateTo);

        const base = {
          q: q.trim() || undefined,
          billToId: billTo?.id || undefined,
          billToName: billTo?.name || undefined,
          dateFrom: fromISO,
          dateTo: toISO,
          status: status || undefined,
          docType: docType || undefined,
          page: page + 1,
          limit,
          sort: "issueDate:desc",
        };

        const aliases = {
          q: ["q", "search", "query", "invoiceNo", "number", "no"],
          billToId: ["billToId", "clientId", "customerId"],
          billToName: ["billToName", "clientName", "customerName", "billTo"],
          dateFrom: [
            "dateFrom",
            "from",
            "issueDateFrom",
            "createdFrom",
            "date_gte",
            "issuedFrom",
            "createdAfter",
          ],
          dateTo: [
            "dateTo",
            "to",
            "issueDateTo",
            "createdTo",
            "date_lte",
            "issuedTo",
            "createdBefore",
          ],
          status: ["status", "Status", "statuses[]"],
          docType: ["docType", "documentType", "type", "kind", "doc", "invoiceType", "isProforma"],
          page: ["page", "p"],
          limit: ["limit", "perPage", "pageSize"],
          sort: ["sort", "orderBy"],
        } as const;

        const query = buildQueryMulti(base, aliases);

        // --- 1) Try GET
        for (const ep of LIST_ENDPOINTS_GET) {
          try {
            const res = await fetch(`${ep}?${query}`, {
              headers: { ...authHeaders(), "Cache-Control": "no-store" },
              credentials: "include",
            });
            if (!res.ok) continue;
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            if (!ct.includes("json")) continue;
            const payload = await res.json();
            const { items, total } = normalizeList(payload);
            if (Array.isArray(items)) {
              lastModeRef.current = "GET";
              const filtered = applyLocalFilters(items);
              const withIds = filtered.map((r: any) => ({
                ...r,
                id: r.id ?? r._id ?? r.invoiceId,
              }));
              setRows(withIds);
              setTotal(filtersActive ? withIds.length : Number(total ?? withIds.length));
              setSelected([]);
              setLoading(false);
              return;
            }
          } catch {}
        }

        // --- 2) Try POST variants
        const postBody = {
          q: base.q,
          billToId: base.billToId,
          billToName: base.billToName,
          dateFrom: base.dateFrom,
          dateTo: base.dateTo,
          status: base.status,
          docType: base.docType,
          page: base.page,
          limit: base.limit,
          sort: base.sort,
          // aliases
          search: base.q,
          query: base.q,
          invoiceNo: base.q,
          number: base.q,
          no: base.q,
          clientId: base.billToId,
          customerId: base.billToId,
          clientName: base.billToName,
          customerName: base.billToName,
          billTo: base.billToName,
          from: base.dateFrom,
          issueDateFrom: base.dateFrom,
          createdFrom: base.dateFrom,
          date_gte: base.dateFrom,
          issuedFrom: base.dateFrom,
          createdAfter: base.dateFrom,
          to: base.dateTo,
          issueDateTo: base.dateTo,
          createdTo: base.dateTo,
          date_lte: base.dateTo,
          issuedTo: base.dateTo,
          createdBefore: base.dateTo,
          Status: base.status,
          "statuses[]": base.status ? [base.status] : undefined,
          type: base.docType,
          documentType: base.docType,
          kind: base.docType,
          doc: base.docType,
          invoiceType: base.docType,
          isProforma: base.docType ? base.docType === "performa" : undefined,
          p: base.page,
          perPage: base.limit,
          pageSize: base.limit,
          orderBy: base.sort,
        };

        for (const ep of LIST_ENDPOINTS_POST) {
          try {
            const res = await fetch(ep, {
              method: "POST",
              headers: {
                ...authHeaders(),
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
              body: JSON.stringify(postBody),
              credentials: "include",
            });
            if (!res.ok) continue;
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            if (!ct.includes("json")) continue;
            const payload = await res.json();
            const { items, total } = normalizeList(payload);
            if (Array.isArray(items)) {
              lastModeRef.current = ep.endsWith("/search")
                ? "POST-SEARCH"
                : "POST-LIST";
              const filtered = applyLocalFilters(items);
              const withIds = filtered.map((r: any) => ({
                ...r,
                id: r.id ?? r._id ?? r.invoiceId,
              }));
              setRows(withIds);
              setTotal(filtersActive ? withIds.length : Number(total ?? withIds.length));
              setSelected([]);
              setLoading(false);
              return;
            }
          } catch {}
        }

        throw new Error(
          "No compatible invoice listing endpoint accepted filters (tried GET /api/invoices and POST /api/invoices/{search|list})."
        );
      } catch (e: any) {
        setRows([]);
        setTotal(0);
        setSelected([]);
        setError(e?.message || "Failed to load invoices.");
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, docType, billTo, dateFrom, dateTo, page, limit]);

  const clearAll = () => {
    setQ("");
    setStatus("");
    setDocType("");
    setBillTo(null);
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  // Selection handlers
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? rows.map((r) => getId(r)) : []);
  const toggleOne = (id: string, checked: boolean) =>
    setSelected((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)
    );

  /* ---------------------- Exports (server-only) ---------------------- */
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const currentFilters = () => {
    const fromISO = toLocalStartOfDayISO(dateFrom);
    const toISO = toLocalEndOfDayISO(dateTo);
    return {
      q: q.trim() || undefined,
      billToId: billTo?.id || undefined,
      billToName: billTo?.name || undefined,
      clientId: billTo?.id || undefined,
      clientName: billTo?.name || undefined,
      customerId: billTo?.id || undefined,
      customerName: billTo?.name || undefined,
      dateFrom: fromISO,
      from: fromISO,
      issueDateFrom: fromISO,
      createdFrom: fromISO,
      date_gte: fromISO,
      dateTo: toISO,
      to: toISO,
      issueDateTo: toISO,
      createdTo: toISO,
      date_lte: toISO,
      status: status || undefined,
      Status: status || undefined,
      "statuses[]": status ? [status] : undefined,
      docType: docType || undefined,
      documentType: docType || undefined,
      type: docType || undefined,
      isProforma: docType ? docType === "performa" : undefined,
    };
  };

  async function tryServerGet(endpoints: string[], filename: string) {
    const qs = buildQueryMulti(
      {
        ...currentFilters(),
        includeItems: 1,
      },
      {
        includeItems: ["includeItems", "include", "withItems", "with", "items"],
      }
    );

    for (const endpoint of endpoints) {
      try {
        const r = await fetch(`${endpoint}?${qs}`, {
          headers: { ...authHeaders(), "Cache-Control": "no-store" },
          credentials: "include",
        });
        if (!r.ok) continue;
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (
          filename.endsWith(".csv") &&
          !ct.includes("text/csv") &&
          !ct.includes("application/csv")
        ) {
          continue;
        }
        if (
          filename.endsWith(".xlsx") &&
          !ct.includes(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          )
        ) {
          continue;
        }
        const b = await r.blob();
        downloadBlob(b, filename);
        return true;
      } catch {}
    }
    return false;
  }

  async function tryServerPost(
    endpoints: string[],
    body: any,
    filename: string
  ) {
    for (const endpoint of endpoints) {
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
          body: JSON.stringify(body),
          credentials: "include",
        });
        if (!r.ok) {
          try {
            const t = await r.text();
            console.warn("Export POST failed:", r.status, t);
          } catch {}
          continue;
        }
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("pdf")) {
          const b = await r.blob();
          downloadBlob(b, filename);
          return true;
        }
        try {
          const j = await r.json();
          const directUrl: string | undefined =
            j.url ||
            (j.pdfKey
              ? /^https?:\/\//i.test(j.pdfKey)
                ? j.pdfKey
                : `http://localhost:8080/${
                    j.pdfKey.startsWith("static/") ? j.pdfKey : `static/${j.pdfKey}`
                  }`
              : undefined);
          if (directUrl) {
            try {
              const r2 = await fetch(directUrl, {
                headers: { ...authHeaders(), "Cache-Control": "no-store" },
                credentials: "include",
              });
              const ct2 = (r2.headers.get("content-type") || "").toLowerCase();
              if (r2.ok && ct2.includes("pdf")) {
                const b = await r2.blob();
                downloadBlob(b, filename);
              } else {
                window.open(directUrl, "_blank");
              }
              return true;
            } catch {
              window.open(directUrl, "_blank");
              return true;
            }
          }
        } catch {}
      } catch {}
    }
    return false;
  }

  const exportCsv = async () => {
    const ok = await tryServerGet(CSV_ENDPOINTS, "PlumTrips-Invoices-Items.csv");
    if (!ok) {
      alert(
        "Could not reach the server CSV export (/api/invoices/export.csv). Please ensure the backend route is mounted and returns 200."
      );
    }
  };

  const exportXlsx = async () => {
    const ok = await tryServerGet(XLSX_ENDPOINTS, "PlumTrips-Invoices.xlsx");
    if (!ok) {
      alert(
        "Could not reach the server Excel export (/api/invoices/export.xlsx). Please ensure the backend route is mounted and returns 200."
      );
    }
  };

  const exportPdf = async () => {
    const body = hasSelection
      ? { invoiceIds: selected, includeItems: true, filters: currentFilters() }
      : { includeItems: true, filters: currentFilters() };
    const ok =
      (await tryServerPost(PDF_ENDPOINTS, body, "PlumTrips-Invoices.pdf")) ||
      (await tryServerGet(["/api/invoices/export.pdf"], "PlumTrips-Invoices.pdf"));
    if (!ok) {
      alert(
        "Combined PDF export API not found or failed. Please implement/enable POST /api/invoices/export.pdf on the backend."
      );
    }
  };

  // Single-invoice TAX/PROFORMA (server decides by ?doc)
  const downloadSinglePdf = async (row: InvoiceRow) => {
    const id = getId(row);
    const no = getNo(row);
    const idOrNo = id || no;
    if (!idOrNo) return alert("No identifier for this invoice.");

    const dt = getDocTypeRaw(row); // "invoice" | "performa" | ""
    const qs = dt === "performa" ? "?doc=performa&force=1" : "";
    const endpoint = `/api/invoices/${encodeURIComponent(idOrNo)}/pdf${qs}`;

    try {
      const res = await fetch(endpoint, {
        headers: { ...authHeaders(), "Cache-Control": "no-store" },
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return alert(`PDF not available for ${no || id} (${res.status}). ${txt || ""}`);
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("pdf")) {
        const blob = await res.blob();
        downloadBlob(blob, `${no || id}.pdf`);
        return;
      }

      const text = await res.text();
      try {
        const j = JSON.parse(text);
        const directUrl: string | undefined =
          j.url ||
          (j.pdfKey
            ? /^https?:\/\//i.test(j.pdfKey)
              ? j.pdfKey
              : `http://localhost:8080/${
                  j.pdfKey.startsWith("static/") ? j.pdfKey : `static/${j.pdfKey}`
                }`
            : undefined);
        if (directUrl) {
          try {
            const r2 = await fetch(directUrl, {
              headers: { ...authHeaders(), "Cache-Control": "no-store" },
              credentials: "include",
            });
            const ct2 = (r2.headers.get("content-type") || "").toLowerCase();
            if (r2.ok && ct2.includes("pdf")) {
              const b = await r2.blob();
              downloadBlob(b, `${no || id}.pdf`);
            } else {
              window.open(directUrl, "_blank");
            }
            return;
          } catch {
            window.open(directUrl, "_blank");
            return;
          }
        }
        alert(`Server returned a non-PDF response.\n${text.slice(0, 300)}`);
      } catch {
        alert(`Server returned a non-PDF response.\n${text.slice(0, 300)}`);
      }
    } catch (e: any) {
      alert(`Failed to download PDF: ${e?.message || e}`);
    }
  };

  // Navigate to dedicated Proforma page
  const gotoProformaPage = (row: InvoiceRow) => {
    const id = getId(row) || getNo(row);
    if (!id) return alert("No identifier for this invoice.");
    navigate(`/invoices/${encodeURIComponent(id)}/proforma`);
  };

  /* ---------------------- NEW: status update helper ---------------------- */
  const setInvoiceStatus = async (
    row: InvoiceRow,
    newStatus: "DRAFT" | "SENT" | "PAID" | "VOID"
  ) => {
    const id = String(row.id ?? row._id ?? "");
    if (!id) return alert("No invoice id.");

    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({ status: newStatus }),
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Failed (${res.status})`);
      }
      // Optimistically update the row
      setRows((prev) =>
        prev.map((r) => (String(r.id ?? r._id) === id ? { ...r, status: newStatus } : r))
      );
    } catch (e: any) {
      alert(`Could not change status: ${e?.message || e}`);
    }
  };

  /* ---------------------- NEW: tiny per-row menu ---------------------- */
  function RowStatusMenu({
    row,
    onChange,
  }: {
    row: InvoiceRow;
    onChange: (s: "DRAFT" | "SENT" | "PAID" | "VOID") => void;
  }) {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);
    return (
      <>
        <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)}>
          <MoreVertIcon fontSize="small" />
        </IconButton>
        <Menu open={open} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}>
          <MenuItem onClick={() => { setAnchorEl(null); onChange("DRAFT"); }}>Mark DRAFT</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); onChange("SENT"); }}>Mark SENT</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); onChange("PAID"); }}>Mark PAID</MenuItem>
          <MenuItem onClick={() => { setAnchorEl(null); onChange("VOID"); }}>Mark VOID</MenuItem>
        </Menu>
      </>
    );
  }

  /* ========================== Render ========================== */
  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", px: 2, py: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, color: "#0b2a43", mb: 2 }}>
        Invoice History
      </Typography>

      {/* Filters */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2.5,
          borderRadius: 3,
          backgroundColor: "rgba(0,71,127,0.04)",
          border: "1px solid rgba(0,71,127,0.10)",
        }}
      >
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            label="Search (No / Bill-To)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            fullWidth
          />

          <Autocomplete
            options={clients}
            getOptionLabel={(o) => o.name}
            loading={loadingClients}
            value={billTo}
            onChange={(_, v) => {
              setBillTo(v);
              setPage(0);
            }}
            renderInput={(params) => (
              <TextField {...params} label="Bill-To" placeholder="Select client" />
            )}
            sx={{ minWidth: 220 }}
          />

          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">
                <em>All</em>
              </MenuItem>
              <MenuItem value="draft">Draft</MenuItem>
              <MenuItem value="issued">Issued</MenuItem>
              <MenuItem value="paid">Paid</MenuItem>
              <MenuItem value="overdue">Overdue</MenuItem>
              <MenuItem value="cancelled">Cancelled</MenuItem>
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 170 }}>
            <InputLabel>Document</InputLabel>
            <Select
              label="Document"
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">
                <em>All</em>
              </MenuItem>
              <MenuItem value="invoice">Invoice</MenuItem>
              <MenuItem value="performa">Performa</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />
          <TextField
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />

          <Button variant="outlined" onClick={clearAll} sx={{ ml: { md: "auto" } }}>
            Clear
          </Button>
        </Stack>
      </Paper>

      {/* Bulk/Export bar */}
      {hasSelection ? (
        <Paper
          elevation={0}
          sx={{
            mb: 1.5,
            p: 1.5,
            borderRadius: 3,
            background:
              "linear-gradient(90deg, rgba(0,71,127,0.10), rgba(10,111,179,0.10))",
            border: "1px solid rgba(0,71,127,0.15)",
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems="center">
            <Typography sx={{ fontWeight: 600 }}>
              {selected.length} selected
            </Typography>
            <Divider
              orientation="vertical"
              flexItem
              sx={{ display: { xs: "none", md: "block" } }}
            />
            <Typography variant="body2">
              Subtotal: {selectedTotals.subtotal.toFixed(2)} · Tax:{" "}
              {selectedTotals.taxAmt.toFixed(2)} · Service:{" "}
              {selectedTotals.svcAmt.toFixed(2)} · Total:{" "}
              {selectedTotals.totalAmt.toFixed(2)}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Stack direction="row" spacing={1}>
              <Button onClick={exportCsv} variant="outlined">
                Export CSV
              </Button>
              <Button onClick={exportXlsx} variant="outlined">
                Export Excel
              </Button>
              <Button onClick={exportPdf} variant="contained" sx={{ background: "#00477f" }}>
                Combined PDF
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <Stack direction="row" spacing={1}>
            <Button onClick={exportCsv} variant="outlined">
              Export CSV
            </Button>
            <Button onClick={exportXlsx} variant="outlined">
              Export Excel
            </Button>
            <Button onClick={exportPdf} variant="contained" sx={{ background: "#00477f" }}>
              Combined PDF
            </Button>
          </Stack>
        </Box>
      )}

      {/* Data table */}
      <Paper
        elevation={0}
        sx={{ borderRadius: 3, overflow: "hidden", border: "1px solid rgba(0,0,0,0.08)" }}
      >
        {error && (
          <Alert severity="error" sx={{ borderRadius: 0 }}>
            {error}
          </Alert>
        )}

        <TableContainer sx={{ maxHeight: 560 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={
                      selected.length > 0 && selected.length < rows.length
                    }
                    checked={rows.length > 0 && selected.length === rows.length}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </TableCell>
                <TableCell>Doc</TableCell>
                <TableCell>No.</TableCell>
                <TableCell>Issue Date</TableCell>
                <TableCell>Bill-To</TableCell>
                <TableCell>Curr</TableCell>
                <TableCell align="right">Subtotal</TableCell>
                <TableCell align="right">Tax</TableCell>
                <TableCell align="right">Service</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={12} align="center">
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center">
                    <Typography variant="body2" sx={{ py: 3, color: "text.secondary" }}>
                      No invoices found. Adjust filters to see results.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const id = getId(r);
                  const checked = selected.includes(id);
                  const a = computeAmounts(r);
                  const dt = getDocTypeRaw(r);
                  return (
                    <TableRow key={id || getNo(r)} hover selected={checked}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={checked}
                          onChange={(e) => toggleOne(id, e.target.checked)}
                        />
                      </TableCell>
                      <TableCell>{prettyDocType(dt)}</TableCell>
                      <TableCell>{getNo(r)}</TableCell>
                      <TableCell>{getDate(r)}</TableCell>
                      <TableCell>{getBillTo(r)}</TableCell>
                      <TableCell>{getCurrency(r)}</TableCell>
                      <TableCell align="right">{a.subtotal.toFixed(2)}</TableCell>
                      <TableCell align="right">
                        {a.taxPct ? `${a.taxPct}% ` : ""}
                        {a.taxAmt.toFixed(2)}
                      </TableCell>
                      <TableCell align="right">
                        {a.svcPct ? `${a.svcPct}% ` : ""}
                        {a.svcAmt.toFixed(2)}
                      </TableCell>
                      <TableCell align="right">{a.total.toFixed(2)}</TableCell>
                      <TableCell sx={{ textTransform: "capitalize" }}>
                        {String(r.status ?? "—")}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => downloadSinglePdf(r)}
                          >
                            PDF
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => gotoProformaPage(r)}
                            sx={{ background: "#00477f" }}
                          >
                            Proforma Page
                          </Button>

                          {/* NEW: quick status menu */}
                          <RowStatusMenu
                            row={r}
                            onChange={(s) => setInvoiceStatus(r, s)}
                          />
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={limit}
          onRowsPerPageChange={(e) => {
            setLimit(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>
    </Box>
  );
}
