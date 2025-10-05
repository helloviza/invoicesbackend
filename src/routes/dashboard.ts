import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/* ---------------------------- helpers ---------------------------- */
const toNum = (v: any, d = 0) => {
  if (v === null || v === undefined) return d;
  const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  return Number.isFinite(n) ? n : d;
};
const normKey = (x: any) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pick = (obj: any, keys: string[], fb?: any) => {
  if (!obj || typeof obj !== "object") return fb;
  const map = new Map<string, string>();
  for (const k of Object.keys(obj)) map.set(normKey(k), k);
  for (const k of keys) {
    const real = map.get(normKey(k));
    if (real !== undefined) {
      const v = (obj as any)[real];
      if (v !== undefined && v !== null) return v;
    }
  }
  return fb;
};

function canonicalServiceType(raw: any): string {
  const s = normKey(raw);
  if (["flight", "flights", "air", "airticket", "ticket"].includes(s) || s.startsWith("flight") || s.startsWith("air"))
    return "FLIGHTS";
  if (["hotel", "hotels", "stay"].includes(s) || s.startsWith("hotel") || s.includes("stay")) return "HOTELS";
  if (["holiday", "tour", "package"].includes(s) || s.startsWith("holiday") || s.includes("tour")) return "HOLIDAYS";
  if (["visa", "visas"].includes(s)) return "VISAS";
  if (["mice", "conference", "event", "meeting"].includes(s) || s.startsWith("mice")) return "MICE";
  if (["stationary", "stationery"].includes(s)) return "STATIONERY";
  if (["gift", "gifts", "giftitems"].includes(s)) return "GIFT_ITEMS";
  if (["goodies", "goodie"].includes(s)) return "GOODIES";
  return "OTHER";
}

function parseDayISO(x: any): string | undefined {
  if (!x) return;
  const d = new Date(x);
  if (isNaN(+d)) return;
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function buildWhere(query: any) {
  const { clientId, from, to } = query || {};
  const where: any = { AND: [] as any[] };
  if (clientId) where.AND.push({ clientId: String(clientId) });
  const fromISO = from ? new Date(from) : null;
  const toISO = to ? new Date(to) : null;
  if (fromISO || toISO) {
    where.AND.push({
      issueDate: {
        ...(fromISO ? { gte: fromISO } : {}),
        ...(toISO ? { lte: toISO } : {}),
      },
    });
  }
  if (!where.AND.length) delete where.AND;
  return where;
}

/* ---------------------------- /summary --------------------------- */
router.get("/summary", async (req, res) => {
  try {
    const where = buildWhere(req.query);

    // 🔧 No `select` – let Prisma return all fields; we’ll pick what we need safely.
    const rows = (await prisma.invoice.findMany({
      where,
      orderBy: [{ issueDate: "asc" }],
    })) as any[];

    let count = 0;
    let subtotalSum = 0;
    let taxSum = 0;
    let totalSum = 0;

    const typeAgg = new Map<string, { subtotal: number; total: number; count: number }>();
    const statusAgg = new Map<string, number>();

    for (const r of rows) {
      count += 1;

      const subtotal = toNum(pick(r, ["subtotal", "subTotal"], 0), 0);
      const tax = toNum(pick(r, ["taxTotal", "tax_total", "taxAmt", "tax"], 0), 0);
      const svc = toNum(pick(r, ["serviceCharges", "serviceCharge"], 0), 0);

      let total = toNum(pick(r, ["total", "grandTotal"], 0), 0);
      if (!total) total = subtotal + tax + svc;

      subtotalSum += subtotal;
      taxSum += tax;
      totalSum += total;

      const typeKey = canonicalServiceType(r.serviceType);
      const t = typeAgg.get(typeKey) ?? { subtotal: 0, total: 0, count: 0 };
      t.subtotal += subtotal;
      t.total += total;
      t.count += 1;
      typeAgg.set(typeKey, t);

      const st = String(r.status ?? "UNKNOWN");
      statusAgg.set(st, (statusAgg.get(st) ?? 0) + 1);
    }

    res.json({
      totals: { count, subtotal: subtotalSum, tax: taxSum, total: totalSum },
      byServiceType: Array.from(typeAgg.entries()).map(([key, v]) => ({
        key,
        subtotal: v.subtotal,
        total: v.total,
        count: v.count,
      })),
      byStatus: Array.from(statusAgg.entries()).map(([key, count]) => ({ key, count })),
    });
  } catch (e: any) {
    console.error("dashboard /summary failed:", e);
    res.status(500).json({ ok: false, message: "Summary failed" });
  }
});

/* ----------------------------- /daily ---------------------------- */
router.get("/daily", async (req, res) => {
  try {
    const where = buildWhere(req.query);

    // 🔧 No `select` here either.
    const rows = (await prisma.invoice.findMany({
      where,
      orderBy: [{ issueDate: "asc" }],
    })) as any[];

    const dayMap = new Map<string, number>();
    for (const r of rows) {
      const day = parseDayISO(r.issueDate) || parseDayISO(Date.now());
      if (!day) continue;

      const subtotal = toNum(pick(r, ["subtotal", "subTotal"], 0), 0);
      const tax = toNum(pick(r, ["taxTotal", "tax_total", "taxAmt", "tax"], 0), 0);
      const svc = toNum(pick(r, ["serviceCharges", "serviceCharge"], 0), 0);

      let total = toNum(pick(r, ["total", "grandTotal"], 0), 0);
      if (!total) total = subtotal + tax + svc;

      const prev = dayMap.get(day) ?? 0;
      dayMap.set(day, prev + total);
    }

    const out = Array.from(dayMap.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    res.json(out);
  } catch (e: any) {
    console.error("dashboard /daily failed:", e);
    res.status(500).json({ ok: false, message: "Daily series failed" });
  }
});

export default router;
