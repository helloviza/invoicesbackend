import { getJson } from './api';


// Open by invoice number
export async function openInvoicePdfByNo(invoiceNo: string) {
  const data = await getJson(`/api/invoices/by-no/${encodeURIComponent(invoiceNo)}/pdf`);
  window.open(data.url, '_blank', 'noopener,noreferrer');
}

// Or open by id
export async function openInvoicePdfById(id: string) {
  const data = await getJson(`/api/invoices/${id}/pdf`);
  window.open(data.url, '_blank', 'noopener,noreferrer');
}
