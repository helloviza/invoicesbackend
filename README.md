# PlumTrips Invoicing CRM — Starter Monorepo

This is a production-grade starter for the **Invoicing CRM** requested. It contains:

- **Backend (Node/Express/TypeScript + Prisma + PostgreSQL)** under `apps/backend`
- **Frontend (React + Vite + TypeScript + Material-UI + Redux Toolkit)** under `apps/frontend`

It implements:
- Multi-service invoice model with JSONB details per line item (Flights, Hotels, Holidays, Visas, MICE, Stationery, Gift Items, Goodies, Other)
- Invoice number generator `INV-YYYYMMDD-###` with per-tenant counters
- JWT auth middleware that validates AWS Cognito tokens (via JWKS)
- PDF generation (pdfmake) and S3 upload; SES email ready
- Basic REST APIs for clients and invoices
- React app with service-type dropdown and dynamic line-item table powered by a single schema

> PDF styling uses a neutral theme; share your exact sample PDF to finalize fonts/colors and table layout 1:1.

## Quick Start (Local)

### Prereqs
- Node 20+
- PNPM or NPM
- PostgreSQL 14+
- Create an S3 bucket (for PDFs) and configure AWS creds locally if you want PDF upload.

### 1) Backend
```bash
cd apps/backend
cp .env.example .env
# edit .env with DB URL, Cognito, S3, SES values
pnpm i   # or npm i
pnpm prisma migrate dev
pnpm dev
```

### 2) Frontend
```bash
cd ../frontend
cp .env.example .env
pnpm i   # or npm i
pnpm dev
```

Open http://localhost:5173 and log in via Cognito Hosted UI or provide a token in Authorization header for testing APIs (Bearer <JWT>).

## Deploy (High level)
- **RDS (PostgreSQL)**, **S3**, **SES** (production access), **ACM cert** for `billing.plumtrips.com`, **Route53** DNS
- **Backend**: Elastic Beanstalk (Node platform) or ECS/Fargate with the included Dockerfile
- **Frontend**: AWS Amplify or S3+CloudFront
- Configure environment variables as per `.env.example` files

## Structure
- `apps/backend` — API server, Prisma schema, PDF/S3/SES helpers
- `apps/frontend` — React app (MUI), dynamic invoice forms with Redux Toolkit
