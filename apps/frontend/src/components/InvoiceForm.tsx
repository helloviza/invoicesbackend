// apps/frontend/src/components/InvoiceForm.tsx
import {
  Box,
  Paper,
  Stack,
  Typography,
  TextField,
  Button,
  MenuItem,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Alert,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { CONTRACT } from "../api/contract";

// Live totals + percent→amount transformer
import TotalsPreview from "../pages/invoices/TotalsPreview";
import { transformForSubmit } from "../pages/invoices/transformForSubmit";

/* ------------------------------------------------------------------ */
/* Null-safe helpers                                                   */
/* ------------------------------------------------------------------ */
const s = (v: any) => (v == null ? "" : String(v));
const st = (v: any) => s(v).trim();
const num = (v: string | number | undefined | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const todayISO = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const CURRENCIES = ["INR", "USD", "EUR", "AED", "GBP"] as const;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type ServiceType =
  | "FLIGHTS"
  | "HOTELS"
  | "VISAS"
  | "STATIONERY"
  | "OTHER"
  | "HOLIDAYS"
  | "MICE"
  | "GIFT_ITEMS"
  | "GOODIES";

type Props = {
  clientId: string;
  serviceType: ServiceType;
};

type RowFlights = {
  paxName: string;
  from: string;
  to: string;
  airline?: string;
  pnr?: string;
  baseFare: string;
  taxPct?: string; // %
  servicePct?: string; // %
  currency: string;
};
type RowHotels = {
  paxName: string;
  hotelName?: string;
  roomType: string;
  rooms: string;
  nights: string;
  rate: string;
  taxPct?: string; // %
  servicePct?: string; // %
  currency: string;
};
type RowVisas = {
  applicantName: string;
  passportNo: string;
  country: string;
  visaType: string;
  processingFee: string;
  embassyFee: string;
  servicePct?: string; // %
  currency: string;
};
type RowStationery = {
  itemName: string;
  description?: string;
  quantity: string;
  unitPrice: string;
  taxPct?: string; // %
  servicePct?: string; // %
  currency: string;
};
type RowOther = {
  serviceDescription: string;
  quantity: string;
  unitPrice: string;
  additionalFees: string;
  taxPct?: string; // %
  servicePct?: string; // %
  currency: string;
};

type AnyRow = RowFlights | RowHotels | RowVisas | RowStationery | RowOther;

/* ------------------------------------------------------------------ */
/* Row factories                                                       */
/* ------------------------------------------------------------------ */
function initialRow(type: ServiceType, currency: string): AnyRow {
  switch (type) {
    case "FLIGHTS":
      return {
        paxName: "",
        from: "",
        to: "",
        airline: "",
        pnr: "",
        baseFare: "",
        taxPct: "",
        servicePct: "",
        currency,
      } as RowFlights;
    case "HOTELS":
      return {
        paxName: "",
        hotelName: "",
        roomType: "",
        rooms: "",
        nights: "",
        rate: "",
        taxPct: "",
        servicePct: "",
        currency,
      } as RowHotels;
    case "VISAS":
      return {
        applicantName: "",
        passportNo: "",
        country: "",
        visaType: "",
        processingFee: "",
        embassyFee: "",
        servicePct: "",
        currency,
      } as RowVisas;
    case "STATIONERY":
      return {
        itemName: "",
        description: "",
        quantity: "",
        unitPrice: "",
        taxPct: "",
        servicePct: "",
        currency,
      } as RowStationery;
    case "OTHER":
    case "HOLIDAYS":
    case "MICE":
    case "GIFT_ITEMS":
    case "GOODIES":
    default:
      return {
        serviceDescription: "",
        quantity: "",
        unitPrice: "",
        additionalFees: "",
        taxPct: "",
        servicePct: "",
        currency,
      } as RowOther;
  }
}

/* ------------------------------------------------------------------ */
/* Validation (null-safe)                                              */
/* ------------------------------------------------------------------ */
function rowIsValid(type: ServiceType, r: AnyRow): boolean {
  switch (type) {
    case "FLIGHTS": {
      const x = r as RowFlights;
      return !!st(x.paxName) && !!st(x.from) && !!st(x.to) && !!st(x.baseFare) && !!st(x.currency);
    }
    case "HOTELS": {
      const x = r as RowHotels;
      return !!st(x.paxName) && !!st(x.roomType) && !!st(x.rooms) && !!st(x.nights) && !!st(x.rate) && !!st(x.currency);
    }
    case "VISAS": {
      const x = r as RowVisas;
      return !!st(x.applicantName) && !!st(x.passportNo) && !!st(x.country) && !!st(x.visaType) && !!st(x.processingFee) && !!st(x.currency);
    }
    case "STATIONERY": {
      const x = r as RowStationery;
      return !!st(x.itemName) && !!st(x.quantity) && !!st(x.unitPrice) && !!st(x.currency);
    }
    case "OTHER":
    case "HOLIDAYS":
    case "MICE":
    case "GIFT_ITEMS":
    case "GOODIES":
    default: {
      const x = r as RowOther;
      return !!st(x.serviceDescription) && !!st(x.quantity) && !!st(x.unitPrice) && !!st(x.currency);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Build RAW items (with % fields). The transformer will compute $     */
/* ------------------------------------------------------------------ */
function buildItemsRaw(type: ServiceType, rows: AnyRow[]) {
  switch (type) {
    case "FLIGHTS":
      return rows
        .filter((r) => rowIsValid("FLIGHTS", r))
        .map((r, i) => {
          const x = r as RowFlights;
          const from = st(x.from);
          const to = st(x.to);
          return {
            sNo: i + 1,
            details: {
              paxName: st(x.paxName),
              airline: st(x.airline),
              pnr: st(x.pnr),
              originDestination: from && to ? `${from}-${to}` : undefined,
              fare: num(st(x.baseFare)),
              taxPct: num(st(x.taxPct || 0)),
              servicePct: num(st(x.servicePct || 0)),
              currency: st(x.currency),
            },
          };
        });
    case "HOTELS":
      return rows
        .filter((r) => rowIsValid("HOTELS", r))
        .map((r, i) => {
          const x = r as RowHotels;
          return {
            sNo: i + 1,
            details: {
              paxName: st(x.paxName),
              hotelName: st(x.hotelName),
              roomType: st(x.roomType),
              rooms: num(st(x.rooms)),
              nights: num(st(x.nights)),
              rate: num(st(x.rate)),
              taxPct: num(st(x.taxPct || 0)),
              servicePct: num(st(x.servicePct || 0)),
              currency: st(x.currency),
            },
          };
        });
    case "VISAS":
      return rows
        .filter((r) => rowIsValid("VISAS", r))
        .map((r, i) => {
          const x = r as RowVisas;
          return {
            sNo: i + 1,
            details: {
              applicantName: st(x.applicantName),
              passportNo: st(x.passportNo),
              country: st(x.country),
              visaType: st(x.visaType),
              processingFee: num(st(x.processingFee)),
              embassyFee: num(st(x.embassyFee || 0)),
              servicePct: num(st(x.servicePct || 0)),
              currency: st(x.currency),
            },
          };
        });
    case "STATIONERY":
      return rows
        .filter((r) => rowIsValid("STATIONERY", r))
        .map((r, i) => {
          const x = r as RowStationery;
          return {
            sNo: i + 1,
            details: {
              itemName: st(x.itemName),
              description: st(x.description),
              quantity: num(st(x.quantity)),
              unitPrice: num(st(x.unitPrice)),
              taxPct: num(st(x.taxPct || 0)),
              servicePct: num(st(x.servicePct || 0)),
              currency: st(x.currency),
            },
          };
        });
    case "OTHER":
    case "HOLIDAYS":
    case "MICE":
    case "GIFT_ITEMS":
    case "GOODIES":
    default:
      return rows
        .filter((r) => rowIsValid(type, r))
        .map((r, i) => {
          const x = r as RowOther;
          return {
            sNo: i + 1,
            details: {
              serviceDescription: st(x.serviceDescription),
              quantity: num(st(x.quantity)),
              unitPrice: num(st(x.unitPrice)),
              additionalFees: num(st(x.additionalFees || 0)),
              taxPct: num(st(x.taxPct || 0)),
              servicePct: num(st(x.servicePct || 0)),
              currency: st(x.currency),
            },
          };
        });
  }
}

/* ------------------------------------------------------------------ */
/* Try to open a PDF tab for an invoice id or number.                  */
/* ------------------------------------------------------------------ */
async function tryOpenPdf(idOrNo: string) {
  if (!idOrNo) return;

  const isObjectId = (s: string) => /^[0-9a-f]{24}$/i.test(s);
  const endpoint = isObjectId(idOrNo)
    ? `/api/invoices/${encodeURIComponent(idOrNo)}/pdf`
    : `/api/invoices/by-no/${encodeURIComponent(idOrNo)}/pdf`;

  try {
    const resp = await fetch(endpoint, { headers: { "Cache-Control": "no-store" }});
    const ct = (resp.headers.get("content-type") || "").toLowerCase();

    if (resp.ok && ct.includes("pdf")) {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const text = await resp.text().catch(() => "");
    if (!text) return;
    try {
      const j = JSON.parse(text);
      const url = j?.url || (j?.pdfKey
        ? (/^https?:\/\//i.test(j.pdfKey) ? j.pdfKey
           : `http://localhost:8080/${j.pdfKey.startsWith("static/") ? j.pdfKey : `static/${j.pdfKey}`}`)
        : "");
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* not JSON — ignore */
    }
  } catch {
    /* ignore pdf failures */
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function InvoiceForm({ clientId, serviceType }: Props) {
  const navigate = useNavigate();

  const [issueDate, setIssueDate] = useState<string>(todayISO());
  const [dueDate, setDueDate] = useState<string>("");
  const [currency, setCurrency] = useState<string>("INR");
  const [notes, setNotes] = useState<string>("");

  // NEW: document type (Tax Invoice vs Proforma)
  type DocKind = "INVOICE" | "PROFORMA";
  const [docKind, setDocKind] = useState<DocKind>("INVOICE");

  const [rows, setRows] = useState<AnyRow[]>([initialRow(serviceType, currency)]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  // Reset the table shape when service type changes
  useEffect(() => {
    setRows([initialRow(serviceType, currency)]);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType]);

  // Guarded currency sync
  useEffect(() => {
    setRows((rs) => {
      const needsUpdate = rs.some((r: any) => s((r as any).currency) !== currency);
      return needsUpdate ? rs.map((r: any) => ({ ...r, currency })) : rs;
    });
  }, [currency]);

  const canSubmit = useMemo(() => {
    if (!st(clientId) || !st(issueDate)) return false;
    return rows.some((r) => rowIsValid(serviceType, r));
  }, [clientId, issueDate, rows, serviceType]);

  const addRow = () => setRows((rs) => [...rs, initialRow(serviceType, currency)]);
  const removeRow = (idx: number) => setRows((rs) => rs.filter((_, i) => i !== idx));
  const update = (idx: number, key: string, value: string) =>
    setRows((rs) => {
      const cp = [...rs];
      cp[idx] = { ...(cp[idx] as any), [key]: value } as AnyRow;
      return cp;
    });

  const previewItems = useMemo(() => buildItemsRaw(serviceType, rows), [serviceType, rows]);

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError("");

    try {
      // 1) Build raw items (with % fields)
      const rawItems = previewItems;
      if (!rawItems.length) throw new Error("Please enter at least one valid line item.");

      // 2) Convert % → amounts for backend (schema unchanged)
      const items = transformForSubmit(serviceType, rawItems);

      const isProforma = docKind === "PROFORMA";

      const body: Record<string, any> = {
        clientId,
        serviceType,
        issueDate,
        dueDate: st(dueDate) || null,
        currency,
        items,
        notes: st(notes) || undefined,

        // --- NEW durable hints that most backends will persist -------------
        status: isProforma ? "proforma" : undefined,
        documentKind: isProforma ? "PROFORMA" : "INVOICE",
        docType: isProforma ? "PROFORMA" : "INVOICE",
        meta: {
          ...(st(notes) ? { notes } : {}),
          documentKind: isProforma ? "PROFORMA" : "INVOICE",
          isProforma: isProforma ? true : undefined,
        },
      };

      // 3) Create invoice
      const createdResp = await api.post(CONTRACT.endpoints.invoiceCreate, body, {
        headers: { "Content-Type": "application/json" },
      });
      const created = CONTRACT.normalizeInvoiceCreateResp(createdResp);

      // 4) Route user
      navigate("/history", { replace: true });

      // 5) Fire-and-forget PDF open
      const c = created as any;
      const idOrNo = c?.id ?? c?._id ?? c?.invoiceId ?? c?.invoiceNo ?? "";
      if (idOrNo) void tryOpenPdf(idOrNo);
    } catch (e: any) {
      const status = e?.response?.status;
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to create invoice";
      setError(`Create failed${status ? ` (HTTP ${status})` : ""}: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- Table renderers ------------------------ */
  const renderHeader = (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
        Header
      </Typography>
      {!!error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: "pre-line" }}>
          {error}
        </Alert>
      )}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems="flex-start"
        sx={{ "& .MuiInputBase-input": { fontSize: "0.875rem" } }}
      >
        <TextField
          label="Issue Date *"
          type="date"
          value={issueDate}
          onChange={(e) => setIssueDate(e.target.value)}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          label="Due Date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          select
          label="Currency *"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          size="small"
          sx={{ minWidth: 140 }}
        >
          {CURRENCIES.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>

        {/* NEW: Document Type */}
        <TextField
          select
          label="Document Type"
          value={docKind}
          onChange={(e) => setDocKind(e.target.value as any)}
          size="small"
          sx={{ minWidth: 190 }}
          helperText={docKind === "PROFORMA" ? "Proforma is for client approval; not a tax invoice." : "Tax-ready invoice"}
        >
          <MenuItem value="INVOICE">Tax Invoice</MenuItem>
          <MenuItem value="PROFORMA">Proforma Invoice</MenuItem>
        </TextField>
      </Stack>

      <TextField
        label="Notes"
        multiline
        minRows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        size="small"
        fullWidth
        sx={{ mt: 2 }}
      />
    </Paper>
  );

  function renderFlights() {
    return (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
          Line Items — FLIGHTS
        </Typography>
        <Table size="small" sx={{ "& .MuiInputBase-input": { fontSize: "0.875rem" } }}>
          <TableHead>
            <TableRow>
              <TableCell width={48}>S. No.</TableCell>
              <TableCell>Passenger Name *</TableCell>
              <TableCell>From *</TableCell>
              <TableCell>To *</TableCell>
              <TableCell>Airline</TableCell>
              <TableCell>PNR</TableCell>
              <TableCell>Base Fare *</TableCell>
              <TableCell>Tax %</TableCell>
              <TableCell>Service %</TableCell>
              <TableCell>Currency *</TableCell>
              <TableCell align="right" width={56}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => {
              const x = r as RowFlights;
              return (
                <TableRow key={i} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <TextField
                      value={s(x.paxName)}
                      onChange={(e) => update(i, "paxName", e.target.value)}
                      size="small"
                      fullWidth
                    />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.from)} onChange={(e) => update(i, "from", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.to)} onChange={(e) => update(i, "to", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.airline)} onChange={(e) => update(i, "airline", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.pnr)} onChange={(e) => update(i, "pnr", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={s(x.baseFare)}
                      onChange={(e) => update(i, "baseFare", e.target.value)}
                      size="small"
                      type="number"
                      inputProps={{ min: 0, step: "0.01" }}
                      fullWidth
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={s(x.taxPct)}
                      onChange={(e) => update(i, "taxPct", e.target.value)}
                      size="small"
                      type="number"
                      inputProps={{ min: 0, step: "0.01" }}
                      fullWidth
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={s(x.servicePct)}
                      onChange={(e) => update(i, "servicePct", e.target.value)}
                      size="small"
                      type="number"
                      inputProps={{ min: 0, step: "0.01" }}
                      fullWidth
                    />
                  </TableCell>
                  <TableCell>
                    <TextField select value={s(x.currency)} onChange={(e) => update(i, "currency", e.target.value)} size="small" fullWidth>
                      {CURRENCIES.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={11}>
                <Button startIcon={<AddIcon />} onClick={addRow} size="small" variant="outlined">
                  Add Line
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <TotalsPreview serviceType="FLIGHTS" items={previewItems} currency={currency} />

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : docKind === "PROFORMA" ? "Create Proforma" : "Create Invoice"}
          </Button>
        </Stack>
      </Paper>
    );
  }

  function renderHotels() {
    return (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
          Line Items — HOTELS
        </Typography>
        <Table size="small" sx={{ "& .MuiInputBase-input": { fontSize: "0.875rem" } }}>
          <TableHead>
            <TableRow>
              <TableCell width={48}>S. No.</TableCell>
              <TableCell>Guest *</TableCell>
              <TableCell>Hotel</TableCell>
              <TableCell>Room Type *</TableCell>
              <TableCell>Rooms *</TableCell>
              <TableCell>Nights *</TableCell>
              <TableCell>Rate *</TableCell>
              <TableCell>Tax %</TableCell>
              <TableCell>Service %</TableCell>
              <TableCell>Currency *</TableCell>
              <TableCell align="right" width={56}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => {
              const x = r as RowHotels;
              return (
                <TableRow key={i} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <TextField value={s(x.paxName)} onChange={(e) => update(i, "paxName", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.hotelName)} onChange={(e) => update(i, "hotelName", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.roomType)} onChange={(e) => update(i, "roomType", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.rooms)} onChange={(e) => update(i, "rooms", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.nights)} onChange={(e) => update(i, "nights", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.rate)} onChange={(e) => update(i, "rate", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.taxPct)} onChange={(e) => update(i, "taxPct", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.servicePct)} onChange={(e) => update(i, "servicePct", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField select value={s(x.currency)} onChange={(e) => update(i, "currency", e.target.value)} size="small" fullWidth>
                      {CURRENCIES.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={11}>
                <Button startIcon={<AddIcon />} onClick={addRow} size="small" variant="outlined">
                  Add Line
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <TotalsPreview serviceType="HOTELS" items={previewItems} currency={currency} />

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : docKind === "PROFORMA" ? "Create Proforma" : "Create Invoice"}
          </Button>
        </Stack>
      </Paper>
    );
  }

  function renderVisas() {
    return (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
          Line Items — VISAS
        </Typography>
        <Table size="small" sx={{ "& .MuiInputBase-input": { fontSize: "0.875rem" } }}>
          <TableHead>
            <TableRow>
              <TableCell width={48}>S. No.</TableCell>
              <TableCell>Applicant *</TableCell>
              <TableCell>Passport No. *</TableCell>
              <TableCell>Country *</TableCell>
              <TableCell>Visa Type *</TableCell>
              <TableCell>Processing Fee *</TableCell>
              <TableCell>Embassy Fee</TableCell>
              <TableCell>Service %</TableCell>
              <TableCell>Currency *</TableCell>
              <TableCell align="right" width={56}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => {
              const x = r as RowVisas;
              return (
                <TableRow key={i} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <TextField value={s(x.applicantName)} onChange={(e) => update(i, "applicantName", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.passportNo)} onChange={(e) => update(i, "passportNo", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.country)} onChange={(e) => update(i, "country", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.visaType)} onChange={(e) => update(i, "visaType", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.processingFee)} onChange={(e) => update(i, "processingFee", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.embassyFee)} onChange={(e) => update(i, "embassyFee", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.servicePct)} onChange={(e) => update(i, "servicePct", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField select value={s(x.currency)} onChange={(e) => update(i, "currency", e.target.value)} size="small" fullWidth>
                      {CURRENCIES.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={11}>
                <Button startIcon={<AddIcon />} onClick={addRow} size="small" variant="outlined">
                  Add Line
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <TotalsPreview serviceType="VISAS" items={previewItems} currency={currency} />

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : docKind === "PROFORMA" ? "Create Proforma" : "Create Invoice"}
          </Button>
        </Stack>
      </Paper>
    );
  }

  function renderStationery() {
    return (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
          Line Items — STATIONERY
        </Typography>
        <Table size="small" sx={{ "& .MuiInputBase-input": { fontSize: "0.875rem" } }}>
          <TableHead>
            <TableRow>
              <TableCell width={48}>S. No.</TableCell>
              <TableCell>Item *</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Qty *</TableCell>
              <TableCell>Unit Price *</TableCell>
              <TableCell>Tax %</TableCell>
              <TableCell>Service %</TableCell>
              <TableCell>Currency *</TableCell>
              <TableCell align="right" width={56}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => {
              const x = r as RowStationery;
              return (
                <TableRow key={i} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <TextField value={s(x.itemName)} onChange={(e) => update(i, "itemName", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.description)} onChange={(e) => update(i, "description", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.quantity)} onChange={(e) => update(i, "quantity", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.unitPrice)} onChange={(e) => update(i, "unitPrice", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.taxPct)} onChange={(e) => update(i, "taxPct", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.servicePct)} onChange={(e) => update(i, "servicePct", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField select value={s(x.currency)} onChange={(e) => update(i, "currency", e.target.value)} size="small" fullWidth>
                      {CURRENCIES.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={11}>
                <Button startIcon={<AddIcon />} onClick={addRow} size="small" variant="outlined">
                  Add Line
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <TotalsPreview serviceType="STATIONERY" items={previewItems} currency={currency} />

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : docKind === "PROFORMA" ? "Create Proforma" : "Create Invoice"}
          </Button>
        </Stack>
      </Paper>
    );
  }

  function renderOther() {
    return (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
          Line Items — {serviceType}
        </Typography>
        <Table size="small" sx={{ "& .MuiInputBase-input": { fontSize: "0.875rem" } }}>
          <TableHead>
            <TableRow>
              <TableCell width={48}>S. No.</TableCell>
              <TableCell>Description *</TableCell>
              <TableCell>Qty *</TableCell>
              <TableCell>Unit Price *</TableCell>
              <TableCell>Additional Fees</TableCell>
              <TableCell>Tax %</TableCell>
              <TableCell>Service %</TableCell>
              <TableCell>Currency *</TableCell>
              <TableCell align="right" width={56}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => {
              const x = r as RowOther;
              return (
                <TableRow key={i} hover>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <TextField value={s(x.serviceDescription)} onChange={(e) => update(i, "serviceDescription", e.target.value)} size="small" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.quantity)} onChange={(e) => update(i, "quantity", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.unitPrice)} onChange={(e) => update(i, "unitPrice", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.additionalFees)} onChange={(e) => update(i, "additionalFees", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.taxPct)} onChange={(e) => update(i, "taxPct", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField value={s(x.servicePct)} onChange={(e) => update(i, "servicePct", e.target.value)} size="small" type="number" fullWidth />
                  </TableCell>
                  <TableCell>
                    <TextField select value={s(x.currency)} onChange={(e) => update(i, "currency", e.target.value)} size="small" fullWidth>
                      {CURRENCIES.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell colSpan={11}>
                <Button startIcon={<AddIcon />} onClick={addRow} size="small" variant="outlined">
                  Add Line
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <TotalsPreview serviceType={serviceType} items={previewItems} currency={currency} />

        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : docKind === "PROFORMA" ? "Create Proforma" : "Create Invoice"}
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Box sx={{ width: "100%" }}>
      {renderHeader}
      {serviceType === "FLIGHTS"
        ? renderFlights()
        : serviceType === "HOTELS"
        ? renderHotels()
        : serviceType === "VISAS"
        ? renderVisas()
        : serviceType === "STATIONERY"
        ? renderStationery()
        : renderOther()}
    </Box>
  );
}
