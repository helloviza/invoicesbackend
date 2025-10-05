// apps/backend/src/routes/invoiceExports.ts
import { Router } from "express";
import dayjs from "dayjs";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import * as QRCode from "qrcode";
import { PDFDocument, rgb } from "pdf-lib";

// NOTE: We keep the .js specifier for Node ESM runtime, but TS can't resolve it.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - TS can't see ../pdf.ts behind ../pdf.js when using NodeNext/ESM; it's fine at runtime
import { buildInvoiceDocDef, buildProformaDocDef, renderPdfBuffer, isProforma } from "../services/pdf.ts";

const prisma = new PrismaClient();
const router = Router();

/* ---------------- helpers ---------------- */

const toISO = (v: any) => {
  try {
    return v ? new Date(v).toISOString() : undefined;
  } catch {
    return undefined;
  }
};
const toStr = (v: any) => (v === null || v === undefined ? "" : String(v));
const num = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const truthy = (x: any) =>
  x === true || x === 1 || x === "1" || x === "true" || x === "yes" || x === "on";
const falsy = (x: any) =>
  x === false || x === 0 || x === "0" || x === "false" || x === "no" || x === "off";

function csvEscape(val: any) {
  const s = val === null || val === undefined ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pick(obj: any, keys: string[], fallback = "") {
  if (!obj) return fallback;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return fallback;
}

function normalizeKey(k: any) {
  return String(k ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** tolerant item picker */
function pickItem(it: any, wantKeys: string[], fallback: any = "") {
  if (!it) return fallback;
  const blobs = [it, it.details, it.meta, it.data].filter((x) => x && typeof x === "object");
  for (const want of wantKeys) {
    const w = normalizeKey(want);
    for (const b of blobs) {
      for (const k of Object.keys(b)) {
        if (normalizeKey(k) === w) {
          const v = (b as any)[k];
          if (v !== undefined && v !== null) return v;
        }
      }
    }
  }
  return fallback;
}

/** origin-destination parser e.g. "DEL-PAT" / "DEL -> PAT" / "DEL/PNQ/PAT" (first & last) */
function splitOriginDestination(val: any): { from: string; to: string } {
  const s = toStr(val).trim();
  if (!s) return { from: "", to: "" };
  let m = s.match(/\b([A-Za-z]{3})\s*[->\/]\s*([A-Za-z]{3})\b/);
  if (m) return { from: m[1].toUpperCase(), to: m[2].toUpperCase() };
  const parts = s
    .split(/[->/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    parts.length >= 2 &&
    /^[A-Za-z]{3}$/.test(parts[0]) &&
    /^[A-Za-z]{3}$/.test(parts[parts.length - 1])
  ) {
    return { from: parts[0].toUpperCase(), to: parts[parts.length - 1].toUpperCase() };
  }
  return { from: "", to: "" };
}

/** safely parse arrays if stored as JSON strings */
function parseArrayMaybe(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "string") {
    try {
      const j = JSON.parse(x);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

function inlineItems(inv: any): any[] {
  const meta = inv?.meta || inv?.details || inv?.data || {};
  const pools: any[] = [
    inv?.items,
    inv?.lines,
    meta?.items,
    meta?.lines,
    meta?.flights,
    meta?.hotels,
    meta?.services,
  ];
  return pools.flatMap(parseArrayMaybe).filter(Boolean);
}

/** Build Prisma where */
function buildWhere(qs: any) {
  const { q, clientId, billToId, dateFrom, dateTo, status, ids } = qs;
  const where: any = { AND: [] as any[] };

  const search = toStr(q).trim();
  if (search) {
    where.AND.push({
      OR: [
        { invoiceNo: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  const cid = clientId || billToId;
  if (cid) where.AND.push({ clientId: toStr(cid) });

  const fromISO = toISO(dateFrom);
  const toISOv = toISO(dateTo);
  if (fromISO || toISOv) {
    where.AND.push({
      issueDate: { ...(fromISO ? { gte: fromISO } : {}), ...(toISOv ? { lte: toISOv } : {}) },
    });
  }
  if (status) where.AND.push({ status });

  const idsArr = Array.isArray(ids) ? ids : typeof ids === "string" ? ids.split(",") : [];
  if (idsArr.length) where.AND.push({ id: { in: idsArr } });

  if (!where.AND.length) delete where.AND;
  return where;
}

/* ---------- service type mapping ---------- */

const SERVICE_SHEETS = [
  { key: "Flight", match: ["flight", "flights", "air", "airticket", "ticket"] },
  { key: "Hotel", match: ["hotel", "hotels", "stay"] },
  { key: "Holiday", match: ["holiday", "tour", "package"] },
  { key: "Visa", match: ["visa"] },
  { key: "MICE", match: ["mice", "conference", "event", "meeting"] },
  { key: "Stationary", match: ["stationary", "stationery"] },
  { key: "Gift Items", match: ["gift", "gifts", "giftitems"] },
  { key: "Goodies", match: ["goodies", "goodie"] },
  { key: "Others", match: ["other", "others", "misc", "miscellaneous"] },
];

function canonicalServiceType(raw: any): string {
  const s = normalizeKey(raw);
  for (const def of SERVICE_SHEETS)
    if (def.match.some((m) => s === normalizeKey(m))) return def.key;
  if (s.startsWith("flight") || s.startsWith("air")) return "Flight";
  if (s.startsWith("hotel") || s.includes("stay")) return "Hotel";
  if (s.startsWith("holiday") || s.includes("tour") || s.includes("package")) return "Holiday";
  if (s.startsWith("visa")) return "Visa";
  if (s.startsWith("mice") || s.includes("conference") || s.includes("event") || s.includes("meeting"))
    return "MICE";
  if (s.startsWith("stationary") || s.startsWith("stationery")) return "Stationary";
  if (s.includes("gift")) return "Gift Items";
  if (s.includes("goodie")) return "Goodies";
  return "Others";
}

/* ---------- items: DB models + inline fallbacks ---------- */

async function fetchItemsMap(invoiceIds: string[]) {
  const map = new Map<string, any[]>();
  if (!invoiceIds.length) return map;

  const candidates = [
    "invoiceItem",
    "invoiceItems",
    "InvoiceItem",
    "InvoiceItems",
    "invoiceLineItem",
    "invoiceLineItems",
    "InvoiceLineItem",
    "InvoiceLineItems",
    "invoiceDetail",
    "invoiceDetails",
    "InvoiceDetail",
    "InvoiceDetails",
    "lineItem",
    "lineItems",
    "LineItem",
    "LineItems",
  ];

  for (const key of candidates) {
    const model = (prisma as any)[key];
    if (!model?.findMany) continue;
    try {
      const rows: any[] = await model.findMany({ where: { invoiceId: { in: invoiceIds } } });
      for (const it of rows) {
        const invId =
          it.invoiceId ??
          it.invoice_id ??
          it.invoiceID ??
          it.invoice_id_fk ??
          it.invoiceIdFk ??
          it.invoice ??
          "";
        if (!invId) continue;
        const arr = map.get(invId) || [];
        arr.push(it);
        map.set(invId, arr);
      }
      if (map.size) return map;
    } catch {
      /* try next */
    }
  }
  return map;
}

/** Invoice amounts */
function computeAmounts(inv: any, itemsArg?: any[]) {
  const items = Array.isArray(itemsArg) ? itemsArg : Array.isArray(inv.items) ? inv.items : [];

  const subtotalFromItems = sum(
    items.map((it: any) => {
      const svc = canonicalServiceType(
        pickItem(it, ["serviceType", "type", "category", "svcType"], inv.serviceType)
      );
      // hotel: rooms*nights*rate
      if (svc === "Hotel") {
        const rooms = num(pickItem(it, ["rooms", "noOfRooms", "roomCount", "room"], 1), 1);
        const nights = num(pickItem(it, ["nights", "noOfNights", "stayNights", "night"], 1), 1);
        const rate = num(pickItem(it, ["rate", "unitPrice", "price", "roomRate"], 0), 0);
        const disc = num(pickItem(it, ["discount", "disc"], 0), 0);
        return rooms * nights * rate - disc;
      }
      // flight: baseFare
      if (svc === "Flight") {
        const baseFare = num(pickItem(it, ["baseFare", "base_amount", "basicFare", "fare", "base"], 0), 0);
        const disc = num(pickItem(it, ["discount", "disc"], 0), 0);
        if (baseFare > 0) return baseFare - disc;
      }
      // generic
      const qty = num(pickItem(it, ["qty", "quantity", "units", "pax"], 1), 1);
      const unit = num(pickItem(it, ["unitPrice", "price", "rate", "roomRate"], 0), 0);
      const disc = num(pickItem(it, ["discount", "disc"], 0), 0);
      return qty * unit - disc;
    })
  );

  // prefer computed subtotal when available
  const subtotal = subtotalFromItems > 0 ? subtotalFromItems : num(inv.subtotal, 0);

  const taxAmt = num(inv.taxAmt ?? inv.taxTotal ?? inv.tax_total ?? inv.tax, 0);
  const svcAmt = num(inv.svcAmt ?? inv.serviceCharges ?? inv.serviceCharge ?? inv.service_total, 0);
  const total = num(inv.total ?? inv.grandTotal ?? inv.grand_total, subtotal + taxAmt + svcAmt);

  const taxPct = num(
    inv.taxPct ?? inv.taxPercent ?? inv.tax_percentage ?? (subtotal ? +((100 * taxAmt) / subtotal).toFixed(2) : 0),
    0
  );
  const svcPct = num(
    inv.svcPct ??
      inv.servicePct ??
      inv.servicePercent ??
      inv.service_percentage ??
      (subtotal ? +((100 * svcAmt) / subtotal).toFixed(2) : 0),
    0
  );

  return { subtotal, taxPct, taxAmt, svcPct, svcAmt, total };
}

/** Build a rich, schema-tolerant invoice summary object. */
function buildSummary(inv: any, items: any[]) {
  const { subtotal, taxPct, taxAmt, svcPct, svcAmt, total } = computeAmounts(inv, items);
  const c = inv.client || {};

  return {
    invoiceId: inv.id ?? inv._id,
    invoiceNo: inv.invoiceNo,
    issueDate: inv.issueDate ? dayjs(inv.issueDate).format("YYYY-MM-DD") : "",
    dueDate: inv.dueDate ? dayjs(inv.dueDate).format("YYYY-MM-DD") : "",
    status: inv.status ?? "",
    serviceType:
      inv.serviceType ?? inv.type ?? (Array.isArray(items) && items[0]?.serviceType) ?? "",
    currency: inv.currency ?? "INR",
    clientId: inv.clientId ?? "",
    billToName: pick(inv, ["billToName", "billTo", "customerName"], c.name || ""),
    billToCompany: pick(inv, ["billToCompany", "company"], c.company || ""),
    billToEmail: pick(inv, ["billToEmail", "email"], c.email || ""),
    billToPhone: pick(inv, ["billToPhone", "phone"], c.phone || ""),

    billToTaxId: pick(inv, ["billToTaxId", "gst", "gstin", "taxId", "vatNo"], (c as any).gst ?? c.taxId ?? ""),
    billToAddr1: pick(inv, ["billToAddress1", "billToAddr1", "address1"], (c as any).address1 || ""),
    billToAddr2: pick(inv, ["billToAddress2", "billToAddr2", "address2"], (c as any).address2 || ""),
    billToCity: pick(inv, ["billToCity"], (c as any).city || ""),
    billToState: pick(inv, ["billToState"], (c as any).state || ""),
    billToZip: pick(inv, ["billToZip", "billToPincode", "billToPostalCode"], (c as any).zip ?? (c as any).postalCode ?? ""),
    billToCountry: pick(inv, ["billToCountry"], (c as any).country || ""),
    poNumber: pick(inv, ["poNumber", "poNo", "purchaseOrder"]),
    reference: pick(inv, ["reference", "refNo", "bookingRef"]),
    project: pick(inv, ["project", "jobName"]),
    tripStartDate: pick(inv, ["tripStartDate", "fromDate", "travelFrom"]),
    tripEndDate: pick(inv, ["tripEndDate", "toDate", "travelTo"]),
    bankName: pick(inv, ["bankName"]),
    bankIfsc: pick(inv, ["bankIfsc", "ifsc"]),
    bankAccount: pick(inv, ["bankAccount", "accountNumber"]),
    paymentTerms: pick(inv, ["paymentTerms", "terms"]),
    notes: pick(inv, ["notes", "remarks"]),
    subtotal,
    taxPct,
    taxAmt,
    svcPct,
    svcAmt,
    total,
    createdAt: inv.createdAt ? dayjs(inv.createdAt).toISOString() : "",
    updatedAt: inv.updatedAt ? dayjs(inv.updatedAt).toISOString() : "",
  };
}

/* ---------------- CSV (one row per line item; full detail kept) ---------------- */

router.get("/export.csv", async (req, res) => {
  try {
    const where = buildWhere(req.query);
    const invoices = (await prisma.invoice.findMany({
      where,
      include: { client: true as any },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    })) as any[];

    const itemsMap = await fetchItemsMap(invoices.map((i) => i.id));
    const wantItems =
      falsy(req.query.includeItems) ? false : truthy(req.query.includeItems) ||
      truthy(req.query.include) ||
      truthy(req.query.withItems) ||
      truthy(req.query.items) ||
      truthy(req.query.with) ||
      true;

    const invHeader = [
      "invoiceId",
      "invoiceNo",
      "issueDate",
      "dueDate",
      "status",
      "serviceType",
      "currency",
      "billToName",
      "billToCompany",
      "billToEmail",
      "billToPhone",
      "billToTaxId",
      "billToAddr1",
      "billToAddr2",
      "billToCity",
      "billToState",
      "billToZip",
      "billToCountry",
      "poNumber",
      "reference",
      "project",
      "tripStartDate",
      "tripEndDate",
      "bankName",
      "bankIfsc",
      "bankAccount",
      "paymentTerms",
      "notes",
      "subtotal",
      "taxPct",
      "taxAmt",
      "svcPct",
      "svcAmt",
      "total",
    ];
    const lineHeader = [
      "lineNo",
      "description",
      "qty",
      "unitPrice",
      "discount",
      "lineTaxPct",
      "lineTaxAmt",
      "lineSvcPct",
      "lineSvcAmt",
      "lineTotal",
      "itemCurrency",
      "passengerName",
      "from",
      "to",
      "airline",
      "pnr",
      "baseFare",
      "guest",
      "hotel",
      "roomType",
      "rooms",
      "nights",
      "rate",
    ];

    const out: string[] = [];
    if (wantItems) out.push([...invHeader, ...lineHeader].join(","));
    else out.push(invHeader.join(","));

    for (const inv of invoices) {
      const fetched = itemsMap.get(inv.id) || [];
      const inline = fetched.length ? fetched : inlineItems(inv);
      const base = buildSummary(inv, inline);

      if (!wantItems) {
        out.push(invHeader.map((k) => csvEscape((base as any)[k])).join(","));
        continue;
      }

      const items = inline.length ? inline : [null];
      items.forEach((it: any, idx: number) => {
        const svcKey = it
          ? canonicalServiceType(pickItem(it, ["serviceType", "type", "category", "svcType"], base.serviceType))
          : base.serviceType;
        const isFlight = svcKey === "Flight";
        const isHotel = svcKey === "Hotel";

        // ---- quantities / base ----
        const rooms = num(pickItem(it, ["rooms", "noOfRooms", "roomCount", "room"], 1), 1);
        const nights = num(pickItem(it, ["nights", "noOfNights", "stayNights", "night"], 1), 1);
        let qty = num(pickItem(it, ["qty", "quantity", "units", "pax"], NaN));
        let unit = num(pickItem(it, ["unitPrice", "price", "rate", "roomRate"], NaN));
        const baseFare = num(pickItem(it, ["baseFare", "base_amount", "basicFare", "fare", "base"], NaN));

        if (isHotel) {
          if (!Number.isFinite(qty)) qty = rooms * nights;
          if (!Number.isFinite(unit)) unit = num(pickItem(it, ["rate", "unitPrice", "price", "roomRate"], 0));
        }
        if (isFlight) {
          if (!Number.isFinite(unit) || unit === 0) unit = Number.isFinite(baseFare) ? baseFare : 0;
          if (!Number.isFinite(qty)) qty = 1;
        }

        const disc = num(pickItem(it, ["discount", "disc"], 0), 0);
        const before = qty * unit - disc;

        // ---- taxes/service ----
        let lineTaxPct = num(pickItem(it, ["taxPct", "taxPercent", "tax_percentage"], NaN));
        let lineTaxAmt = num(pickItem(it, ["taxAmt", "taxAmount", "taxTotal", "tax"], NaN));
        if (!Number.isFinite(lineTaxAmt)) lineTaxAmt = Number.isFinite(lineTaxPct) ? (lineTaxPct / 100) * before : 0;
        if (!Number.isFinite(lineTaxPct) && before) lineTaxPct = +((100 * lineTaxAmt) / before).toFixed(2);

        let lineSvcPct = num(pickItem(it, ["svcPct", "servicePct", "servicePercent", "service_percentage"], NaN));
        let lineSvcAmt = num(pickItem(it, ["svcAmt", "serviceCharge", "serviceCharges", "service_total"], NaN));
        if (!Number.isFinite(lineSvcAmt)) lineSvcAmt = Number.isFinite(lineSvcPct) ? (lineSvcPct / 100) * before : 0;
        if (!Number.isFinite(lineSvcPct) && before) lineSvcPct = +((100 * lineSvcAmt) / before).toFixed(2);

        const lineTotal = num(
          pickItem(it, ["amount", "total", "lineTotal"], before + lineTaxAmt + lineSvcAmt),
          before + lineTaxAmt + lineSvcAmt
        );
        const itemCurrency = toStr(pickItem(it, ["currency", "curr"], base.currency));

        // ---- flight fields (+ originDestination fallback) ----
        let passengerName = isFlight
          ? toStr(pickItem(it, ["passengerName", "passenger", "paxName", "pax", "traveller", "traveler", "guest"], ""))
          : "";
        let from = isFlight
          ? toStr(pickItem(it, ["from", "origin", "fromCity", "fromCode", "fromAirport", "originCity", "originCode", "fromCityCode"], ""))
          : "";
        let to = isFlight
          ? toStr(pickItem(it, ["to", "destination", "toCity", "toCode", "toAirport", "destinationCity", "destinationCode", "toCityCode"], ""))
          : "";
        if (isFlight && (!from || !to)) {
          const { from: f, to: t } = splitOriginDestination(pickItem(it, ["originDestination", "sector", "route", "fromTo"], ""));
          if (!from) from = f;
          if (!to) to = t;
        }
        const airline = isFlight
          ? toStr(pickItem(it, ["airline", "carrier", "airlineName", "airlineCode", "carrierCode", "operator"], ""))
          : "";
        const pnr = isFlight
          ? toStr(pickItem(it, ["pnr", "recordLocator", "bookingRef", "bookingReference", "pnrNo", "pnrNumber", "locator"], ""))
          : "";

        // ---- hotel fields ----
        const guest = isHotel ? toStr(pickItem(it, ["guest", "guestName", "customerName", "passenger", "paxName"], "")) : "";
        const hotel = isHotel ? toStr(pickItem(it, ["hotel", "hotelName", "property", "hotel_name"], "")) : "";
        const roomType = isHotel ? toStr(pickItem(it, ["roomType", "room_type", "roomCategory"], "")) : "";
        const rate = isHotel ? num(pickItem(it, ["rate", "unitPrice", "price", "roomRate"], unit), unit) : "";

        const row: Record<string, any> = {
          ...base,
          lineNo: it ? idx + 1 : "",
          description: toStr(pickItem(it, ["description", "title", "name"], "")),
          qty: it ? qty : "",
          unitPrice: it ? unit : "",
          discount: it ? disc : "",
          lineTaxPct: it ? lineTaxPct : "",
          lineTaxAmt: it ? lineTaxAmt : "",
          lineSvcPct: it ? lineSvcPct : "",
          lineSvcAmt: it ? lineSvcAmt : "",
          lineTotal: it ? lineTotal : "",
          itemCurrency,
          passengerName,
          from,
          to,
          airline,
          pnr,
          baseFare: isFlight ? unit : "",
          guest,
          hotel,
          roomType,
          rooms: isHotel ? rooms : "",
          nights: isHotel ? nights : "",
          rate,
        };

        out.push([...invHeader, ...lineHeader].map((k) => csvEscape(row[k])).join(","));
      });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="PlumTrips-Invoices-Items.csv"`);
    res.send(out.join("\n"));
  } catch (e: any) {
    console.error("CSV export failed:", e);
    res.status(500).json({ error: "CSV export failed" });
  }
});

/* ---------------- XLSX: Master + per-service sheets (TRIMMED columns) ---------------- */

router.get("/export.xlsx", async (req, res) => {
  try {
    const where = buildWhere(req.query);
    const invoices = (await prisma.invoice.findMany({
      where,
      include: { client: true as any },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    })) as any[];

    const itemsMap = await fetchItemsMap(invoices.map((i) => i.id));
    const wantItems = falsy(req.query.includeItems) ? false : true;

    const wb = new ExcelJS.Workbook();

    const summaryCols: string[] = [
      "invoiceId",
      "invoiceNo",
      "issueDate",
      "dueDate",
      "status",
      "serviceType",
      "currency",
      "billToName",
      "billToCompany",
      "billToEmail",
      "billToPhone",
      "paymentTerms",
      "notes",
      "subtotal",
      "taxPct",
      "taxAmt",
      "svcPct",
      "svcAmt",
      "total",
      "createdAt",
      "updatedAt",
    ];

    const genericLineCols: string[] = ["lineNo", "description", "qty", "unitPrice", "discount", "itemCurrency"];

    const flightCols: string[] = ["passengerName", "from", "to", "airline", "pnr", "baseFare"];
    const hotelCols: string[] = ["guest", "hotel", "roomType", "rooms", "nights", "rate"];

    const masterHeader: string[] = [
      ...summaryCols,
      ...(wantItems ? genericLineCols : []),
      ...(wantItems ? flightCols : []),
      ...(wantItems ? hotelCols : []),
    ];

    const headerByType: Record<string, string[]> = {};
    if (wantItems) {
      headerByType["Flight"] = [...summaryCols, ...genericLineCols, ...flightCols];
      headerByType["Hotel"] = [...summaryCols, ...genericLineCols, ...hotelCols];
      for (const k of ["Holiday", "Visa", "MICE", "Stationary", "Gift Items", "Goodies", "Others"]) {
        headerByType[k] = [...summaryCols, ...genericLineCols];
      }
    }

    const wsMaster = wb.addWorksheet("Master");
    wsMaster.addRow(masterHeader);
    const wsByType: Record<string, ExcelJS.Worksheet> = {};
    if (wantItems) {
      for (const key of Object.keys(headerByType)) {
        const ws = wb.addWorksheet(key);
        ws.addRow(headerByType[key]);
        wsByType[key] = ws;
      }
    }

    for (const inv of invoices) {
      const fetched = itemsMap.get(inv.id) || [];
      const inline = fetched.length ? fetched : inlineItems(inv);
      const base = buildSummary(inv, inline);

      if (!wantItems) {
        wsMaster.addRow(masterHeader.map((k) => (base as any)[k]));
        continue;
      }

      const items = inline.length ? inline : [null];
      items.forEach((it: any, idx: number) => {
        const svcKey = it
          ? canonicalServiceType(pickItem(it, ["serviceType", "type", "category", "svcType"], base.serviceType))
          : base.serviceType;
        const isFlight = svcKey === "Flight";
        const isHotel = svcKey === "Hotel";

        const rooms = num(pickItem(it, ["rooms", "noOfRooms", "roomCount", "room"], 1), 1);
        const nights = num(pickItem(it, ["nights", "noOfNights", "stayNights", "night"], 1), 1);
        let qty = num(pickItem(it, ["qty", "quantity", "units", "pax"], NaN));
        let unit = num(pickItem(it, ["unitPrice", "price", "rate", "roomRate"], NaN));
        const baseFare = num(pickItem(it, ["baseFare", "base_amount", "basicFare", "fare", "base"], NaN));

        if (isHotel) {
          if (!Number.isFinite(qty)) qty = rooms * nights;
          if (!Number.isFinite(unit)) unit = num(pickItem(it, ["rate", "unitPrice", "price", "roomRate"], 0));
        }
        if (isFlight) {
          if (!Number.isFinite(unit) || unit === 0) unit = Number.isFinite(baseFare) ? baseFare : 0;
          if (!Number.isFinite(qty)) qty = 1;
        }

        const disc = num(pickItem(it, ["discount", "disc"], 0), 0);
        const itemCurrency = toStr(pickItem(it, ["currency", "curr"], base.currency));

        // flight fields (+ originDestination fallback)
        let passengerName = isFlight
          ? toStr(pickItem(it, ["passengerName", "passenger", "paxName", "pax", "traveller", "traveler", "guest"], ""))
          : "";
        let from = isFlight
          ? toStr(pickItem(it, ["from", "origin", "fromCity", "fromCode", "fromAirport", "originCity", "originCode", "fromCityCode"], ""))
          : "";
        let to = isFlight
          ? toStr(pickItem(it, ["to", "destination", "toCity", "toCode", "toAirport", "destinationCity", "destinationCode", "toCityCode"], ""))
          : "";
        if (isFlight && (!from || !to)) {
          const { from: f, to: t } = splitOriginDestination(pickItem(it, ["originDestination", "sector", "route", "fromTo"], ""));
          if (!from) from = f;
          if (!to) to = t;
        }
        const airline = isFlight
          ? toStr(pickItem(it, ["airline", "carrier", "airlineName", "airlineCode", "carrierCode", "operator"], ""))
          : "";
        const pnr = isFlight
          ? toStr(pickItem(it, ["pnr", "recordLocator", "bookingRef", "bookingReference", "pnrNo", "pnrNumber", "locator"], ""))
          : "";

        const guest = isHotel ? toStr(pickItem(it, ["guest", "guestName", "customerName", "passenger", "paxName"], "")) : "";
        const hotel = isHotel ? toStr(pickItem(it, ["hotel", "hotelName", "property", "hotel_name"], "")) : "";
        const roomType = isHotel ? toStr(pickItem(it, ["roomType", "room_type", "roomCategory"], "")) : "";
        const rate = isHotel ? num(pickItem(it, ["rate", "unitPrice", "price", "roomRate"], unit), unit) : "";

        const baseRow: Record<string, any> = {
          ...base,
          lineNo: it ? idx + 1 : "",
          description: toStr(pickItem(it, ["description", "title", "name"], "")),
          qty: it ? qty : "",
          unitPrice: it ? unit : "",
          discount: it ? disc : "",
          itemCurrency,
        };

        const masterRow = {
          ...baseRow,
          passengerName,
          from,
          to,
          airline,
          pnr,
          baseFare: isFlight ? unit : "",
          guest,
          hotel,
          roomType,
          rooms: isHotel ? rooms : "",
          nights: isHotel ? nights : "",
          rate,
        };

        wsMaster.addRow(masterHeader.map((k) => (masterRow as any)[k]));

        const ws = wsByType[svcKey] || wsByType["Others"];
        if (ws) {
          const perHeader = headerByType[svcKey] || headerByType["Others"];
          const rowForType: Record<string, any> =
            svcKey === "Flight"
              ? { ...baseRow, passengerName, from, to, airline, pnr, baseFare: unit }
              : svcKey === "Hotel"
              ? { ...baseRow, guest, hotel, roomType, rooms, nights, rate }
              : baseRow;
          ws.addRow(perHeader.map((k: any) => (rowForType as any)[k]));
        }
      });
    }

    // style
    const allSheets = [wsMaster, ...Object.values(wsByType)];
    allSheets.forEach((ws) => {
      if (!ws) return;
      ws.columns.forEach(
        (col) => (col.width = Math.min(42, Math.max(12, col.header ? String(col.header).length : 12)))
      );
      ws.getRow(1).font = { bold: true };
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="PlumTrips-Invoices.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e: any) {
    console.error("XLSX export failed:", e);
    res.status(500).json({ error: "XLSX export failed" });
  }
});

/* ---------------- PDF with QR (bottom-right, last page) ---------------- */

// Local "S3" folder you already expose via /static in server.ts
const pdfRoot = path.join(process.cwd(), "pdfs");

async function getInvoiceByIdOrNo(idOrNo: string) {
  // Try by id
  const byId = await prisma.invoice.findUnique({
    where: { id: idOrNo } as any,
    include: { client: true as any },
  });
  if (byId) return byId as any;
  // Fallback by invoiceNo
  const byNo = await prisma.invoice.findFirst({
    where: { invoiceNo: idOrNo } as any,
    include: { client: true as any },
  });
  return byNo as any;
}

/** Stamp a QR linking to https://www.plumtrips.com on the last page (near signature area) */
async function stampQrOnPdf(pdfBytes: Uint8Array, url: string) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  if (!pages.length) return pdfBytes;

  const last = pages[pages.length - 1];

  const qrPng = await QRCode.toBuffer(url, { width: 256, margin: 0 });
  const qrImg = await pdfDoc.embedPng(qrPng);

  // Position
  const size = 80; // QR size
  const margin = 28; // distance from edges
  const x = last.getWidth() - size - margin;
  const y = margin; // bottom-right corner

  last.drawImage(qrImg, { x, y, width: size, height: size });

  // Optional tiny label above the QR
  const label = "www.plumtrips.com";
  last.drawText(label, {
    x: x + 2,
    y: y + size + 4,
    size: 9,
    color: rgb(0.15, 0.15, 0.2),
  });

  const out = await pdfDoc.save(); // Uint8Array
  return out;
}

/**
 * GET /api/invoices/:idOrNo/pdf
 * Streams the stored PDF with QR, or builds one on the fly if missing (Tax/Proforma auto).
 */
router.get("/:idOrNo/pdf", async (req, res) => {
  try {
    const idOrNo = String(req.params.idOrNo || "").trim();
    if (!idOrNo) return res.status(400).json({ error: "Missing invoice id" });

    const inv = await getInvoiceByIdOrNo(idOrNo);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    // 1) Try stored file
    const key = (inv as any).pdfKey || "";
    if (key) {
      const abs = path.join(pdfRoot, key);
      if (fs.existsSync(abs)) {
        const raw: Buffer = fs.readFileSync(abs);
        const withQr = await stampQrOnPdf(new Uint8Array(raw), "https://www.plumtrips.com");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${(inv as any).invoiceNo || "invoice"}.pdf"`
        );
        return res.end(Buffer.from(withQr));
      }
    }

    // 2) Build on the fly
    let items: any[] = Array.isArray((inv as any).items) ? (inv as any).items : [];
    if (!items.length) {
      const m = await fetchItemsMap([inv.id]);
      items = m.get(inv.id) || inlineItems(inv);
    }
    const normItems = items.map((it: any, i: number) => ({
      sNo: i + 1,
      details: it.details || it,
      lineTotal: String(
        it.lineTotal ??
          it.total ??
          it.amount ??
          (Number(it.qty ?? it.quantity ?? 1) * Number(it.unitPrice ?? it.price ?? it.rate ?? 0) -
            Number(it.discount ?? 0))
      ),
    }));

    const invForPdf = {
      invoiceNo: inv.invoiceNo,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate ?? null,
      currency: inv.currency ?? "INR",
      baseCurrency: inv.baseCurrency,
      status: inv.status,
      serviceType: inv.serviceType ?? "OTHER",
      subtotal: String(inv.subtotal ?? 0),
      taxTotal: String(inv.taxAmt ?? inv.taxTotal ?? 0),
      serviceCharges: String(inv.svcAmt ?? inv.serviceCharges ?? 0),
      grandTotal: String(inv.total ?? inv.grandTotal ?? 0),
      notes: inv.notes ?? null,
      bankJson: inv.bankJson ?? inv.bank ?? null,
      meta: inv.meta ?? null,
      client: inv.client ?? { name: (inv as any).billToName || "" },
      items: normItems,
    };

    const docDef = isProforma(invForPdf as any)
  ? buildProformaDocDef(invForPdf as any)
  : buildInvoiceDocDef(invForPdf as any);
    const raw = await renderPdfBuffer(docDef);

    const withQr = await stampQrOnPdf(new Uint8Array(raw), "https://www.plumtrips.com");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(inv as any).invoiceNo || "invoice"}.pdf"`
    );
    return res.end(Buffer.from(withQr));
  } catch (e: any) {
    console.error("Invoice PDF build failed:", e);
    return res.status(500).json({ error: "Failed to build PDF" });
  }
});

export default router;
