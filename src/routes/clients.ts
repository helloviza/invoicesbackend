import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const r = Router();
const prisma = new PrismaClient();

/** Resolve tenant (adjust if your auth sets a different claim/header) */
const TENANT = (req: any) => req?.user?.["custom:tenantId"] || "68c19fa4210bec7717532f5f" || "default-tenant";

/** ------------------------------ Zod Schemas ------------------------------ */
const AddressShape = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

const ClientCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),

  // legacy free-form address or structured object
  address: z.union([z.string(), AddressShape]).optional(),

  // flat address fields from the UI
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),

  // extra bill-to fields
  gstin: z.string().optional(),
  pan: z.string().optional(),
  website: z.string().optional(),
  logoUrl: z.string().optional(),
});

const ClientUpdateSchema = ClientCreateSchema.partial();

type ClientCreate = z.infer<typeof ClientCreateSchema>;
type ClientUpdate = z.infer<typeof ClientUpdateSchema>;

/** ------------------------------ Helpers ---------------------------------- */
function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj || {})) {
    const v = (obj as any)[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    (out as any)[k] = v;
  }
  return out;
}

function buildMeta(i: Partial<ClientCreate>) {
  const nested = typeof i.address === "object" && i.address ? (i.address as any) : {};
  const address = compact({
    line1: i.addressLine1 ?? nested.line1,
    line2: i.addressLine2 ?? nested.line2,
    city: i.city ?? nested.city,
    state: i.state ?? nested.state,
    postalCode: i.postalCode ?? nested.postalCode,
    country: i.country ?? nested.country,
  });

  const meta = compact({
    gstin: i.gstin,
    pan: i.pan,
    website: i.website,
    logoUrl: i.logoUrl,
  }) as any;

  if (Object.keys(address).length) meta.address = address;
  return meta; // may be {}
}

function isUnknownMetaError(err: any) {
  const msg = String(err?.message || "");
  return msg.includes("Unknown argument `meta`") || msg.includes("Unknown arg `meta`");
}

function packAddressJSON(meta: any, legacyText?: string | null) {
  const obj: any = { ...meta };
  if (legacyText && legacyText.trim()) obj.addressText = legacyText.trim();
  try {
    return JSON.stringify(obj);
  } catch {
    // very unlikely; fallback to legacy text only
    return legacyText ?? null;
  }
}

function tryParseAddressJSON(address: string | null | undefined) {
  if (!address) return {};
  // If it looks like JSON, parse; else treat as legacy free text
  const trimmed = address.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return { address: address || "" };
  try {
    const meta = JSON.parse(trimmed);
    const a = (meta.address || {}) as any;
    return {
      gstin: meta.gstin || "",
      pan: meta.pan || "",
      website: meta.website || "",
      logoUrl: meta.logoUrl || "",
      addressLine1: a.line1 || "",
      addressLine2: a.line2 || "",
      city: a.city || "",
      state: a.state || "",
      postalCode: a.postalCode || "",
      country: a.country || "",
      address: meta.addressText || "",
    };
  } catch {
    return { address: address || "" };
  }
}

/** Use row.meta if present; otherwise unpack JSON from address */
function normalize(row: any) {
  const fromMeta = (() => {
    const m = (row?.meta || null) as any;
    if (!m || typeof m !== "object") return null;
    const a = (m.address || {}) as any;
    return {
      gstin: m.gstin || "",
      pan: m.pan || "",
      website: m.website || "",
      logoUrl: m.logoUrl || "",
      addressLine1: a.line1 || "",
      addressLine2: a.line2 || "",
      city: a.city || "",
      state: a.state || "",
      postalCode: a.postalCode || "",
      country: a.country || "",
    };
  })();

  const fromAddress = fromMeta ? {} : tryParseAddressJSON(row?.address ?? null);

  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    ...(fromMeta || fromAddress),
    // ensure legacy free-text stays available
    address: fromMeta ? (typeof row.address === "string" ? row.address : "") : (fromAddress as any).address || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Merge meta deeply (keeps existing unless explicitly provided) */
function mergeMeta(existing: any, incoming: any) {
  const out = { ...(existing || {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) continue;
    if (k === "address") {
      out.address = { ...(existing?.address || {}), ...(v as any) };
    } else {
      (out as any)[k] = v;
    }
  }
  return out;
}

/** ------------------------------ Routes ----------------------------------- */

/** LIST */
r.get("/", async (req, res, next) => {
  try {
    const tenantId = TENANT(req);
    const rows = await prisma.client.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, data: rows.map(normalize) });
  } catch (err) {
    next(err);
  }
});

/** DETAIL */
r.get("/:id", async (req, res, next) => {
  try {
    const tenantId = TENANT(req);
    const row = await prisma.client.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!row) return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true, data: normalize(row) });
  } catch (err) {
    next(err);
  }
});

/** CREATE */
r.post("/", async (req, res, next) => {
  try {
    const tenantId = TENANT(req);
    const parsed = ClientCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, errors: parsed.error.flatten() });
    }
    const i: ClientCreate = parsed.data;
    const meta = buildMeta(i);
    const addressText = typeof i.address === "string" && i.address.trim() ? i.address.trim() : null;

    // First attempt: write to meta (if schema supports it)
    try {
      const data: any = {
        tenantId,
        name: i.name,
        email: i.email ?? null,
        phone: i.phone ?? null,
        address: addressText, // keep legacy free text if any
        meta,                 // structured bill-to
      };
      const created = await prisma.client.create({ data } as any);
      return res.json({ ok: true, data: normalize(created) });
    } catch (err) {
      if (!isUnknownMetaError(err)) throw err;
      // Fallback: pack everything into address as JSON
      const packed = packAddressJSON(meta, addressText || undefined);
      const created = await prisma.client.create({
        data: {
          tenantId,
          name: i.name,
          email: i.email ?? null,
          phone: i.phone ?? null,
          address: packed,
        },
      });
      return res.json({ ok: true, data: normalize(created) });
    }
  } catch (err) {
    next(err);
  }
});

/** UPDATE (PUT/PATCH share same logic) */
async function updateClient(req: any, res: any, next: any) {
  try {
    const tenantId = TENANT(req);
    const parsed = ClientUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, errors: parsed.error.flatten() });
    }
    const i: ClientUpdate = parsed.data;

    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    // Build incoming meta, merge with existing (from meta if present; else from address JSON)
    const incomingMeta = buildMeta(i);
    let currentMeta: any = existing.meta || null;
    if (!currentMeta) currentMeta = tryParseAddressJSON(existing.address || null);
    // strip non-meta keys from parsed address JSON
    const normalizedCurrentMeta: any = {
      gstin: (currentMeta as any).gstin,
      pan: (currentMeta as any).pan,
      website: (currentMeta as any).website,
      logoUrl: (currentMeta as any).logoUrl,
      address: {
        line1: (currentMeta as any).addressLine1,
        line2: (currentMeta as any).addressLine2,
        city: (currentMeta as any).city,
        state: (currentMeta as any).state,
        postalCode: (currentMeta as any).postalCode,
        country: (currentMeta as any).country,
      },
    };
    const mergedMeta = mergeMeta(normalizedCurrentMeta, incomingMeta);

    // Update legacy free-text address only if caller explicitly sends a string
    let addressText: string | null = existing.address ?? null;
    if (typeof i.address === "string") {
      addressText = i.address.trim() ? i.address.trim() : null;
    }

    // Try update with meta first
    try {
      const data: any = {
        name: i.name ?? existing.name,
        email: i.email ?? existing.email,
        phone: i.phone ?? existing.phone,
        address: addressText,
        meta: mergedMeta,
      };
      const updated = await prisma.client.update({
        where: { id: req.params.id },
        data: data as any,
      });
      return res.json({ ok: true, data: normalize(updated) });
    } catch (err) {
      if (!isUnknownMetaError(err)) throw err;
      // Fallback: pack merged meta into address JSON
      const packed = packAddressJSON(mergedMeta, addressText || undefined);
      const updated = await prisma.client.update({
        where: { id: req.params.id },
        data: {
          name: i.name ?? existing.name,
          email: i.email ?? existing.email,
          phone: i.phone ?? existing.phone,
          address: packed,
        },
      });
      return res.json({ ok: true, data: normalize(updated) });
    }
  } catch (err) {
    next(err);
  }
}

r.put("/:id", updateClient);
r.patch("/:id", updateClient);

export default r;
