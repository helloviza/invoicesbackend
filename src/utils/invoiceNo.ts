import { PrismaClient } from '@prisma/client';
import { format } from 'date-fns';

const prisma = new PrismaClient();

export async function nextInvoiceNo(tenantId: string) {
  const today = format(new Date(), 'yyyyMMdd');
  const prefix = process.env.INVOICE_PREFIX || 'INV';

  const counter = await prisma.invoiceCounter.upsert({
    where: { tenantId_yyyymmdd: { tenantId, yyyymmdd: today } },
    create: { tenantId, yyyymmdd: today, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } }
  });

  const seq = String(counter.lastSeq).padStart(3, '0');
  return `${prefix}-${today}-${seq}`;
}
