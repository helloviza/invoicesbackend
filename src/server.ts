// apps/backend/src/server.ts
import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

import authRouter from './routes/auth.js';
import invoicesRouter from './routes/invoices.js';
import clientsRouter from './routes/clients.js';
import authMiddleware from './utils/auth.js';
import invoiceExports from './routes/invoiceExports.js'; // default export (router)
import dashboardRouter from './routes/dashboard.js';
import importPreviewRouter from './routes/importPreview.js';
import usersRouter from "./routes/users.js";

/** ----------------------------------------------------------------------------
 * App + config
 * ---------------------------------------------------------------------------*/
const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;

// Support comma-separated whitelist OR "*"
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const allowed = new Set(FRONTEND_ORIGINS);

// Trust proxy (ELB/ALB)
app.set('trust proxy', true);

// Remove X-Powered-By
app.disable('x-powered-by');

// Helmet (allow cross-origin resource policy so PDFs work when opened from other origins)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Typed CORS options
const corsOptions: CorsOptions = {
  origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
    if (!origin) return cb(null, true);
    if (allowed.has('*') || allowed.has(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
};

// Apply CORS and handle preflight
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Return clean 400 for malformed JSON instead of 500
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ ok: false, message: err.message || 'Invalid JSON' });
  }
  return next(err);
});

/** ----------------------------------------------------------------------------
 * Static files for local PDF testing (./pdfs)
 * ---------------------------------------------------------------------------*/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfRoot = path.join(process.cwd(), 'pdfs');
try { fs.mkdirSync(pdfRoot, { recursive: true }); } catch { /* ignore */ }

// Always expose /static so local "S3" links work
app.use('/static', express.static(pdfRoot));

/** ----------------------------------------------------------------------------
 * Health + root (public)
 * ---------------------------------------------------------------------------*/
app.get('/', (_req, res) => res.redirect('/api/health'));

app.get('/api/health', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    time: new Date().toISOString(),
    publicUrl: PUBLIC_URL,
  });
});

/** ----------------------------------------------------------------------------
 * Public auth routes (must be BEFORE auth middleware)
 * ---------------------------------------------------------------------------*/
app.use('/api/auth', authRouter);

/** ----------------------------------------------------------------------------
 * Auth (protect everything under /api except /api/health and /api/auth above)
 * ---------------------------------------------------------------------------*/
app.use('/api', authMiddleware);

/** ----------------------------------------------------------------------------
 * Routes (protected)
 * ---------------------------------------------------------------------------*/
app.use('/api/clients', clientsRouter);

// Generic invoices router (your CRUD and any built-in PDF endpoints it might have)
app.use('/api/invoices', invoicesRouter);

// Export routes (csv/xlsx + QR PDF; also adds /:idOrNo/pdf and /by-no/:no/pdf with fallback)
app.use('/api/invoices', invoiceExports);

// Dashboard + importer + users
app.use('/api/dashboard', dashboardRouter);
app.use('/api', importPreviewRouter);
app.use('/api/users', usersRouter);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, message: 'Not found' });
});

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  if (NODE_ENV !== 'test') console.error('ðŸ”¥ Unhandled error:', err);
  res
    .status(500)
    .json({ ok: false, message, ...(NODE_ENV === 'development' ? { stack: (err as any)?.stack } : {}) });
});

/** ----------------------------------------------------------------------------
 * Start & graceful shutdown
 * ---------------------------------------------------------------------------*/
const server = app.listen(PORT, () => {
  console.log(`âœ… API listening on :${PORT}`);
  console.log(`   Exports:  GET /api/invoices/export.csv`);
  console.log(`             GET /api/invoices/export.xlsx`);
  console.log(`             GET /api/invoices/:idOrNo/pdf (QR stamped, with dynamic fallback)`);
  console.log(`             GET /api/invoices/by-no/:no/pdf (QR stamped, with dynamic fallback)`);
  console.log(`   Static PDFs at /static -> ${pdfRoot}`);
});

async function shutdown(signal: NodeJS.Signals) {
  console.log(`\nâ†©ï¸  Received ${signal}, shutting down...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      console.log('ðŸ‘‹ Bye!');
      process.exit(0);
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  console.error('ðŸš¨ Unhandled Rejection:', reason);
});
