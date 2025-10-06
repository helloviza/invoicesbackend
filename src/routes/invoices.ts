// apps/backend/src/routes/invoices.ts
import { Router, type Request, type Response } from "express";
import { PrismaClient, InvoiceStatus } from "@prisma/client";
import { z } from "zod";

import { nextInvoiceNo } from "../utils/invoiceNo.js";
import { SERVICE_TYPES, type ServiceType, computeLineParts } from "../services/calc.js";
import {
  buildInvoiceDocDef,
  buildProformaDocDef,
  renderPdfBuffer,
} from "../services/pdf.js";
import { uploadPdfToS3, getSignedS3Url } from "../services/s3.js";
import { sendInvoiceEmail } from "../services/email.js";

const prisma = new PrismaClient();
const r = Router();

/** Mongo ObjectId guard */
const isObjectId = (s: string) => /^[0-9a-f]{24}$/i.test(s);

/** Build a zod enum from your const tuple (slice() removes readonly) */
const ServiceTypeZ = z.enum(SERVICE_TYPES.slice() as [string, ...string[]]);

/* -------- optional metadata (saved in signatureJson) -------- */
const BankZ = z
  .object({
    accountName: z.string().optional(),
    bankName: z.string().optional(),
    accountNo: z.string().optional(),
    ifsc: z.string().optional(),
    swift: z.string().optional(),
    branch: z.string().optional(),
    upiId: z.string().optional(),
    notes: z.string().optional(),
    // legacy aliases we still accept (normalized in PDF layer)
    beneficiary: z.string().optional(),
    name: z.string().optional(),
    account: z.string().optional(),
  })
  .partial();

const MetaZ = z
  .object({
    irn: z.string().optional(),
    invoiceUrl: z.string().optional(),
    sac: z.string().optional(),
    hsn: z.string().optional(),
    gst: z
      .object({
        cgst: z.number().optional(),
        sgst: z.number().optional(),
        igst: z.number().optional(),
      })
      .optional(),
    bank: BankZ.optional(),
    terms: z.array(z.string().min(1)).optional(),
  })
  .partial();

/** Create payload */
const NewInvoiceSchema = z.object({
  clientId: z.string().min(1),
  serviceType: ServiceTypeZ,
  issueDate: z.string().min(1), // YYYY-MM-DD
  dueDate: z.string().optional().nullable().default(null),
  currency: z.string().min(1),
  items: z
    .array(
      z.object({
        sNo: z.number().int().positive(),
        details: z.record(z.any()),
      }),
    )
    .min(1),
  notes: z.string().optional(),
  meta: MetaZ.optional(), // <-- stored into signatureJson
});

/** ---- Status helpers (normalize to Prisma enum) ---- */
const StatusInputZ = z.enum([
  "draft", "sent", "paid", "void",
  "issued", "overdue", "cancelled", "canceled",
  "DRAFT", "SENT", "PAID", "VOID",
  "ISSUED", "OVERDUE", "CANCELLED", "CANCELED",
]);

function toPrismaStatus(s: z.infer<typeof StatusInputZ>): InvoiceStatus {
  const v = s.toLowerCase();
  if (v === "draft") return InvoiceStatus.DRAFT;
  if (v === "sent" || v === "issued" || v === "overdue") return InvoiceStatus.SENT;
  if (v === "paid") return InvoiceStatus.PAID;
  if (v === "void" || v === "cancelled" || v === "canceled") return InvoiceStatus.VOID;
  return InvoiceStatus.DRAFT;
}

const UpdateStatusSchema = z.object({ status: StatusInputZ });

/** Money helper */
const toMon = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

/** Resolve/validate tenantId so it is always a string */
function resolveTenantId(req: Request): string {
  const id =
    (req as any).user?.["custom:tenantId"] ??
    process.env.DEFAULT_TENANT_ID ??
    "";
  if (!id || !isObjectId(id)) {
    throw new Error(
      "Missing/invalid tenant id. Provide custom:tenantId in the token or set DEFAULT_TENANT_ID (24-hex).",
    );
  }
  return id;
}

/* ---------------- helpers for PDF building ---------------- */

type DocKind = "tax" | "performa";

function parseDocKind(req: Request): DocKind {
  const d = String(req.query.doc || "").toLowerCase();
  if (d === "performa" || d === "proforma") return "performa";
  return "tax";
}

function parseForce(req: Request): boolean {
  const f = String(req.query.force || "").toLowerCase();
  return f === "1" || f === "true" || f === "yes";
}

/** Normalize Prisma invoice into shape the PDF builders expect */
function normalizeForPdf(inv: any) {
  const safeItems = Array.isArray(inv.items)
    ? inv.items.map((it: any) => ({
        sNo: it.sNo,
        details:
          it.details && typeof it.details === "object"
            ? (it.details as Record<string, any>)
            : {},
        lineTotal: it.lineTotal ?? null,
      }))
    : [];

  return {
    ...inv,
    meta: (inv as any).signatureJson ?? (inv as any).meta ?? null,
    items: safeItems,
  };
}

/**
 * Render & upload a PDF.
 */
async function renderUploadPdf(
  invRaw: any,
  docKind: DocKind,
  force: boolean,
): Promise<string> {
  const inv = normalizeForPdf(invRaw);
  const builder = docKind === "performa" ? buildProformaDocDef : buildInvoiceDocDef;
  const keyBase =
    docKind === "performa"
      ? `invoices/proforma/${inv.invoiceNo}`
      : `invoices/${inv.invoiceNo}`;

  // For tax: reuse existing pdfKey when not forcing
  if (docKind === "tax" && inv.pdfKey && !force) {
    return inv.pdfKey as string;
  }

  const docDef = builder(inv);
  const buffer = await renderPdfBuffer(docDef);

  const desiredKey = `${keyBase}${force ? "-" + Date.now() : ""}.pdf`;
  const finalKey = await uploadPdfToS3(buffer, desiredKey);

  // Persist only tax pdfKey to DB (do not overwrite with proforma)
  if (docKind === "tax" && finalKey !== invRaw.pdfKey) {
    await prisma.invoice.update({
      where: { id: invRaw.id },
      data: { pdfKey: finalKey },
    });
  }

  return finalKey;
}

function respondWithPdfUrl(req: Request, res: Response, key: string) {
  getSignedS3Url(key)
    .then((url) => {
      const bust = url.includes("?") ? `&v=${Date.now()}` : `?v=${Date.now()}`;
      const finalUrl = url + bust;

      const inline = req.query.inline === "1";
      const download = req.query.download === "1";
      if (inline || download) {
        return res.redirect(finalUrl);
      }
      return res.json({ ok: true, pdfKey: key, url: finalUrl });
    })
    .catch((err) => {
      return res
        .status(500)
        .json({
          ok: false,
          message: "Failed to sign PDF URL",
          detail: (err as Error).message,
        });
    });
}

/* ============================================================================
   LIST: GET /api/invoices and POST /api/invoices/{search|list}
   - supports filters, pagination, sorting
   - returns { ok, items, total, page, pages } and legacy { data }
============================================================================ */

const ListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort: z.string().optional(),        // e.g. "issueDate:desc" or "createdAt:asc"
  q: z.string().optional(),           // free text
  from: z.coerce.date().optional(),   // date range
  to: z.coerce.date().optional(),
  clientId: z.string().optional(),
  status: z.string().optional(),      // friendly string; mapped to enum if provided
});

function buildOrder(sort?: string) {
  let field = "issueDate";
  let dir: "asc" | "desc" = "desc";
  if (sort) {
    const [f, d] = sort.split(":");
    if (f) field = f;
    if (d === "asc" || d === "desc") dir = d as "asc" | "desc";
  }
  return [{ [field]: dir }, { createdAt: dir }] as any[];
}

function buildWhere(input: z.infer<typeof ListSchema>, tenantId: string) {
  const where: any = { tenantId };

  if (input.clientId) where.clientId = input.clientId;

  if (input.status) {
    try {
      where.status = toPrismaStatus(input.status as any);
    } catch {}
  }

  if (input.q) {
    const contains = (field: string) => ({ [field]: { contains: input.q, mode: "insensitive" } });
    where.OR = [
      contains("invoiceNo"),
      contains("number"),
      contains("notes"),
      { client: { name: { contains: input.q, mode: "insensitive" } } },
    ];
  }

  if (input.from || input.to) {
    const range: any = {};
    if (input.from) range.gte = input.from;
    if (input.to) {
      const t = new Date(input.to);
      t.setHours(23, 59, 59, 999);
      range.lte = t;
    }
    // Try common date fields
    where.OR = (where.OR || []).concat([
      { issueDate: range },
      { invoiceDate: range },
      { date: range },
      { createdAt: range },
    ]);
  }

  return where;
}

async function listHandler(req: Request, res: Response) {
  let input: z.infer<typeof ListSchema>;
  try {
    input = ListSchema.parse(req.method === "GET" ? req.query : req.body);
  } catch (e: any) {
    return res.status(400).json({ ok: false, message: "Invalid filters", errors: e?.flatten?.() });
  }

  let tenantId: string;
  try {
    tenantId = resolveTenantId(req);
  } catch (e) {
    return res.status(400).json({ ok: false, message: (e as Error).message });
  }

  const { page, limit, sort } = input;
  const skip = (page - 1) * limit;

  const where = buildWhere(input, tenantId);
  const orderBy = buildOrder(sort);

  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: { client: true, items: true },
    }),
    prisma.invoice.count({ where }),
  ]);

  return res.json({
    ok: true,
    items,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    // legacy key for older UI bits
    data: items,
  });
}

r.get("/", listHandler);
r.post("/search", listHandler);
r.post("/list", listHandler);

/* ============================================================================
   CREATE: POST /api/invoices
============================================================================ */
r.post("/", async (req: Request, res: Response) => {
  let tenantId: string;
  try {
    tenantId = resolveTenantId(req);
  } catch (e) {
    return res.status(400).json({ ok: false, message: (e as Error).message });
  }
  const userSub: string | undefined = (req as any).user?.sub;

  let input: z.infer<typeof NewInvoiceSchema>;
  try {
    input = NewInvoiceSchema.parse(req.body);
  } catch (err) {
    const zerr = err as z.ZodError;
    return res.status(400).json({ ok: false, errors: zerr.flatten() });
  }

  const { clientId, serviceType, issueDate, dueDate, currency, items, notes, meta } =
    input;

  let subtotal = 0;
  let taxTotal = 0;
  let serviceCharges = 0;

  const createdItems = items.map((it) => {
    const parts = computeLineParts(serviceType as ServiceType, it.details);
    subtotal += parts.base;
    taxTotal += parts.tax;
    serviceCharges += parts.service;

    const qty = (it.details as any)?.quantity;
    const up = (it.details as any)?.unitPrice;

    return {
      sNo: it.sNo,
      details: it.details,
      quantity: qty != null ? String(qty) : null,
      unitPrice: up != null ? String(up) : null,
      lineTotal: toMon(parts.total),
    };
  });

  const invoiceNo = await nextInvoiceNo(tenantId);

  const created = await prisma.invoice.create({
    data: {
      tenantId,
      clientId,
      invoiceNo,
      issueDate: new Date(issueDate),
      dueDate: dueDate ? new Date(dueDate) : null,
      serviceType: serviceType as any,
      currency,
      baseCurrency: process.env.DEFAULT_BASE_CURRENCY || "INR",
      subtotal: toMon(subtotal),
      taxTotal: toMon(taxTotal),
      serviceCharges: toMon(serviceCharges),
      grandTotal: toMon(subtotal + taxTotal + serviceCharges),
      notes,
      createdById: userSub,
      status: InvoiceStatus.DRAFT,
      signatureJson: meta ? (meta as unknown as object) : undefined,
      items: { create: createdItems },
    },
    select: { id: true, invoiceNo: true, status: true },
  });

  res.json({ ok: true, data: created });
});

/* ============================================================================
   READ helpers
============================================================================ */
r.get("/by-no/:no", async (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const inv = await prisma.invoice.findFirst({
      where: { invoiceNo: req.params.no, tenantId },
      include: { client: true, items: true },
    });
    if (!inv) return res.status(404).json({ ok: false, message: "Invoice not found" });
    res.json({ ok: true, data: inv });
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

r.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isObjectId(id)) {
    return res
      .status(400)
      .json({ ok: false, message: "id must be a 24-hex Mongo ObjectId" });
  }
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true, items: true },
  });
  if (!inv) return res.status(404).json({ ok: false, message: "Invoice not found" });
  res.json({ ok: true, data: inv });
});

/* ============================================================================
   PDFs
============================================================================ */
r.get("/by-no/:no/pdf", async (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req);
    const inv = await prisma.invoice.findFirst({
      where: { invoiceNo: req.params.no, tenantId },
      include: { client: true, items: true },
    });
    if (!inv) return res.status(404).json({ ok: false, message: "Invoice not found" });

    const docKind = parseDocKind(req);
    const force = parseForce(req);

    const key = await renderUploadPdf(inv, docKind, force);
    return respondWithPdfUrl(req, res, key);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to render invoice PDF",
      detail: (err as Error).message,
    });
  }
});

r.get("/:idOrNo/pdf", async (req: Request, res: Response) => {
  try {
    const idOrNo = req.params.idOrNo;
    const docKind = parseDocKind(req);
    const force = parseForce(req);

    let inv: any | null = null;

    if (isObjectId(idOrNo)) {
      inv = await prisma.invoice.findUnique({
        where: { id: idOrNo },
        include: { client: true, items: true },
      });
    } else {
      const tenantId = resolveTenantId(req);
      inv = await prisma.invoice.findFirst({
        where: { invoiceNo: idOrNo, tenantId },
        include: { client: true, items: true },
      });
    }

    if (!inv) return res.status(404).json({ ok: false, message: "Invoice not found" });

    const key = await renderUploadPdf(inv, docKind, force);
    return respondWithPdfUrl(req, res, key);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to render invoice PDF",
      detail: (err as Error).message,
    });
  }
});

r.get("/:id/proforma.pdf", (req: Request, res: Response) => {
  const qs = new URLSearchParams({
    doc: "performa",
    ...(req.query as any),
  }).toString();
  return res.redirect(`/api/invoices/${req.params.id}/pdf?${qs}`);
});

r.get("/by-no/:no/proforma.pdf", (req: Request, res: Response) => {
  const qs = new URLSearchParams({
    doc: "performa",
    ...(req.query as any),
  }).toString();
  return res.redirect(`/api/invoices/by-no/${req.params.no}/pdf?${qs}`);
});

/* ============================================================================
   EMAIL TAX INVOICE
============================================================================ */
r.post("/:id/email", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isObjectId(id)) {
    return res
      .status(400)
      .json({ ok: false, message: "id must be a 24-hex Mongo ObjectId" });
  }

  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true, items: true },
  });
  if (!inv) return res.status(404).json({ ok: false, message: "Invoice not found" });

  // Ensure TAX PDF exists and get a URL
  let url: string;
  try {
    const key = await renderUploadPdf(inv, "tax", false);
    url = await getSignedS3Url(key);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to render invoice PDF",
      detail: (err as Error).message,
    });
  }

  // Validate recipients
  const EmailPayload = z.object({ to: z.array(z.string().email()).min(1) });
  let payload: z.infer<typeof EmailPayload>;
  try {
    payload = EmailPayload.parse(req.body);
  } catch (e) {
    const zerr = e as z.ZodError;
    return res.status(400).json({ ok: false, errors: zerr.flatten() });
  }

  const subject = `Invoice ${inv.invoiceNo} from ${process.env.COMPANY_NAME || "PlumTrips"}`;
  const html = `
    <p>Dear ${inv.client?.name || "Customer"},</p>
    <p>Please find your invoice <strong>${inv.invoiceNo}</strong> at the link below:</p>
    <p><a href="${url}">Download Invoice PDF</a></p>
    <p>Amount Due: <strong>${inv.currency} ${inv.grandTotal}</strong></p>
    <p>Regards,<br/>${process.env.COMPANY_NAME || "PlumTrips"}</p>
  `;

  await sendInvoiceEmail({ to: payload.to, subject, html });
  res.json({ ok: true, sent: payload.to.length, url });
});

/* ============================================================================
   SIMPLE STATUS ENDPOINTS
============================================================================ */
async function setInvoiceStatus(id: string, status: InvoiceStatus) {
  const patch: Record<string, any> = { status };
  if (status === InvoiceStatus.SENT) {
    patch.issueDate = new Date();
  }
  return prisma.invoice.update({
    where: { id },
    data: patch,
    select: { id: true, invoiceNo: true, status: true },
  });
}

function ensureId(req: Request, res: Response): string | null {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400).json({ ok: false, message: "Bad id" });
    return null;
  }
  return id;
}

r.post("/:id/issue", async (req, res) => {
  const id = ensureId(req, res); if (!id) return;
  const row = await setInvoiceStatus(id, InvoiceStatus.SENT);
  res.json({ ok: true, data: row });
});

r.post("/:id/paid", async (req, res) => {
  const id = ensureId(req, res); if (!id) return;
  const row = await setInvoiceStatus(id, InvoiceStatus.PAID);
  res.json({ ok: true, data: row });
});

r.post("/:id/cancel", async (req, res) => {
  const id = ensureId(req, res); if (!id) return;
  const row = await setInvoiceStatus(id, InvoiceStatus.VOID);
  res.json({ ok: true, data: row });
});

r.post("/:id/reopen", async (req, res) => {
  const id = ensureId(req, res); if (!id) return;
  const row = await setInvoiceStatus(id, InvoiceStatus.DRAFT);
  res.json({ ok: true, data: row });
});

// Kept for compatibility: maps "overdue" to SENT (schema has no OVERDUE)
r.post("/:id/overdue", async (req, res) => {
  const id = ensureId(req, res); if (!id) return;
  const row = await setInvoiceStatus(id, InvoiceStatus.SENT);
  res.json({
    ok: true,
    data: row,
    note: "Schema has no OVERDUE status; mapped to SENT.",
  });
});

// Generic status setter (accepts friendly statuses & maps to enum)
r.post("/:id/status", async (req, res) => {
  const id = ensureId(req, res); if (!id) return;
  let body: z.infer<typeof UpdateStatusSchema>;
  try {
    body = UpdateStatusSchema.parse(req.body);
  } catch (e) {
    const zerr = e as z.ZodError;
    return res.status(400).json({ ok: false, errors: zerr.flatten() });
  }
  const row = await setInvoiceStatus(id, toPrismaStatus(body.status));
  res.json({ ok: true, data: row });
});

export default r;
