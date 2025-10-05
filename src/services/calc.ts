// apps/backend/src/services/calc.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";

/** Service type string-union we control (no Prisma enums referenced) */
export const SERVICE_TYPES = [
  "FLIGHTS",
  "HOTELS",
  "HOLIDAYS",
  "VISAS",
  "MICE",
  "STATIONERY",
  "GIFT_ITEMS",
  "GOODIES",
  "OTHER",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

/* ----------------------------------------------------------------------------
   Schemas (lenient). We add support for % fields everywhere it makes sense.
   These schemas are OPTIONAL (we do not throw on parse in the math functions),
   but are kept for any separate validation you might do elsewhere.
---------------------------------------------------------------------------- */
export const LineSchemas: Record<ServiceType, z.ZodTypeAny> = {
  FLIGHTS: z
    .object({
      // math
      fare: z.number().nonnegative(), // base
      // common % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute or granular charges (all optional)
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      otTax: z.number().nonnegative().optional().default(0),
      k3gst: z.number().nonnegative().optional().default(0),
      yqTax: z.number().nonnegative().optional().default(0),
      yrTax: z.number().nonnegative().optional().default(0),
      bagCharges: z.number().nonnegative().optional().default(0),
      mealCharges: z.number().nonnegative().optional().default(0),
      seatCharges: z.number().nonnegative().optional().default(0),
      spServiceCharges: z.number().nonnegative().optional().default(0),
      globalPrCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      ticketNo: z.string().optional(),
      originDestination: z.string().optional(),
      flightNo: z.string().optional(),
      paxName: z.string().optional(),
      type: z.enum(["One-way", "Round-trip", "Multi"]).optional(),
      class: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  HOTELS: z
    .object({
      rooms: z.number().positive(),
      nights: z.number().positive(),
      rate: z.number().nonnegative(),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute amounts
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      hotelName: z.string().optional(),
      roomType: z.string().optional(),
      paxName: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  HOLIDAYS: z
    .object({
      // two styles supported: (paxCount*basePrice) OR generic qty*unitPrice
      paxCount: z.number().positive().optional(),
      basePrice: z.number().nonnegative().optional(),
      quantity: z.number().positive().optional(),
      unitPrice: z.number().nonnegative().optional(),
      additionalFees: z.number().nonnegative().optional().default(0),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      packageName: z.string().optional(),
      destination: z.string().optional(),
      duration: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      inclusions: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  VISAS: z
    .object({
      processingFee: z.number().nonnegative().optional().default(0),
      embassyFee: z.number().nonnegative().optional().default(0),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      country: z.string().optional(),
      visaType: z.string().optional(),
      applicantName: z.string().optional(),
      passportNo: z.string().optional(),
      applicationDate: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  MICE: z
    .object({
      baseCost: z.number().nonnegative().optional().default(0),
      additionalCharges: z.number().nonnegative().optional().default(0),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      eventType: z.string().optional(),
      venue: z.string().optional(),
      date: z.string().optional(),
      attendeesCount: z.number().optional(),
      services: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  STATIONERY: z
    .object({
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      itemName: z.string().optional(),
      description: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  GIFT_ITEMS: z
    .object({
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      customizationCharges: z.number().nonnegative().optional().default(0),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      itemName: z.string().optional(),
      description: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  GOODIES: z
    .object({
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      brandingCharges: z.number().nonnegative().optional().default(0),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      itemName: z.string().optional(),
      description: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),

  OTHER: z
    .object({
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      additionalFees: z.number().nonnegative().optional().default(0),
      // % helpers
      taxPct: z.number().nonnegative().optional().default(0),
      servicePct: z.number().nonnegative().optional().default(0),
      // absolute
      tax: z.number().nonnegative().optional().default(0),
      serviceCharges: z.number().nonnegative().optional().default(0),
      // descriptive
      serviceDescription: z.string().optional(),
      currency: z.string().optional(),
    })
    .passthrough(),
};

/* -------------------------------------------------------------------------- */
/*                               Math (safe)                                  */
/* -------------------------------------------------------------------------- */

const num = (v: any, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const pct = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

function absOrPct(absMaybe: any, pctMaybe: any, base: number): number {
  // prefer absolute if present & > 0; otherwise compute from %
  const abs = num(absMaybe, 0);
  if (abs > 0) return abs;
  const p = pct(pctMaybe);
  if (p > 0) return (p / 100) * base;
  return 0;
}

/** Compute normalized amounts for a single line. */
export function computeLineParts(
  serviceType: ServiceType,
  details: Record<string, any>
): { base: number; tax: number; service: number; total: number } {
  const d = (details || {}) as Record<string, any>;
  let base = 0;
  let taxExtra = 0;     // explicit “tax-like” charges
  let serviceExtra = 0; // explicit service-like charges

  switch (serviceType) {
    case "FLIGHTS": {
      base = num(d.fare);
      // explicit buckets (keep compatibility with your prior fields)
      const explicitTax = num(d.otTax) + num(d.k3gst) + num(d.yqTax) + num(d.yrTax);
      const explicitSvc =
        num(d.bagCharges) +
        num(d.mealCharges) +
        num(d.seatCharges) +
        num(d.spServiceCharges) +
        num(d.globalPrCharges);
      // absolute vs percent on top of base
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);

      taxExtra = explicitTax + taxFromAbsOrPct;
      serviceExtra = explicitSvc + svcFromAbsOrPct;
      break;
    }

    case "HOTELS": {
      base = num(d.rooms, 1) * num(d.nights, 1) * num(d.rate);
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }

    case "VISAS": {
      base = num(d.processingFee) + num(d.embassyFee);
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }

    case "HOLIDAYS": {
      const baseOptionA = num(d.paxCount) * num(d.basePrice);
      const baseOptionB = num(d.quantity, 1) * num(d.unitPrice) + num(d.additionalFees);
      base = baseOptionA || baseOptionB;
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }

    case "MICE": {
      base = num(d.baseCost) + num(d.additionalCharges);
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }

    case "STATIONERY": {
      base = num(d.quantity, 1) * num(d.unitPrice);
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }

    case "GIFT_ITEMS": {
      base = num(d.quantity, 1) * num(d.unitPrice) + num(d.customizationCharges);
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }

    case "GOODIES": {
      base = num(d.quantity, 1) * num(d.unitPrice) + num(d.brandingCharges);
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }

    case "OTHER": {
      base = num(d.quantity, 1) * num(d.unitPrice) + num(d.additionalFees);
      const taxFromAbsOrPct = absOrPct(d.tax, d.taxPct, base);
      const svcFromAbsOrPct = absOrPct(d.serviceCharges, d.servicePct, base);
      taxExtra = taxFromAbsOrPct;
      serviceExtra = svcFromAbsOrPct;
      break;
    }
  }

  const baseR = round2(base);
  const taxR = round2(taxExtra);
  const svcR = round2(serviceExtra);
  const total = round2(baseR + taxR + svcR);

  return { base: baseR, tax: taxR, service: svcR, total };
}

/** Backward-compat helper: returns only the total. */
export function computeLineTotal(
  serviceType: ServiceType,
  details: Record<string, any>
): number {
  return computeLineParts(serviceType, details).total;
}
