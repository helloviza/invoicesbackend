// apps/backend/scripts/make-tenant.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Usage: node scripts/make-tenant.mjs "PlumTrips" "plumtrips"
const nameArg = process.argv[2] || 'Plumtrips';
const slugArg = process.argv[3] || nameArg;

const slug = (slugArg || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || `tenant-${crypto.randomBytes(3).toString('hex')}`;

try {
  let tenant = await prisma.tenant.findFirst({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: nameArg, slug } });
    console.log('✅ Created tenant:', { id: tenant.id, name: tenant.name, slug: tenant.slug });
  } else {
    console.log('ℹ️  Tenant exists:', { id: tenant.id, name: tenant.name, slug: tenant.slug });
  }
  console.log('tenantId:', tenant.id);
} catch (e) {
  console.error('❌ Failed to create/find tenant:', e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
