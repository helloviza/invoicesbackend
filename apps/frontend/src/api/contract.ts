// apps/frontend/src/api/contract.ts

const getPath = (obj: any, path: string) =>
  path.split(".").reduce((o: any, k: string) => (o ? o[k] : undefined), obj);

const pick = (obj: any, keys: string[]) => {
  for (const k of keys) {
    const v = k.includes(".") ? getPath(obj, k) : obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
};

export const CONTRACT = {
  // e.g. VITE_API_BASE="http://localhost:8080"
  baseURL: (import.meta as any)?.env?.VITE_API_BASE || "http://localhost:8080",
  bearerAuth: true,

  endpoints: {
    // --- Auth ---
    login: "/api/auth/login",
    register: "/api/auth/register",

    // --- Clients ---
    clients: "/api/clients",
    clientsList: "/api/clients",
    clientsCreate: "/api/clients",
    clientUpdate: (id: string) => `/api/clients/${id}`,

    // --- Invoices ---
    invoiceCreate: "/api/invoices",
    invoicePdf: (id: string) => `/api/invoices/${id}/pdf`,
  } as const,

  // ---------------- helpers ----------------
  unwrapList: (resp: any) => {
    const d = resp?.data ?? resp;
    return d?.data ?? d?.items ?? d?.result ?? (Array.isArray(d) ? d : []);
  },

  unwrapOne: (resp: any) => {
    const d = resp?.data ?? resp;
    return d?.data ?? d;
  },

  normalizeClient: (r: any) => ({
    id: pick(r, ["id", "_id", "clientId", "uuid"]) ?? "",
    name: pick(r, ["name", "companyName", "clientName", "vendorName", "title"]) ?? "",
    email: pick(r, ["email", "contactEmail", "billingEmail", "mail"]) ?? "",
    phone: pick(r, ["phone", "contactPhone", "mobile", "telephone"]) ?? "",
    gstin: pick(r, ["gstin", "GSTIN", "gst", "gstNumber", "taxId"]) ?? "",
    pan: pick(r, ["pan", "PAN", "panNumber"]) ?? "",
    website: pick(r, ["website", "site"]) ?? "",
    logoUrl: pick(r, ["logoUrl", "logo"]) ?? "",
    addressLine1: pick(r, ["addressLine1", "address.line1", "billingAddress.line1", "billing.line1"]) ?? "",
    addressLine2: pick(r, ["addressLine2", "address.line2", "billingAddress.line2", "billing.line2"]) ?? "",
    city: pick(r, ["city", "address.city", "billingAddress.city", "billing.city"]) ?? "",
    state: pick(r, ["state", "address.state", "billingAddress.state", "billing.state"]) ?? "",
    postalCode: pick(r, ["postalCode", "pin", "pincode", "zip", "address.postalCode", "billingAddress.postalCode", "billing.zip"]) ?? "",
    country: pick(r, ["country", "address.country", "billingAddress.country", "billing.country"]) ?? "",
    ...r,
  }),

  normalizeInvoiceCreateResp: (resp: any) => {
    const d = (resp?.data ?? resp)?.data ?? (resp?.data ?? resp);
    return {
      id: pick(d, ["id", "_id", "invoiceId"]) ?? "",
      invoiceNo: pick(d, ["invoiceNo", "number", "code"]) ?? "",
    };
  },
} as const;
