import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

import authRouter from './routes/auth.js';
import invoicesRouter from './routes/invoices.js';
import clientsRouter from './routes/clients.js';
import authMiddleware from './utils/auth.js';
import invoiceExports from './routes/invoiceExports.js';
import dashboardRouter from './routes/dashboard.js';
import importPreviewRouter from './routes/importPreview.js';
import usersRouter from './routes/users.js';

/* ----------------------------------------------------------------------------
 * App & env
 * --------------------------------------------------------------------------*/
const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '';

/* ----------------------------------------------------------------------------
 * CORS allow-list (env + *.plumtrips.com + localhost dev)
 * --------------------------------------------------------------------------*/
const FRONTEND_ORIGINS_ENV = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const LOCALHOSTS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

const allowOrigin = (origin?: string) => {
  if (!origin) return true;
  if (FRONTEND_ORIGINS_ENV.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && /\.plumtrips\.com$/i.test(u.hostname)) return true;
    if (NODE_ENV !== 'production' && LOCALHOSTS.has(origin)) return true;
  } catch {
    /* ignore */
  }
  return false;
};

// trust proxy for secure cookies behind ALB/App Runner
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Helmet (allow opening PDFs from other origins)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

/* ----------------------------------------------------------------------------
 * Permissive CORS
 * --------------------------------------------------------------------------*/
const corsOptions: CorsOptions = {
  origin(origin, cb) {
    cb(null, allowOrigin(origin) ? true : false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: undefined,
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 204,
};

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin) res.header('Vary', 'Origin');
  next();
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* ----------------------------------------------------------------------------
 * Body parsing + clean JSON error
 * --------------------------------------------------------------------------*/
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ ok: false, message: err.message || 'Invalid JSON' });
  }
  return next(err);
});

/* ----------------------------------------------------------------------------
 * Static for local PDF testing (./pdfs)
 * --------------------------------------------------------------------------*/
const pdfRoot = path.resolve(process.cwd(), 'pdfs');
try { fs.mkdirSync(pdfRoot, { recursive: true }); } catch {}
app.use('/static', express.static(pdfRoot));

/* ----------------------------------------------------------------------------
 * Health
 * --------------------------------------------------------------------------*/
app.get('/', (_req, res) => res.redirect('/api/health'));
app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, env: NODE_ENV, time: new Date().toISOString(), publicUrl: PUBLIC_URL });
});

/* ----------------------------------------------------------------------------
 * Public auth routes (BEFORE auth middleware)
 * --------------------------------------------------------------------------*/
app.use('/api/auth', authRouter);

/* ----------------------------------------------------------------------------
 * Auth protect everything else under /api
 * --------------------------------------------------------------------------*/
app.use('/api', authMiddleware);

/* ----------------------------------------------------------------------------
 * Protected routes
 * --------------------------------------------------------------------------*/
app.use('/api/clients', clientsRouter);

// 🧩 Exports (CSV / XLSX / Combined PDF) — must come BEFORE main invoices CRUD
app.use('/api/invoices', invoiceExports);

// 📄 Main invoices CRUD / single PDF endpoints
app.use('/api/invoices', invoicesRouter);

app.use('/api/dashboard', dashboardRouter);
app.use('/api', importPreviewRouter);
app.use('/api/users', usersRouter);

/* ----------------------------------------------------------------------------
 * Compat: POST /api/invoices/search & /list
 * --------------------------------------------------------------------------*/
const isObjectId = (s?: string) => !!s && /^[0-9a-f]{24}$/i.test(s);

function resolveTenantIdFromReq(req: Request): string | null {
  const claim =
    (req as any).user?.['custom:tenantId'] ||
    (req as any).user?.tenantId ||
    req.header('x-tenant-id') ||
    DEFAULT_TENANT_ID ||
    '';
  return isObjectId(claim) ? claim : null;
}

async function listInvoices(req: Request, res: Response) {
  try {
    const tenantId = resolveTenantIdFromReq(req);
    const page = Math.max(1, parseInt(String(req.query.page || req.body?.page || '1'), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || req.body?.limit || '50'), 10)));
    const skip = (page - 1) * limit;

    const q = (req.query.q || req.body?.q || '').toString().trim();
    const clientId = (req.query.billToId || req.body?.billToId || '').toString().trim();
    const dateFromISO = (req.query.dateFrom || req.body?.dateFrom || '').toString().trim();
    const dateToISO = (req.query.dateTo || req.body?.dateTo || '').toString().trim();
    const status = (req.query.status || req.body?.status || '').toString().trim().toUpperCase();
    const docTypeIn = (req.query.docType || req.body?.docType || '').toString().trim().toLowerCase();
    const isProforma = req.query.isProforma ?? req.body?.isProforma;

    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (q) where.invoiceNo = { contains: q, mode: 'insensitive' };
    if (clientId) where.clientId = clientId;

    if (dateFromISO || dateToISO) {
      where.issueDate = {};
      if (dateFromISO) where.issueDate.gte = new Date(dateFromISO);
      if (dateToISO) where.issueDate.lte = new Date(dateToISO);
    }

    if (status) where.status = status;
    if (docTypeIn) where.docType = docTypeIn;
    if (typeof isProforma === 'boolean') where.isProforma = isProforma;

    const orderBy = { createdAt: 'desc' as const };

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy,
        include: { client: true, items: true },
        skip, take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return res.json({ ok: true, items, total, page, limit });
  } catch (e: any) {
    return res.status(400).json({ ok: false, message: e?.message || 'Failed to list invoices' });
  }
}

app.post('/api/invoices/search', listInvoices);
app.post('/api/invoices/list', listInvoices);

/* ----------------------------------------------------------------------------
 * 404 + error handler
 * --------------------------------------------------------------------------*/
app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, message: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  if (NODE_ENV !== 'test') console.error('🔥 Unhandled error:', err);
  res.status(500).json({ ok: false, message });
});

/* ----------------------------------------------------------------------------
 * Start & graceful shutdown
 * --------------------------------------------------------------------------*/
const server = app.listen(PORT, () => {
  console.log(`✅ API listening on :${PORT}`);
  console.log(`   Static PDFs at /static -> ${pdfRoot}`);
});

async function shutdown(signal: NodeJS.Signals) {
  console.log(`\n↩️  Received ${signal}, shutting down...`);
  server.close(async () => {
    try { await prisma.$disconnect(); }
    finally { console.log('👋 Bye!'); process.exit(0); }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  console.error('🚨 Unhandled Rejection:', reason);
});
