import { Router, type Request, type Response, type NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
const router = Router();

// password policy: 6–18, 1 upper, 1 lower, 1 digit, 1 special, no spaces
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])[^\s]{6,18}$/;

/* -------------------------------------------------------------------------- */
/*                        Allow admin or DISABLE_AUTH=true                    */
/* -------------------------------------------------------------------------- */
function ensureAdmin(req: Request, res: Response, next: NextFunction) {
  const role = (req as any)?.user?.role || (req as any)?.auth?.role || "";
  const devBypass = process.env.DISABLE_AUTH === "true";
  if (
    devBypass ||
    String(role).toLowerCase() === "admin" ||
    String(role).toLowerCase() === "owner"
  ) {
    return next();
  }
  return res.status(403).json({ ok: false, message: "Admin only" });
}

/* -------------------------------------------------------------------------- */
/*                             Normalizer helper                              */
/* -------------------------------------------------------------------------- */
function normalizeUser(u: any) {
  const roleRaw = String(u.role ?? "").toLowerCase();
  const role = roleRaw === "viewer" ? "staff" : roleRaw;
  return {
    id: String(u.id ?? u._id ?? ""),
    email: String(u.email ?? ""),
    name: u.name ?? u.fullName ?? u.displayName ?? "",
    role,
    isActive: (u.isActive ?? u.active ?? u.enabled ?? true) ? true : false,
    createdAt: u.createdAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/*                                Routes                                      */
/* -------------------------------------------------------------------------- */

// GET /api/users
router.get("/", ensureAdmin, async (_req, res) => {
  try {
    const rows: any[] = await (prisma as any).userProfile.findMany({});
    res.json(rows.map(normalizeUser));
  } catch (e: any) {
    console.error("users list failed:", e);
    res.status(500).json({ ok: false, message: "Failed to list users" });
  }
});

// POST /api/users
router.post("/", ensureAdmin, async (req, res) => {
  try {
    const { name, email, role, password } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ ok: false, message: "email required" });
    }

    const roleNorm = String(role || "staff").toLowerCase();
    if (!["admin", "staff"].includes(roleNorm)) {
      return res.status(400).json({ ok: false, message: "invalid role" });
    }

    if (!PASSWORD_RE.test(String(password || ""))) {
      return res
        .status(400)
        .json({ ok: false, message: "Password does not meet policy" });
    }

    const existing = await (prisma as any).userProfile.findFirst({
      where: { email: email.toLowerCase() },
    });
    if (existing)
      return res
        .status(409)
        .json({ ok: false, message: "Email already in use" });

    const passwordHash = await bcrypt.hash(String(password), 10);

    // 👇 generate required sub
    const sub = randomUUID();

    const created = await (prisma as any).userProfile.create({
      data: {
        sub,
        email: email.toLowerCase(),
        name: name || null,
        role: roleNorm,
        isActive: true,
        passwordHash,
        tenantId: process.env.DEFAULT_TENANT_ID || null,
      },
    });

    res.json(normalizeUser(created));
  } catch (e: any) {
    console.error("user create failed:", e);
    res.status(500).json({
      ok: false,
      message: "Create failed",
      detail: e?.message || "unknown",
    });
  }
});

// PATCH /api/users/:id
router.patch("/:id", ensureAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const { role, isActive, password } = req.body || {};
    const data: any = {};

    if (role !== undefined) {
      const roleNorm = String(role).toLowerCase();
      if (!["admin", "staff"].includes(roleNorm)) {
        return res.status(400).json({ ok: false, message: "invalid role" });
      }
      data.role = roleNorm;
    }
    if (typeof isActive === "boolean") data.isActive = !!isActive;

    if (password !== undefined) {
      if (!PASSWORD_RE.test(String(password || ""))) {
        return res
          .status(400)
          .json({ ok: false, message: "Password does not meet policy" });
      }
      data.passwordHash = await bcrypt.hash(String(password), 10);
    }

    const updated = await (prisma as any).userProfile.update({
      where: { id },
      data,
    });
    res.json(normalizeUser(updated));
  } catch (e: any) {
    console.error("user patch failed:", e);
    res.status(500).json({ ok: false, message: "Update failed" });
  }
});

export default router;
