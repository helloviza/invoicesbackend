// apps/frontend/src/pages/import/ImportPage.tsx
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import RequireAuth from "../../components/RequireAuth";
import { api } from "../../api/client";
import { transformForSubmit } from "../invoices/transformForSubmit";

/* ------------------------------------------------------------------ */
/* Types from backend preview                                          */
/* ------------------------------------------------------------------ */
type Draft = {
  clientId: string;
  serviceType:
    | "FLIGHTS"
    | "HOTELS"
    | "HOLIDAYS"
    | "VISAS"
    | "MICE"
    | "STATIONERY"
    | "GIFT_ITEMS"
    | "GOODIES"
    | "OTHER";
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  notes?: string;
  /** Items in the same “raw” shape the form builds (with % fields etc.) */
  itemsRaw: any[];
  /** Optional: if present, will be used as the invoice number (server may ignore) */
  invoiceNo?: string;
};

type PreviewResp = { countRows: number; grouped: number; drafts: Draft[] };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
const toCsv = (rows: Record<string, any>[]) => {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
};

const download = (filename: string, text: string, mime = "text/csv;charset=utf-8") => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const onPick = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    setMsg("");
    if (f) await doPreview(f); // auto–preview after choosing file
  };

  const doPreview = async (f?: File) => {
    const theFile = f ?? file;
    if (!theFile) return;
    setBusy(true);
    setMsg("");
    try {
      const form = new FormData();
      form.append("file", theFile);
      const resp = await api.post<PreviewResp>("/api/import/preview", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreview(resp.data);
      if (!resp.data?.drafts?.length) {
        setMsg("No importable invoices found in the file.");
      }
    } catch (e: any) {
      setMsg(e?.response?.data?.message || e?.response?.data?.error || e?.message || "Preview failed");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!preview?.drafts?.length) return;
    setBusy(true);
    setMsg("");
    let ok = 0,
      fail = 0;
    for (const d of preview.drafts) {
      try {
        const items = transformForSubmit(d.serviceType as any, d.itemsRaw);
        await api.post("/api/invoices", {
          clientId: d.clientId,
          serviceType: d.serviceType,
          issueDate: d.issueDate,
          dueDate: d.dueDate ?? null,
          currency: d.currency,
          items,
          notes: d.notes,
          // Optional: if backend supports custom numbers it can use this
          invoiceNo: (d as any).invoiceNo,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    setMsg(`Import complete: ${ok} created, ${fail} failed.`);
  };

  /* -------------------- Sample templates (CSV) -------------------- */
  /**
   * 1) ITEMISED TEMPLATE (recommended) — one row per line item.
   *    Repeat invoiceNo/clientId for all items in the same invoice.
   *    serviceType decides which item columns are read.
   */
  const downloadItemisedTemplate = () => {
    const headers = [
      // invoice-level
      "invoiceNo(optional)",
      "clientId",
      "serviceType",
      "issueDate(YYYY-MM-DD)",
      "dueDate(YYYY-MM-DD optional)",
      "currency",
      "notes(optional)",
      // item columns (use the set that matches serviceType)
      // FLIGHTS
      "paxName",
      "from",
      "to",
      "airline",
      "pnr",
      "baseFare",
      "taxPct",
      "servicePct",
      // HOTELS
      "hotelName",
      "roomType",
      "rooms",
      "nights",
      "rate",
      // VISAS
      "applicantName",
      "passportNo",
      "country",
      "visaType",
      "processingFee",
      "embassyFee",
      // STATIONERY
      "itemName",
      "description",
      "quantity",
      "unitPrice",
      // OTHER
      "serviceDescription",
      "additionalFees",
    ];

    const rows = [
      // FLIGHTS example
      {
        "invoiceNo(optional)": "",
        clientId: "CLIENT_ID_1",
        serviceType: "FLIGHTS",
        "issueDate(YYYY-MM-DD)": "2025-09-01",
        "dueDate(YYYY-MM-DD optional)": "",
        currency: "INR",
        "notes(optional)": "Trip to BOM",
        paxName: "John Doe",
        from: "DEL",
        to: "BOM",
        airline: "AI",
        pnr: "PNR001",
        baseFare: "12000",
        taxPct: "18",
        servicePct: "0",
      },
      // HOTELS example
      {
        "invoiceNo(optional)": "",
        clientId: "CLIENT_ID_1",
        serviceType: "HOTELS",
        "issueDate(YYYY-MM-DD)": "2025-09-02",
        "dueDate(YYYY-MM-DD optional)": "",
        currency: "INR",
        "notes(optional)": "Mumbai stay",
        paxName: "John Doe",
        hotelName: "Oberoi",
        roomType: "Deluxe",
        rooms: "1",
        nights: "2",
        rate: "8500",
        taxPct: "12",
        servicePct: "0",
      },
      // OTHER example (generic services / fallback)
      {
        "invoiceNo(optional)": "",
        clientId: "CLIENT_ID_2",
        serviceType: "OTHER",
        "issueDate(YYYY-MM-DD)": "2025-09-05",
        "dueDate(YYYY-MM-DD optional)": "",
        currency: "INR",
        "notes(optional)": "",
        serviceDescription: "Consulting",
        quantity: "1",
        unitPrice: "5000",
        additionalFees: "0",
        taxPct: "18",
        servicePct: "0",
      },
    ];

    const csv = toCsv([headers.reduce((o, h) => ({ ...o, [h]: "" }), {}), ...rows]);
    download("Import-Itemised-Template.csv", csv);
  };

  /**
   * 2) HISTORY-EXPORT COMPATIBLE TEMPLATE — one row per invoice (like your export).
   *    Backend will convert totals into a single generic line item if needed.
   *    Use when you only have header totals and not per-item detail.
   */
  const downloadHistoryLikeTemplate = () => {
    const rows = [
      {
        invoiceNo: "", // optional
        clientId: "CLIENT_ID_1",
        serviceType:
          "FLIGHTS|HOTELS|HOLIDAYS|VISAS|MICE|STATIONERY|GIFT_ITEMS|GOODIES|OTHER",
        issueDate: "2025-09-01",
        dueDate: "",
        currency: "INR",
        notes: "Optional notes",
        // Totals (if you have them from export; otherwise leave blank)
        subtotal: "10000",
        taxTotal: "1800",
        total: "11800",
        status: "PAID|SENT|DRAFT", // optional
      },
    ];
    download("Import-HistoryExport-Template.csv", toCsv(rows));
  };

  /* -------------------- Derived counts for preview -------------------- */
  const counts = useMemo(() => {
    const d = preview?.drafts || [];
    const byType = new Map<string, number>();
    for (const r of d) byType.set(r.serviceType, (byType.get(r.serviceType) || 0) + 1);
    return Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ k, v }));
  }, [preview]);

  return (
    <RequireAuth>
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" fontWeight={800}>
            Import Old Bills
          </Typography>
          <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
            Upload <b>.csv</b>, <b>.xlsx</b> or <b>.xls</b>. You can use the{" "}
            <i>Itemised</i> template (best accuracy) or the <i>History-Export</i> template
            (one row per invoice, similar to your History page export).
          </Typography>

          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{ mt: 2 }}
            alignItems={{ xs: "stretch", md: "center" }}
          >
            <Button component="label" variant="outlined">
              Choose File
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                hidden
                onChange={(e) => onPick(e.target.files?.[0] || null)}
              />
            </Button>
            <Chip label={file ? file.name : "No file selected"} />
            <Button onClick={() => doPreview()} variant="outlined" disabled={!file || busy}>
              Preview
            </Button>
            <Button onClick={doImport} variant="contained" disabled={!preview?.drafts?.length || busy}>
              Import {preview?.drafts?.length ? `(${preview.drafts.length})` : ""}
            </Button>
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mt: 2 }}>
            <Button size="small" onClick={downloadItemisedTemplate}>
              Download Sample (Itemised CSV)
            </Button>
            <Button size="small" onClick={downloadHistoryLikeTemplate}>
              Download Sample (History-Export CSV)
            </Button>
          </Stack>

          {busy && <LinearProgress sx={{ mt: 2 }} />}

          {!!msg && (
            <Alert severity={msg.startsWith("Import complete") ? "success" : "info"} sx={{ mt: 2 }}>
              {msg}
            </Alert>
          )}

          {preview && (
            <Paper sx={{ p: 2, mt: 2, bgcolor: "background.default" }} variant="outlined">
              <Typography fontWeight={700}>Preview</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                Rows read: {preview.countRows} • Invoices grouped: {preview.grouped}
              </Typography>

              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                {counts.map(({ k, v }) => (
                  <Chip key={k} label={`${k}: ${v}`} size="small" />
                ))}
              </Stack>

              <Typography variant="body2" sx={{ mt: 1.5, color: "text.secondary" }}>
                Ready to import: {preview.drafts.length} invoice(s)
              </Typography>
            </Paper>
          )}
        </Paper>
      </Container>
    </RequireAuth>
  );
}
