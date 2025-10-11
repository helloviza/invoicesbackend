import { calcTotals } from "./TotalsPreview";

type ServiceType =
  | "FLIGHTS"
  | "HOTELS"
  | "HOLIDAYS"
  | "VISAS"
  | "MICE"
  | "STATIONERY"
  | "GIFT_ITEMS"
  | "GOODIES"
  | "OTHER";

type Item = { sNo: number; details: Record<string, any> };

/**
 * Transform UI items -> payload for backend:
 * - if `taxPct` / `servicePct` exist, compute absolute amounts from line base
 * - keep all other fields intact; remove the pct fields
 */
export function transformForSubmit(serviceType: ServiceType, items: Item[]) {
  const totals = calcTotals(serviceType, items); // gives us each line's base/taxAmt/svcAmt

  return items.map((it, idx) => {
    const d = { ...(it.details || {}) };
    // Force absolute amounts derived from percentages (if any)
    if (d.taxPct != null) d.tax = totals.perLine[idx]?.taxAmt ?? 0;
    if (d.servicePct != null) d.serviceCharges = totals.perLine[idx]?.svcAmt ?? 0;
    // Remove UI-only fields
    delete d.taxPct;
    delete d.servicePct;

    // Keep original quantity/unitPrice etc. for backend
    return { sNo: it.sNo, details: d };
  });
}
