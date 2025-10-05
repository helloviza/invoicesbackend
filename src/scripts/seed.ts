import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const tenant = await p.tenant.upsert({
    where: { slug: 'default-tenant' },
    update: {},
    create: { name: 'Default Tenant', slug: 'default-tenant' },
  });

  const client = await p.client.create({
    data: {
      tenantId: tenant.id,
      name: 'Acme Travel Buyer',
      email: 'accounts@acme.example',
      phone: '+91-99999-00000',
      address: 'Mumbai, IN',
    },
  });

  console.log('Seeded:', { tenantId: tenant.id, clientId: client.id });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await p.$disconnect();
});
