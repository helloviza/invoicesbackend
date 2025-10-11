// src/server.ts
import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PrismaClient, type Prisma } from '@prisma/client';

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
  if (!origin) return true; // same-origin / server-to-server
  if (FRONTEND_ORIGINS_ENV.includes(origin)) return true;

  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && /\.plumtrips\.com$/i.test(u.hostname)) return true;
    if (NODE_ENV !== 'production' && LOCALHOSTS.has(origin)) return true;
  } catch {
    // ignore bad origins
  }
  return false;
};

// Trust proxy for secure cookies behind ALB/App Runner
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Helmet (allow opening PDFs from other origins)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Reflect CORS on all responses (including errors)
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (allowOrigin(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pdfRoot = path.join(process.cwd(), 'pdfs');
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
 * Auth protect everything under /api (except above)
 * --------------------------------------------------------------------------*/
app.use('/api', authMiddleware);

/* ----------------------------------------------------------------------------
 * Protected routes
 * --------------------------------------------------------------------------*/
app.use('/api/clients', clientsRouter);
app.use('/api/invoices', invoicesRouter);      // your main invoices CRUD/PDF
app.use('/api/invoices', invoiceExports);      // exports + extra PDF routes
app.use('/api/dashboard', dashboardRouter);
app.use('/api', importPreviewRouter);
app.use('/api/users', usersRouter);

/* ----------------------------------------------------------------------------
 * Compat: POST /api/invoices/search & /list behave like a GET list endpoint
 *  - Uses only Prisma-safe fields that typically exist:
 *      tenantId, invoiceNo (text search), clientId (Bill-To), issueDate, status, docType
 *  - Maps "performa" -> "PROFORMA" for enum-style docType
 *  - Accepts filters from query or body
 * --------------------------------------------------------------------------*/
const isObjectId = (s?: string) => !!s && /^[0-9a-f]{24}$/i.test(s);

function resolveTenantIdFromReq(req: Request): string {
  const tid =
    (req as any).user?.['custom:tenantId'] ||
    req.header('x-tenant-id') ||
    DEFAULT_TENANT_ID ||
    '';
  if (!tid || !isObjectId(tid)) {
    throw new Error(
      'Missing/invalid tenant id (expect 24-hex). Provide X-Tenant-Id or set DEFAULT_TENANT_ID.'
    );
  }
  return tid;
}

async function listInvoices(req: Request, res: Response) {
  try {
    const tenantId = resolveTenantIdFromReq(req);

    // pagination
    const page = Math.max(1, parseInt(String(req.query.page ?? req.body?.page ?? '1'), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? req.body?.limit ?? '50'), 10)));
    const skip = (page - 1) * limit;

    // filters (accept from query or body)
    const q        = String(req.query.q ?? req.body?.q ?? '').trim();
    const billToId = String(req.query.billToId ?? req.body?.billToId ?? '').trim();
    const status   = String(req.query.status ?? req.body?.status ?? '').trim();
    const docType  = String(req.query.docType ?? req.body?.docType ?? '').trim();
    const dateFrom = String(req.query.dateFrom ?? req.body?.dateFrom ?? '').trim();
    const dateTo   = String(req.query.dateTo   ?? req.body?.dateTo   ?? '').trim();

    // Build Prisma-safe where clause; adjust field names if your schema differs
    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      ...(q
        ? {
            OR: [
              { invoiceNo: { contains: q, mode: 'insensitive' } },
              // add more searchable text fields here if they exist:
              // { reference: { contains: q, mode: 'insensitive' } },
              // { poNumber:  { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(billToId ? { clientId: billToId } : {}),
      ...((dateFrom || dateTo)
        ? {
            issueDate: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo   ? { lte: new Date(dateTo)   } : {}),
            },
          }
        : {}),
      ...(status ? { status: status.toUpperCase() as any } : {}),
      ...(docType
        ? { docType: (docType.toLowerCase() === 'performa' ? 'PROFORMA' : 'INVOICE') as any }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { client: true, items: true }, // keep/trim as needed
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({ ok: true, items, total, page, limit });
  } catch (e: any) {
    res.status(400).json({ ok: false, message: e?.message || 'Failed to list invoices' });
  }
}

app.post('/api/invoices/search', listInvoices);
app.post('/api/invoices/list', listInvoices);

/* ----------------------------------------------------------------------------
 * 404 + error handler (CORS headers already set above)
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
process.on('unhandledRejection', (reason) => { console.error('🚨 Unhandled Rejection:', reason); });
