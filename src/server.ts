// apps/backend/src/server.ts
import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

import authRouter from './routes/auth.js';
import invoicesRouter from './routes/invoices.js';
import clientsRouter from './routes/clients.js';
import authMiddleware from './utils/auth.js';
import invoiceExports from './routes/invoiceExports.js';
import dashboardRouter from './routes/dashboard.js';
import importPreviewRouter from './routes/importPreview.js';
import usersRouter from './routes/users.js';

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '';

/* -----------------------------------------------------------
 * CORS allow-list helpers
 * --------------------------------------------------------- */
const FRONTEND_ORIGINS_ENV = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const LOCALHOSTS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

const allowOrigin = (origin?: string) => {
  if (!origin) return true; // non-browser / same-origin
  if (FRONTEND_ORIGINS_ENV.includes(origin)) return true;

  // allow *.plumtrips.com (both app and api subdomains)
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && /\.plumtrips\.com$/i.test(u.hostname)) return true;
    if (NODE_ENV !== 'production' && LOCALHOSTS.has(origin)) return true;
  } catch {}
  return false;
};

// Trust proxy for secure cookies behind ALB/App Runner
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Helmet (allow opening PDFs from other origins)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

/* -----------------------------------------------------------
 * Strong CORS: reflect origin on every response (incl. errors)
 * --------------------------------------------------------- */
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (allowOrigin(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  // Let the cors() middleware also add its headers
  next();
});

app.use(
  cors({
    origin: (origin, cb) => cb(null, allowOrigin(origin) ? true : false),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Tenant-Id'],
    exposedHeaders: ['Content-Disposition'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);
app.options('*', cors());

/* -----------------------------------------------------------
 * Body parsing + clean JSON error
 * --------------------------------------------------------- */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ ok: false, message: err.message || 'Invalid JSON' });
  }
  return next(err);
});

/* -----------------------------------------------------------
 * Static files for local PDF testing (./pdfs)
 * --------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pdfRoot = path.join(process.cwd(), 'pdfs');
try { fs.mkdirSync(pdfRoot, { recursive: true }); } catch {}
app.use('/static', express.static(pdfRoot));

/* -----------------------------------------------------------
 * Health
 * --------------------------------------------------------- */
app.get('/', (_req, res) => res.redirect('/api/health'));
app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, env: NODE_ENV, time: new Date().toISOString(), publicUrl: PUBLIC_URL });
});

/* -----------------------------------------------------------
 * Public auth routes (BEFORE auth middleware)
 * --------------------------------------------------------- */
app.use('/api/auth', authRouter);

/* -----------------------------------------------------------
 * Auth protect everything under /api (except above)
 * --------------------------------------------------------- */
app.use('/api', authMiddleware);

/* -----------------------------------------------------------
 * Routes (protected)
 * --------------------------------------------------------- */
app.use('/api/clients', clientsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/invoices', invoiceExports);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', importPreviewRouter);
app.use('/api/users', usersRouter);

/* -----------------------------------------------------------
 * Compatibility shims:
 *   POST /api/invoices/search
 *   POST /api/invoices/list
 *   -> behave like GET /api/invoices (supporting page/limit minimally)
 * --------------------------------------------------------- */
const isObjectId = (s?: string) => !!s && /^[0-9a-f]{24}$/i.test(s);
function resolveTenantIdFromReq(req: Request): string {
  const tid =
    (req as any).user?.['custom:tenantId'] ||
    req.header('x-tenant-id') ||
    DEFAULT_TENANT_ID ||
    '';
  if (!tid || !isObjectId(tid)) {
    throw new Error('Missing/invalid tenant id (expect 24-hex). Provide X-Tenant-Id or set DEFAULT_TENANT_ID.');
  }
  return tid;
}

async function listInvoices(req: Request, res: Response) {
  try {
    const tenantId = resolveTenantIdFromReq(req);
    const page = Math.max(1, parseInt(String(req.query.page || req.body?.page || '1'), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || req.body?.limit || '50'), 10)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { client: true, items: true },
        skip, take: limit,
      }),
      prisma.invoice.count({ where: { tenantId } }),
    ]);

    return res.json({ ok: true, items, total, page, limit });
  } catch (e: any) {
    return res.status(400).json({ ok: false, message: e?.message || 'Failed to list invoices' });
  }
}

app.post('/api/invoices/search', listInvoices);
app.post('/api/invoices/list', listInvoices);

/* -----------------------------------------------------------
 * 404 + error handler (keep CORS headers already set)
 * --------------------------------------------------------- */
app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, message: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  if (NODE_ENV !== 'test') console.error('🔥 Unhandled error:', err);
  res.status(500).json({ ok: false, message });
});

/* -----------------------------------------------------------
 * Start & graceful shutdown
 * --------------------------------------------------------- */
const server = app.listen(PORT, () => {
  console.log(`✅ API listening on :${PORT}`);
  console.log(`   Static PDFs at /static -> ${pdfRoot}`);
});

async function shutdown(signal: NodeJS.Signals) {
  console.log(`\n↩️  Received ${signal}, shutting down...`);
  server.close(async () => {
    try { await prisma.$disconnect(); } finally {
      console.log('👋 Bye!'); process.exit(0);
    }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => { console.error('🚨 Unhandled Rejection:', reason); });
