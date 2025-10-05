/* eslint-disable @typescript-eslint/no-explicit-any */
import PdfPrinter from "pdfmake";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * Exports
 *   - buildInvoiceDocDef(inv): PdfMake document definition (TAX invoice)
 *   - buildProformaDocDef(inv): PdfMake document definition (PROFORMA layout)
 *   - isProforma(inv): robust detector (meta flags + docType + number prefixes)
 *   - renderPdfBuffer(docDef): Promise<Buffer>
 */

type BankJson = {
  accountName?: string;
  bankName?: string;
  accountNo?: string;
  ifsc?: string;
  swift?: string;
  branch?: string;
  upiId?: string;
  notes?: string;
  // legacy aliases:
  beneficiary?: string;
  name?: string;
  account?: string;
};

type InvoiceWithRels = {
  invoiceNo: string;
  issueDate: Date | string;
  dueDate: Date | string | null;
  currency: string;
  baseCurrency?: string;
  status?: string | null;
  serviceType: string;

  subtotal: string;
  taxTotal: string;
  serviceCharges: string;
  grandTotal: string;

  // proforma hints
  documentKind?: string | null;
  docType?: string | null;

  notes?: string | null;
  bankJson?: BankJson | null;
  meta?: {
    irn?: string;
    invoiceUrl?: string;
    gst?: { cgst?: number; sgst?: number; igst?: number };
    terms?: string[];
    bank?: BankJson | null; // legacy snapshot
    isProforma?: boolean;
    documentKind?: string | null;
    docType?: string | null;
  } | null;

  client: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    address1?: string | null;
    address2?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    postalCode?: string | null;
    country?: string | null;
    gstin?: string | null;
    pan?: string | null;
    website?: string | null;
    logoUrl?: string | null;
    meta?: any;
  };

  // for the table (keep permissive to avoid JsonValue noise)
  items: Array<{ sNo: number; details: any; lineTotal: string | null }>;
};

/* ---------------- helpers: env & formatting ---------------- */
const parseBool = (v: string | undefined, def = true) =>
  v == null ? def : /^(1|true|yes|on)$/i.test(v);
const parseNum = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const COLOR = {
  primary: process.env.THEME_PRIMARY_COLOR || "#00477f",
  light: process.env.THEME_LIGHT_COLOR || "#EEF2FF",
  gray: process.env.THEME_GRAY_COLOR || "#6B7280",
  tableHead: process.env.THEME_TABLEHEAD_COLOR || "#F3F4F6",
};

const FONT_SCALE = Math.max(0.5, parseNum(process.env.FONT_SCALE, 0.68));
const scale = (n: number) => Math.max(6, Math.round(n * FONT_SCALE));

// page margins with safe types
const PAGE_MARGINS: [number, number, number, number] = (() => {
  const v = process.env.PAGE_MARGINS;
  if (!v) return [24, 24, 24, 28];
  const parts = v.split(",").map((s) => Number(s.trim()));
  return parts.length === 4 && parts.every(Number.isFinite)
    ? (parts as [number, number, number, number])
    : [24, 24, 24, 28];
})();

const TABLE_CELL_PAD = parseNum(process.env.TABLE_CELL_PAD, 2);
const SHOW_HEADER = parseBool(process.env.SHOW_HEADER, true);
const SHOW_FOOTER = parseBool(process.env.SHOW_FOOTER, true);
const FOOTER_LEFT_TEXT = process.env.FOOTER_LEFT_TEXT || "";
const FOOTER_RIGHT_TEXT =
  process.env.FOOTER_RIGHT_TEXT || "Page {page} of {pages}";

// ---- Logo sizing (env overridable) ----
const LOGO_W_TAX = parseNum(process.env.LOGO_W_TAX, 80);
const LOGO_H_TAX = parseNum(process.env.LOGO_H_TAX, 30);
const LOGO_W_PROFORMA = parseNum(process.env.LOGO_W_PROFORMA, 80);
const LOGO_H_PROFORMA = parseNum(process.env.LOGO_H_PROFORMA, 30);

const exists = (p: string) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

// --- logo helpers ---
function resolvePathMaybeRelative(p?: string | null): string | undefined {
  if (!p) return undefined;
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}
function loadLogoBase64FromPath(p?: string | null): string | undefined {
  const full = resolvePathMaybeRelative(p);
  if (!full) return undefined;
  try {
    const buf = fs.readFileSync(full);
    const ext = full.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    return `data:image/${ext};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}
function coerceAnyLogo(value?: string | null): string | undefined {
  if (!value) return undefined;
  const s = String(value);
  if (s.startsWith("data:image/")) return s; // already base64
  // otherwise treat as local path
  return loadLogoBase64FromPath(s);
}

function roboto(dir: string) {
  return {
    normal: path.join(dir, "Roboto-Regular.ttf"),
    bold: path.join(dir, "Roboto-Medium.ttf"),
    italics: path.join(dir, "Roboto-Italic.ttf"),
    bolditalics: path.join(dir, "Roboto-MediumItalic.ttf"),
  };
}
function arial(dir: string) {
  return {
    normal: path.join(dir, "arial.ttf"),
    bold: path.join(dir, "arialbd.ttf"),
    italics: path.join(dir, "ariali.ttf"),
    bolditalics: path.join(dir, "arialbi.ttf"),
  };
}

function pickFonts(): { family: "Roboto" | "Arial"; def: any } {
  const override = process.env.PDF_FONTS_DIR;
  if (override) {
    if (exists(path.join(override, "Roboto-Regular.ttf")))
      return { family: "Roboto", def: { Roboto: roboto(override) } };
    if (exists(path.join(override, "arial.ttf")))
      return { family: "Arial", def: { Arial: arial(override) } };
  }
  const project = path.join(process.cwd(), "src", "assets", "fonts");
  if (exists(path.join(project, "Roboto-Regular.ttf")))
    return { family: "Roboto", def: { Roboto: roboto(project) } };
  if (exists(path.join(project, "arial.ttf")))
    return { family: "Arial", def: { Arial: arial(project) } };

  if (os.platform() === "win32") {
    const winFonts = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "Fonts"
    );
    if (
      ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"].every((f) =>
        exists(path.join(winFonts, f))
      )
    ) {
      return { family: "Arial", def: { Arial: arial(winFonts) } };
    }
  }
  const candidates = [
    path.join(process.cwd(), "pdfmake", "examples", "fonts"),
    path.join(
      process.cwd(),
      "node_modules",
      ".pnpm",
      "pdfmake@0.2.20",
      "node_modules",
      "pdfmake",
      "examples",
      "fonts"
    ),
  ];
  for (const dir of candidates) {
    if (exists(path.join(dir, "Roboto-Regular.ttf")))
      return { family: "Roboto", def: { Roboto: roboto(dir) } };
  }
  throw new Error(
    "PDF fonts not found. Set PDF_FONTS_DIR or copy Arial/Roboto TTFs to src/assets/fonts."
  );
}
const fonts = pickFonts();
const printer = new (PdfPrinter as any)(fonts.def);

const asNum = (v?: string | number | null) =>
  v == null ? 0 : typeof v === "number" ? v : Number(v);
const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
const money = (s?: string | null) => s ?? "0.00";
const fmtDate = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "-";

/* ---------------- dynamic columns for TAX layout ---------------- */
const HEADERS: Record<string, { key: string; label: string }[]> = {
  FLIGHTS: [
    { key: "paxName", label: "Passenger" },
    { key: "originDestination", label: "Sectors" },
    { key: "airline", label: "Airline" },
    { key: "pnr", label: "PNR" },
    { key: "fare", label: "Base Fare" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  HOTELS: [
    { key: "paxName", label: "Guest" },
    { key: "hotelName", label: "Hotel" },
    { key: "roomType", label: "Room Type" },
    { key: "rooms", label: "Rooms" },
    { key: "nights", label: "Nights" },
    { key: "rate", label: "Rate" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  HOLIDAYS: [
    { key: "packageName", label: "Package" },
    { key: "pax", label: "PAX" },
    { key: "nightsDays", label: "Nights/Days" },
    { key: "rate", label: "Rate" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  VISAS: [
    { key: "applicantName", label: "Applicant" },
    { key: "passportNo", label: "Passport" },
    { key: "country", label: "Country" },
    { key: "visaType", label: "Type" },
    { key: "processingFee", label: "Proc. Fee" },
    { key: "embassyFee", label: "Embassy Fee" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  MICE: [
    { key: "eventName", label: "Event" },
    { key: "location", label: "Location" },
    { key: "days", label: "Days" },
    { key: "pax", label: "PAX" },
    { key: "rate", label: "Rate" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  STATIONERY: [
    { key: "itemName", label: "Item" },
    { key: "description", label: "Description" },
    { key: "quantity", label: "Qty" },
    { key: "unitPrice", label: "Unit Price" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  GIFT_ITEMS: [
    { key: "itemName", label: "Item" },
    { key: "quantity", label: "Qty" },
    { key: "unitPrice", label: "Unit Price" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  GOODIES: [
    { key: "itemName", label: "Item" },
    { key: "quantity", label: "Qty" },
    { key: "unitPrice", label: "Unit Price" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
  OTHER: [
    { key: "description", label: "Description" },
    { key: "quantity", label: "Qty" },
    { key: "unitPrice", label: "Unit Price" },
    { key: "additionalFees", label: "Addl. Fees" },
    { key: "tax", label: "Tax" },
    { key: "serviceCharges", label: "Svc" },
    { key: "currency", label: "Curr" },
  ],
};

/* ---------------- bank helpers ---------------- */
function envBankDefaults(): BankJson | undefined {
  const v = (k: string) => process.env[k]?.trim() || undefined;
  const bank: BankJson = {
    accountName: v("BANK_ACCOUNT_NAME"),
    bankName: v("BANK_NAME"),
    accountNo: v("BANK_ACCOUNT_NO"),
    ifsc: v("BANK_IFSC"),
    swift: v("BANK_SWIFT"),
    branch: v("BANK_BRANCH"),
    upiId: v("BANK_UPI"),
    notes: v("BANK_NOTES"),
  };
  return Object.values(bank).some(Boolean) ? bank : undefined;
}
function normalizeBank(b?: BankJson | null): BankJson | undefined {
  if (!b) return undefined;
  return {
    accountName: b.accountName ?? b.beneficiary ?? undefined,
    bankName: b.bankName ?? b.name ?? undefined,
    accountNo: b.accountNo ?? b.account ?? undefined,
    ifsc: b.ifsc,
    swift: b.swift,
    branch: b.branch,
    upiId: b.upiId,
    notes: b.notes,
  };
}

/* ---------------- Proforma detector ---------------- */
export function isProforma(inv: Partial<InvoiceWithRels>): boolean {
  const s = (x?: string | null) => (x || "").toLowerCase().trim();
  const number = s((inv as any)?.invoiceNo);
  const meta = (inv as any)?.meta || {};

  if (meta?.isProforma === true) return true;
  if (/pro-?forma|per-?forma/.test(s(inv.status))) return true;
  if (/pro-?forma|per-?forma/.test(s(inv.documentKind))) return true;
  if (/pro-?forma|per-?forma/.test(s(inv.docType))) return true;
  if (/pro-?forma|per-?forma/.test(s(meta?.documentKind))) return true;
  if (/pro-?forma|per-?forma/.test(s(meta?.docType))) return true;

  if (/^(qt|qtn|quo|pi|pfi|pf)[-_/]/.test(number)) return true;
  if (/\b(proforma|performa)\b/.test(number)) return true;

  return false;
}

/* ---------------- utility: Rupees in words (integer part) ---------------- */
function rupeesInWords(amount: number): string {
  const units = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  function twoDigits(n: number) {
    return n < 20 ? units[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + units[n % 10] : ""}`;
  }
  function threeDigits(n: number) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return `${h ? units[h] + " Hundred" : ""}${h && rest ? " " : ""}${rest ? twoDigits(rest) : ""}`.trim();
  }
  if (!Number.isFinite(amount)) return "";
  const n = Math.floor(Math.abs(amount));
  if (n === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${threeDigits(hundred)}`);
  return `${parts.join(" ")} Rupees Only`;
}

/* ---------------- address helper (now reads client.meta.address too) ---------------- */
function buildClientAddress(c: InvoiceWithRels["client"] | undefined | null): string {
  if (!c) return "";

  // 1) If a ready-to-print blob exists, use it
  if (typeof c.address === "string" && c.address.trim()) {
    return c.address.trim();
  }

  // 2) Prefer structured fields under client.meta.address if present
  const meta: any = (c as any).meta || {};
  const a: any = meta.address || {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = a?.[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };

  const line1 = pick("line1", "address1", "street");
  const line2 = pick("line2", "address2");
  const city  = pick("city", "town");
  const state = pick("state", "province", "region");
  const pin   = pick("postalCode", "postcode", "zip", "pincode");
  const country = pick("country");

  const partsMeta: string[] = [];
  if (line1) partsMeta.push(line1);
  if (line2) partsMeta.push(line2);

  const cityState = [city, state].filter(Boolean).join(", ");
  if (cityState) partsMeta.push(cityState);

  const pinCountry = [pin, country].filter(Boolean).join(", ");
  if (pinCountry) partsMeta.push(pinCountry);

  // If meta.address yielded something, return it (multi-line)
  if (partsMeta.length) {
    return partsMeta.join("\n");
  }

  // 3) Fallback to top-level structured fields on client
  const pieces = [
    c.address1,
    c.address2,
    c.street,
    c.city,
    c.state,
    c.pincode || c.postalCode,
    c.country,
  ]
    .map((x) => (x ? String(x).trim() : ""))
    .filter(Boolean);

  return pieces.join(", ");
}


/* ---------------- QR helper ---------------- */
const QR_VALUE = process.env.PDF_QR_URL || "https://plumtrips.com";

/* ============================================================================
   TAX INVOICE (existing layout) + QR
============================================================================ */
export function buildInvoiceDocDef(inv: InvoiceWithRels): any {
  const company = {
    name: process.env.COMPANY_NAME || "PlumTrips",
    address: process.env.COMPANY_ADDRESS || "",
    email: process.env.COMPANY_EMAIL || "",
    phone: process.env.COMPANY_PHONE || "",
    website: process.env.COMPANY_WEBSITE || "",
    gstin: process.env.COMPANY_GSTIN || "",
    pan: process.env.COMPANY_PAN || "",
    state: process.env.COMPANY_STATE || "",
  };

  const billTo = {
    name: inv.client?.name ?? "",
    address: buildClientAddress(inv.client),
    email: inv.client?.email ?? "",
    phone: inv.client?.phone ?? "",
    website: inv.client?.website ?? "",
    gstin: inv.client?.gstin ?? "",
    pan: inv.client?.pan ?? "",
  };

  const leftLogo = loadLogoBase64FromPath(process.env.COMPANY_LOGO_PATH);
  const rightLogo =
    loadLogoBase64FromPath(process.env.BILL_TO_COMPANY_LOGO_PATH) ??
    coerceAnyLogo(inv.client?.logoUrl || null);

  const titleText = "TAX INVOICE";

  const headerBand = SHOW_HEADER
    ? {
        table: { widths: ["*" as const], body: [[" "]], heights: () => 4 },
        layout: {
          fillColor: () => COLOR.primary,
          hLineWidth: () => 0,
          vLineWidth: () => 0,
        },
        margin: [0, 0, 0, 8],
      }
    : null;

  const headerRow = SHOW_HEADER
    ? {
        columns: [
          {
            width: "*",
            stack: [
              leftLogo ? { image: leftLogo, width: LOGO_W_TAX, height: LOGO_H_TAX, margin: [0, 2, 0, 6] } : null,
              { text: company.name, style: "brand" },
              company.address ? { text: company.address, style: "muted" } : null,
              company.email ? { text: company.email, style: "muted" } : null,
              company.phone ? { text: company.phone, style: "muted" } : null,
              company.website ? { text: company.website, style: "muted" } : null,
              company.gstin ? { text: `GSTIN: ${company.gstin}`, style: "muted" } : null,
              company.pan ? { text: `PAN: ${company.pan}`, style: "muted" } : null,
            ].filter(Boolean),
          },
          {
            width: "*",
            stack: [
              { text: titleText, style: "titleRight" },
              { text: "BILL TO", style: "billTo" },
              rightLogo
                ? { image: rightLogo, width: 110, alignment: "right", margin: [0, 6, 0, 6] }
                : null,
              billTo.name ? { text: billTo.name, style: "billToName" } : null,
              billTo.address ? { text: billTo.address, style: "mutedRight" } : null,
              billTo.email ? { text: billTo.email, style: "mutedRight" } : null,
              billTo.phone ? { text: billTo.phone, style: "mutedRight" } : null,
              billTo.website ? { text: billTo.website, style: "mutedRight" } : null,
              billTo.gstin ? { text: `GSTIN: ${billTo.gstin}`, style: "mutedRight" } : null,
              billTo.pan ? { text: `PAN: ${billTo.pan}`, style: "mutedRight" } : null,
            ].filter(Boolean),
            alignment: "right",
          },
        ],
        columnGap: 16,
        margin: [0, 0, 0, 8],
      }
    : null;

  const metaGrid = {
    table: {
      widths: ["*", "*", "*"] as const,
      body: [
        [
          { text: `Invoice No: ${inv.invoiceNo}`, bold: true },
          { text: `Invoice Date: ${fmtDate(inv.issueDate)}` },
          { text: `Due Date: ${fmtDate(inv.dueDate)}`, alignment: "right" },
        ],
        [
          { text: `Currency: ${inv.currency}`, color: COLOR.gray },
          { text: inv.status ? `Status: ${inv.status}` : "", color: COLOR.gray },
          { text: "", color: COLOR.gray },
        ],
      ],
    },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 8],
  };

  const headers = HEADERS[inv.serviceType] || HEADERS.OTHER;
  const tableHeader = ["S. No.", ...headers.map((h) => h.label), "Line Total"];
  const tableWidths: Array<number | "*" | "auto"> = [34, ...headers.map((): "*" => "*"), 90];

  const bodyRows = inv.items.map((it, idx) => {
    const cells = headers.map((h) => {
      const val = (it.details as any)?.[h.key];
      return val == null ? "" : String(val);
    });
    const row = [String(it.sNo), ...cells, money(it.lineTotal)];
    return row.map((cell) => ({
      text: cell,
      fillColor: idx % 2 === 0 ? null : "#FAFAFA",
    }));
  });

  const serviceTable = {
    table: {
      headerRows: 1,
      widths: tableWidths,
      body: [
        tableHeader.map((h) => ({ text: h, style: "tableHeader", fillColor: COLOR.tableHead })),
        ...bodyRows,
      ],
      dontBreakRows: true,
      keepWithHeaderRows: 1,
    },
    layout: {
      fillColor: () => null,
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      paddingLeft: () => TABLE_CELL_PAD,
      paddingRight: () => TABLE_CELL_PAD,
      paddingTop: () => Math.max(2, TABLE_CELL_PAD - 1),
      paddingBottom: () => Math.max(2, TABLE_CELL_PAD - 1),
    },
    margin: [0, 4, 0, 10],
  };

  const subtotalN = asNum(inv.subtotal);
  const taxN = asNum(inv.taxTotal);
  const svcN = asNum(inv.serviceCharges);
  const grandN = asNum(inv.grandTotal);
  const gst = inv.meta?.gst;

  const taxTableBody: any[] = [
    [
      { text: "Label", bold: true, decoration: "underline" },
      { text: "Amount", bold: true, alignment: "right", decoration: "underline" },
    ],
    ["Subtotal", inr(subtotalN)],
  ];
  if (gst && (gst.cgst != null || gst.sgst != null || gst.igst != null)) {
    if (gst.cgst != null) taxTableBody.push(["CGST", inr(Number(gst.cgst))]);
    if (gst.sgst != null) taxTableBody.push(["SGST", inr(Number(gst.sgst))]);
    if (gst.igst != null) taxTableBody.push(["IGST", inr(Number(gst.igst))]);
  } else {
    taxTableBody.push(["Tax", inr(taxN)]);
  }
  taxTableBody.push(["Service Charges", inr(svcN)]);
  taxTableBody.push([{ text: "Grand Total", bold: true }, { text: inr(grandN), bold: true }]);

  const totalsRow = {
    columns: [
      inv.notes
        ? { width: "*", stack: [{ text: "Notes", style: "section" }, { text: inv.notes, style: "muted" }] }
        : { width: "*", text: "" },
      {
        width: "auto",
        stack: [{ table: { widths: ["*", "auto"] as const, body: taxTableBody }, layout: "lightHorizontalLines" }],
      },
    ],
    columnGap: 24,
    margin: [0, 0, 0, 8],
  };

  const bank: BankJson | undefined =
    normalizeBank(inv.bankJson) || normalizeBank(inv.meta?.bank ?? null) || envBankDefaults();

  let bankBlock: any = null;
  if (bank && Object.values(bank).some(Boolean)) {
    const rows: any[] = [];
    const push = (label: string, val?: string) => (val ? rows.push([{ text: label, bold: true }, val]) : null);
    push("Account Name", bank.accountName ?? bank.beneficiary);
    push("Bank Name", bank.bankName ?? bank.name);
    push("Account No", bank.accountNo ?? bank.account);
    push("IFSC", bank.ifsc);
    push("SWIFT", bank.swift);
    push("Branch", bank.branch);
    push("UPI ID", bank.upiId);
    push("Notes", bank.notes);

    if (rows.length) {
      bankBlock = {
        stack: [
          { text: "Bank Details", style: "section" },
          { table: { widths: ["auto", "*"] as const, body: rows }, layout: "lightHorizontalLines", margin: [0, 0, 0, 6] },
        ],
      };
    }
  }

  const terms =
    inv.meta?.terms && inv.meta.terms.length
      ? inv.meta.terms
      : [
          "All disputes subject to jurisdiction as per company policy.",
          "Refunds & cancellations are subject to supplier approval.",
          "Service charges (if any) are to be collected on our behalf.",
          "Please verify all details to avoid discrepancies.",
        ];
  const termsBlock = {
    stack: [{ text: "Terms & Conditions", style: "section" }, { ul: terms.map((t) => ({ text: t, style: "muted" })) }],
  };

  const signatureRow = {
    columns: [
      { qr: QR_VALUE, fit: 70, alignment: "left", margin: [0, 6, 0, 0] },
      { text: "For " + company.name, alignment: "right", margin: [0, 18, 0, 0] },
    ],
  };

  return {
    pageSize: "A4",
    pageMargins: PAGE_MARGINS,
    header: undefined,
    footer: SHOW_FOOTER
      ? (currentPage: number, pageCount: number) => ({
          columns: [
            { text: FOOTER_LEFT_TEXT || company.website || company.email || "", style: "footerLeft" },
            {
              text: FOOTER_RIGHT_TEXT.replace("{page}", String(currentPage)).replace("{pages}", String(pageCount)),
              alignment: "right",
              style: "footerRight",
            },
          ],
          margin: [PAGE_MARGINS[0], 0, PAGE_MARGINS[2], PAGE_MARGINS[3]],
        })
      : undefined,
    content: [
      headerBand,
      headerRow,
      metaGrid,
      { text: `Service: ${inv.serviceType}`, style: "subSection", margin: [0, 0, 0, 2] },
      serviceTable,
      totalsRow,
      bankBlock,
      termsBlock,
      signatureRow,
    ].filter(Boolean),
    styles: {
      brand: { fontSize: scale(18), bold: true, color: COLOR.primary, margin: [0, 2, 0, 2] },
      titleRight: { fontSize: scale(20), bold: true, alignment: "right", margin: [0, 0, 0, 2] },
      billTo: { fontSize: scale(10), bold: true, alignment: "right", color: COLOR.gray, margin: [0, 0, 0, 2] },
      billToName: { fontSize: scale(12), bold: true, alignment: "right", margin: [0, 2, 0, 4] },
      section: { fontSize: scale(11), bold: true, margin: [0, 6, 0, 4] },
      subSection: { fontSize: scale(11), bold: true, margin: [0, 4, 0, 4] },
      muted: { fontSize: scale(9), color: COLOR.gray },
      mutedRight: { fontSize: scale(9), color: COLOR.gray, alignment: "right" },
      tableHeader: { fontSize: scale(9), bold: true },
      footerLeft: { fontSize: scale(9), color: COLOR.gray },
      footerRight: { fontSize: scale(9), color: COLOR.gray },
    },
    defaultStyle: { font: fonts.family, fontSize: scale(10) },
  };
}

/* ============================================================================
   PROFORMA (distinct layout; shows detailed description for ALL services)
   - Item & Description:
       • FLIGHTS: Sectors (originDestination or From→To), Airline, Notes
       • Others: composed from HEADERS mapping as label: value lines
   - Rate = Base (baseFare/fare/rate/unitPrice/price)
   - CGST% & SGST% = totalTax% / 2 ; Amount column = base (no tax)
   - Totals: Sub Total + CGST + SGST = Total
   - Bill To = name + address; Ship To = GSTIN
============================================================================ */
export function buildProformaDocDef(inv: InvoiceWithRels): any {
  const company = {
    name: process.env.COMPANY_NAME || "Peachmint Trips and Planners",
    address: process.env.COMPANY_ADDRESS || "",
    email: process.env.COMPANY_EMAIL || "",
    phone: process.env.COMPANY_PHONE || "",
    website: process.env.COMPANY_WEBSITE || "",
    gstin: process.env.COMPANY_GSTIN || "",
    pan: process.env.COMPANY_PAN || "",
    state: process.env.COMPANY_STATE || "",
  };
  const leftLogo = loadLogoBase64FromPath(process.env.COMPANY_LOGO_PATH);

  // Normalize client fields + GSTIN
  const clientAny: any = inv.client || {};
  const clientMeta: any = clientAny.meta || {};
  const clientGSTIN: string = (clientAny.gstin as any) || (clientMeta.gstin as any) || "";

  // Place of supply prefers structured state
  const placeOfSupply =
    clientAny.state ??
    clientMeta?.address?.state ??
    company.state ??
    "";

  // Printable address for Bill To
  const billToAddress = buildClientAddress(inv.client);

  // ---------- Build “description” per line ----------
  const toFlightDesc = (d: any) => {
    // Show Sectors primarily, else From/To
    const od = d.originDestination;
    const from = d.from ?? d.origin ?? d.sectorFrom ?? d.departure ?? d.source ?? "";
    const to = d.to ?? d.destination ?? d.sectorTo ?? d.arrival ?? d.dest ?? "";
    const airline = d.airline ?? d.carrier ?? d.flight ?? "";
    const notes = d.notes ?? d.remarks ?? d.comment ?? "";

    const descLines: string[] = [];
    if (od) descLines.push(`Sectors: ${String(od)}`);
    else descLines.push(`Sectors: ${from || "-"} → ${to || "-"}`);
    if (airline) descLines.push(`Airline: ${airline}`);
    if (notes) descLines.push(`Notes: ${notes}`);
    return descLines.join("\n");
  };

  const makeDescFromHeaders = (svcType: string, d: any) => {
    const cols = HEADERS[svcType] || HEADERS.OTHER;
    const parts: string[] = [];
    for (const col of cols) {
      const raw = d?.[col.key];
      if (raw == null || raw === "") continue;
      // Avoid spamming currency/amount-like in description; keep semantic fields
      if (["tax", "serviceCharges", "currency", "fare", "rate", "unitPrice"].includes(col.key)) continue;
      parts.push(`${col.label}: ${String(raw)}`);
    }
    // add generic description/notes if available
    if (d?.description && !parts.some(p => p.startsWith("Description:")))
      parts.push(`Description: ${d.description}`);
    if (d?.notes) parts.push(`Notes: ${d.notes}`);
    return parts.join("\n");
  };

  type Line = { base: number; qty: number; rate: number; hsn: string; desc: string };

  const parseLine = (svcType: string, it: any): Line => {
    const d = it?.details || {};
    const qty = asNum(d.qty ?? d.quantity ?? 1);
    // Base (Rate): prefer baseFare/fare/rate/unitPrice/price
    const rate = asNum(d.baseFare ?? d.fare ?? d.rate ?? d.unitPrice ?? d.price ?? 0);
    const disc = asNum(d.discount ?? 0);
    const base = Math.max(0, qty * rate - disc);
    const hsn = d.hsn ?? d.hsnSac ?? d.hsn_sac ?? d.hsnCode ?? "";
    const desc =
      String(inv.serviceType).toUpperCase() === "FLIGHTS"
        ? toFlightDesc(d)
        : makeDescFromHeaders(inv.serviceType, d);

    return { base, qty: qty || 1, rate, hsn: String(hsn || ""), desc: desc || "-" };
  };

  const lines: Line[] = (inv.items || []).map((it) => parseLine(inv.serviceType, it));
  const subTotal = lines.reduce((a, b) => a + b.base, 0) || asNum(inv.subtotal);

  // ---------- Derive total tax% robustly then split in half ----------
  const gst = inv.meta?.gst || {};
  const cgstMeta = asNum(gst.cgst);
  const sgstMeta = asNum(gst.sgst);

  let totalTaxPct: number | null = null;
  if (subTotal > 0 && (cgstMeta || sgstMeta)) {
    totalTaxPct = +(100 * (cgstMeta + sgstMeta) / subTotal).toFixed(2);
  }
  if (totalTaxPct == null && subTotal > 0) {
    const invTaxTotal = asNum(inv.taxTotal);
    if (invTaxTotal > 0) totalTaxPct = +(100 * invTaxTotal / subTotal).toFixed(2);
  }
  if (totalTaxPct == null) {
    const d0 = inv.items?.[0]?.details || {};
    const rawPct = asNum(d0.taxPct ?? d0.taxPercent ?? d0.tax_rate ?? 0);
    if (rawPct > 0 && rawPct <= 100) totalTaxPct = rawPct;
    else if (rawPct > 100 && subTotal > 0) totalTaxPct = +(100 * rawPct / subTotal).toFixed(2);
    else {
      const rawAmt = asNum(d0.tax);
      if (rawAmt > 0 && subTotal > 0) totalTaxPct = +(100 * rawAmt / subTotal).toFixed(2);
    }
  }
  if (totalTaxPct == null && subTotal > 0) {
    const grand = asNum(inv.grandTotal);
    const svc = asNum(inv.serviceCharges);
    const approxTax = Math.max(0, grand - subTotal - svc);
    totalTaxPct = +(100 * approxTax / subTotal).toFixed(2);
  }
  totalTaxPct = totalTaxPct ?? 0;

  const cgstPct = +(totalTaxPct / 2).toFixed(2);
  const sgstPct = +(totalTaxPct / 2).toFixed(2);

  const itemRows = lines.map((ln, idx) => {
    const cgstLine = +(ln.base * cgstPct / 100).toFixed(2);
    const sgstLine = +(ln.base * sgstPct / 100).toFixed(2);
    return [
      { text: String(idx + 1), alignment: "center" },
      { text: ln.desc, margin: [2, 2, 2, 2] },                 // rich description (Flights or other)
      { text: ln.hsn, alignment: "center" },
      { text: String(ln.qty || 1), alignment: "right" },
      { text: inr(ln.rate), alignment: "right" },               // Rate = Base
      { text: cgstPct ? `${cgstPct}%` : "", alignment: "center" },
      { text: cgstLine ? inr(cgstLine) : "", alignment: "right" },
      { text: sgstPct ? `${sgstPct}%` : "", alignment: "center" },
      { text: sgstLine ? inr(sgstLine) : "", alignment: "right" },
      { text: inr(ln.base), alignment: "right" },               // Amount = Base (no tax)
    ];
  });

  const cgstTotal = +(subTotal * cgstPct / 100).toFixed(2);
  const sgstTotal = +(subTotal * sgstPct / 100).toFixed(2);
  const grandTotal = +(subTotal + cgstTotal + sgstTotal).toFixed(2);

  const bank: BankJson | undefined =
    normalizeBank(inv.bankJson) || normalizeBank(inv.meta?.bank ?? null) || envBankDefaults();

  const bankLines: string[] = [];
  if (bank) {
    if (bank.accountName) bankLines.push(`Account Holder: ${bank.accountName}`);
    if (bank.accountNo) bankLines.push(`Account Number: ${bank.accountNo}`);
    if (bank.ifsc) bankLines.push(`IFSC: ${bank.ifsc}`);
    if (bank.branch) bankLines.push(`Branch: ${bank.branch}`);
    if (bank.upiId) bankLines.push(`UPI: ${bank.upiId}`);
  }

  const content: any[] = [
    // Header with CLEAR title
    {
      table: {
        widths: ["auto", "*", "auto"],
        body: [
          [
            leftLogo
              ? { image: leftLogo, width: LOGO_W_PROFORMA, height: LOGO_H_PROFORMA, margin: [0, 4, 8, 4] }
              : { text: company.name, style: "brand" },
            { text: " ", border: [false, false, false, false] },
            {
              stack: [{ text: "PROFORMA INVOICE", fontSize: scale(22), bold: true }],
              alignment: "right",
              border: [false, false, false, false],
            },
          ],
        ],
      },
      layout: "noBorders",
      margin: [0, 0, 0, 6],
    },

    // Number / Date / Place of Supply
    {
      table: {
        widths: ["*", "*", "*"],
        body: [
          [
            { stack: [{ text: "#", bold: true }, { text: inv.invoiceNo }], margin: [4, 3, 4, 3] },
            { stack: [{ text: "Place Of Supply", bold: true }, { text: placeOfSupply || "-" }], margin: [4, 3, 4, 3] },
            { stack: [{ text: "Date", bold: true }, { text: fmtDate(inv.issueDate) }], alignment: "right", margin: [4, 3, 4, 3] },
          ],
        ],
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 6],
    },

    // Bill To / Ship To
    {
      table: {
        widths: ["*", "*"],
        body: [
          [{ text: "Bill To", bold: true }, { text: "Ship To", bold: true }],
          [
            {
              stack: [
                inv.client?.name ? { text: inv.client.name } : { text: "" },
                billToAddress ? { text: billToAddress } : { text: "" },
              ],
              margin: [0, 2, 4, 6],
            },
            {
              stack: [{ text: `GSTIN: ${clientGSTIN || "-"}`, bold: true }],
              margin: [0, 2, 0, 6],
            },
          ],
        ],
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 6],
    },

    // Items table (CGST/SGST columns + rich Item & Description)
    {
      table: {
        headerRows: 1,
        widths: [22, "*", 54, 38, 58, 40, 58, 40, 58, 70],
        body: [
          [
            { text: "#", style: "tableHeader", alignment: "center" },
            { text: "Item & Description", style: "tableHeader" },
            { text: "HSN /SAC", style: "tableHeader", alignment: "center" },
            { text: "Qty", style: "tableHeader", alignment: "right" },
            { text: "Rate", style: "tableHeader", alignment: "right" },
            { text: "CGST %", style: "tableHeader", alignment: "center" },
            { text: "Amt", style: "tableHeader", alignment: "right" },
            { text: "SGST %", style: "tableHeader", alignment: "center" },
            { text: "Amt", style: "tableHeader", alignment: "right" },
            { text: "Amount", style: "tableHeader", alignment: "right" },
          ],
          ...itemRows,
        ],
      },
      layout: {
        fillColor: () => null,
        hLineWidth: () => 0.6,
        vLineWidth: () => 0.6,
        paddingLeft: () => TABLE_CELL_PAD,
        paddingRight: () => TABLE_CELL_PAD,
        paddingTop: () => Math.max(2, TABLE_CELL_PAD - 1),
        paddingBottom: () => Math.max(2, TABLE_CELL_PAD - 1),
      },
      margin: [0, 0, 0, 8],
    },

    // Total in words + totals box
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: "Total In Words", bold: true, margin: [0, 4, 0, 4] },
            { text: `Indian Rupee ${rupeesInWords(grandTotal).replace(/ Rupees Only$/, "")} Only`, italics: true },
            inv.notes ? { text: "\nNotes", bold: true } : null,
            inv.notes ? { text: inv.notes } : null,
            bankLines.length ? { text: "\nBank Details", bold: true, margin: [0, 6, 0, 2] } : null,
            bankLines.length ? { text: bankLines.join("\n") } : null,
            { text: "\nTerms & Conditions", bold: true, margin: [0, 6, 0, 2] },
            {
              ul:
                inv.meta?.terms && inv.meta.terms.length
                  ? inv.meta.terms
                  : [
                      "Payment should be 50% advance and 50% on delivery.",
                      "All disputes subject to jurisdiction as per company policy.",
                    ],
            },
          ].filter(Boolean),
        },
        { width: 16, text: " " },
        {
          width: 240,
          stack: [
            {
              table: {
                widths: ["*", "auto"],
                body: [
                  [{ text: "Sub Total", alignment: "right" }, { text: inr(subTotal), alignment: "right" }],
                  ...(cgstPct ? [[{ text: `CGST (${cgstPct}%)`, alignment: "right" }, { text: inr(cgstTotal), alignment: "right" }]] : []),
                  ...(sgstPct ? [[{ text: `SGST (${sgstPct}%)`, alignment: "right" }, { text: inr(sgstTotal), alignment: "right" }]] : []),
                  [{ text: "Total", bold: true, alignment: "right" }, { text: `₹${inr(grandTotal)}`, bold: true, alignment: "right" }],
                ],
              },
              layout: "lightHorizontalLines",
            },
          ],
        },
      ],
      columnGap: 8,
      margin: [0, 0, 0, 12],
    },

    // QR + signature
    {
      columns: [
        { qr: QR_VALUE, fit: 70, alignment: "left", margin: [0, 6, 0, 0] },
        { text: "Authorized Signature", alignment: "right", margin: [0, 24, 0, 0] },
      ],
    },
  ];

  return {
    pageSize: "A4",
    pageMargins: [20, 20, 20, 24] as [number, number, number, number],
    // Big visual difference: watermark on page 1
    background: (currentPage: number) =>
      currentPage === 1
        ? {
            text: "PROFORMA",
            color: "#5a6b8f",
            opacity: 0.08,
            bold: true,
            fontSize: 110,
            alignment: "center",
            margin: [0, 200, 0, 0],
          }
        : undefined,
    content,
    styles: {
      brand: { fontSize: scale(18), bold: true, color: COLOR.primary },
      tableHeader: { fontSize: scale(9), bold: true },
    },
    defaultStyle: { font: fonts.family, fontSize: scale(10) },
  };
}

/* ---------------- exported: renderer ---------------- */
export async function renderPdfBuffer(docDef: any): Promise<Buffer> {
  const pdfDoc = (printer as any).createPdfKitDocument(docDef);
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    pdfDoc.on("data", (c: Buffer) => chunks.push(c));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
