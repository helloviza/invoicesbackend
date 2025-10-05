// apps/backend/src/routes/auth.ts
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const r = Router();
const prisma = new PrismaClient();

/* -----------------------------------------------------------------------------
   Config
----------------------------------------------------------------------------- */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 8); // 8h
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '';

const isObjectId = (s?: string) => !!s && /^[0-9a-f]{24}$/i.test(s);

/* -----------------------------------------------------------------------------
   Optional bcryptjs (fallback to PBKDF2 if not installed)
----------------------------------------------------------------------------- */
let bcrypt: any = null;
try {
  // @ts-ignore optional
  bcrypt = (await import('bcryptjs')).default ?? (await import('bcryptjs'));
} catch {
  /* use PBKDF2 fallback */
}

async function hashPassword(pw: string): Promise<string> {
  if (bcrypt?.hash) return await bcrypt.hash(pw, 10);
  return await new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(pw, salt, 310_000, 32, 'sha256', (err, hashed) => {
      if (err) return reject(err);
      resolve(`pbkdf2$${salt}$${hashed.toString('hex')}`);
    });
  });
}

async function verifyPassword(pw: string, hashed: string): Promise<boolean> {
  if (bcrypt?.compare) return await bcrypt.compare(pw, hashed);
  const [alg, salt, body] = (hashed || '').split('$');
  if (alg !== 'pbkdf2' || !salt || !body) return false;
  return await new Promise((resolve) => {
    crypto.pbkdf2(pw, salt, 310_000, 32, 'sha256', (err, calc) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(Buffer.from(body, 'hex'), calc));
    });
  });
}

function signToken(payload: Record<string, any>) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS });
}

/* -----------------------------------------------------------------------------
   Schemas
----------------------------------------------------------------------------- */
const RegisterSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  username: z.string().min(3),
  password: z.string().min(8),
  tenantName: z.string().min(1).optional(),
});

const LoginSchemaFlexible = z.object({
  usernameOrEmail: z.string().optional(),
  username: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(1),
}).refine(
  (d) => !!(d.usernameOrEmail || d.username || d.email),
  { message: 'Provide usernameOrEmail, username, or email', path: ['usernameOrEmail'] },
);

/* tiny slugger for tenant slugs */
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* -----------------------------------------------------------------------------
   POST /api/auth/register
----------------------------------------------------------------------------- */
r.post('/register', async (req, res) => {
  let input: z.infer<typeof RegisterSchema>;
  try {
    input = RegisterSchema.parse(req.body);
  } catch (e) {
    const zerr = e as z.ZodError;
    return res.status(400).json({ ok: false, errors: zerr.flatten() });
  }

  const { name, email, username, password, tenantName } = input;

  // Uniqueness checks
  const existing = await prisma.userProfile.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] },
    select: { id: true },
  });
  if (existing) return res.status(409).json({ ok: false, message: 'Email or username already in use' });

  // Ensure a tenant to attach user
  let tenantId = DEFAULT_TENANT_ID && isObjectId(DEFAULT_TENANT_ID) ? DEFAULT_TENANT_ID : '';
  if (!tenantId) {
    const tenant = await prisma.tenant.create({
      data: {
        name: tenantName || `${name}'s Org`,
        slug: slugify(tenantName || `${username}-org`),
      },
      select: { id: true },
    });
    tenantId = tenant.id;
  }

  const passwordHash = await hashPassword(password);

  // Our schema uses UserProfile; create a local user row with a synthetic `sub`
  const sub = crypto.randomBytes(12).toString('hex');
  const user = await prisma.userProfile.create({
    data: {
      sub,
      tenantId,
      name,
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      passwordHash,
      role: 'VIEWER', // string literal to avoid enum import churn
    },
    select: { id: true, name: true, email: true, username: true, tenantId: true, role: true },
  });

  const token = signToken({
    sub: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    'custom:tenantId': user.tenantId,
  });

  res.json({ ok: true, token, user });
});

/* -----------------------------------------------------------------------------
   POST /api/auth/login  (flexible keys)
----------------------------------------------------------------------------- */
r.post('/login', async (req, res) => {
  let input: z.infer<typeof LoginSchemaFlexible>;
  try {
    input = LoginSchemaFlexible.parse(req.body);
  } catch (e) {
    const zerr = e as z.ZodError;
    return res.status(400).json({ ok: false, errors: zerr.flatten() });
  }

  const keyRaw = input.usernameOrEmail || input.username || input.email!;
  const key = keyRaw.toLowerCase();

  const user = await prisma.userProfile.findFirst({
    where: { OR: [{ email: key }, { username: key }] },
    select: { id: true, email: true, username: true, name: true, passwordHash: true, role: true, tenantId: true },
  });
  if (!user) return res.status(401).json({ ok: false, message: 'Invalid credentials' });

  const ok = await verifyPassword(input.password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ ok: false, message: 'Invalid credentials' });

  const token = signToken({
    sub: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    'custom:tenantId': user.tenantId,
  });

  res.json({
    ok: true,
    token,
    user: { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, tenantId: user.tenantId },
  });
});

/* -----------------------------------------------------------------------------
   GET /api/auth/me
----------------------------------------------------------------------------- */
r.get('/me', (req, res) => {
  const authz = req.headers.authorization;
  if (!authz?.startsWith('Bearer ')) return res.status(401).json({ ok: false, message: 'Missing Bearer token' });
  const token = authz.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as Record<string, any>;
    return res.json({ ok: true, user: payload });
  } catch (e: any) {
    return res.status(401).json({ ok: false, message: 'Invalid token', error: e?.message });
  }
});

export default r;
