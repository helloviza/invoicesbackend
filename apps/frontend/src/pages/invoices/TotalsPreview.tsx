import React from "react";

/** Keep service type union in sync with backend */
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

export type Totals = {
  perLine: Array<{ sNo: number; base: number; taxAmt: number; svcAmt: number; lineTotal: number }>;
  subtotal: number;
  taxTotal: number;
  serviceTotal: number;
  grandTotal: number;
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0,
  );
}
const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** Figure out the *base* (pre-tax, pre-service) amount for a line based on serviceType */
function baseForLine(serviceType: ServiceType, d: Record<string, any>): number {
  switch (serviceType) {
    case "HOTELS": {
      const rooms = Number(d.rooms || 0);
      const nights = Number(d.nights || 0);
      const rate = Number(d.rate || 0);
      return r2(rooms * nights * rate);
    }
    case "FLIGHTS": {
      // Everything that is NOT tax/service (%) should contribute to base.
      const fare = Number(d.fare || 0);
      const otTax = Number(d.otTax || 0);
      const k3gst = Number(d.k3gst || 0);
      const yqTax = Number(d.yqTax || 0);
      const yrTax = Number(d.yrTax || 0);
      const bag = Number(d.bagCharges || 0);
      const meal = Number(d.mealCharges || 0);
      const seat = Number(d.seatCharges || 0);
      const sp = Number(d.spServiceCharges || 0);
      const gp = Number(d.globalPrCharges || 0);
      // Backward compatibility: sometimes people used `tax` as a flat amount; keep it OUT of base.
      return r2(
        fare + otTax + k3gst + yqTax + yrTax + bag + meal + seat + sp + gp,
      );
    }
    case "STATIONERY":
    case "GIFT_ITEMS":
    case "GOODIES":
    case "OTHER": {
      const qty = Number(d.quantity || 0);
      const up = Number(d.unitPrice || 0);
      const add =
        Number(d.additionalFees || d.customizationCharges || d.brandingCharges || 0);
      return r2(qty * up + add);
    }
    case "VISAS": {
      const proc = Number(d.processingFee || 0);
      const emb = Number(d.embassyFee || 0);
      return r2(proc + emb);
    }
    case "MICE": {
      const base = Number(d.baseCost || 0);
      const add = Number(d.additionalCharges || 0);
      return r2(base + add);
    }
    case "HOLIDAYS": {
      const pax = Number(d.paxCount || 0);
      const base = Number(d.basePrice || 0);
      const add = Number(d.additionalFees || 0);
      return r2(pax * base + add);
    }
  }
  return 0;
}

/** Given an item.details, compute tax/service *amounts* from percentage (if present) */
function amountsFromPct(
  base: number,
  d: Record<string, any>,
): { taxAmt: number; svcAmt: number } {
  // Prefer percentage fields if present; fall back to absolute numbers
  const taxPct = d.taxPct != null ? Number(d.taxPct) : null;
  const svcPct = d.servicePct != null ? Number(d.servicePct) : null;

  const taxAmt =
    taxPct != null && Number.isFinite(taxPct) ? r2((base * taxPct) / 100) : r2(Number(d.tax || 0));
  const svcAmt =
    svcPct != null && Number.isFinite(svcPct)
      ? r2((base * svcPct) / 100)
      : r2(Number(d.serviceCharges || 0));

  return { taxAmt, svcAmt };
}

export function calcTotals(
  serviceType: ServiceType,
  items: Item[],
): Totals {
  const perLine: Totals["perLine"] = [];

  for (const it of items) {
    const d = it.details || {};
    const base = baseForLine(serviceType, d);
    const { taxAmt, svcAmt } = amountsFromPct(base, d);
    const lineTotal = r2(base + taxAmt + svcAmt);
    perLine.push({ sNo: it.sNo, base, taxAmt, svcAmt, lineTotal });
  }

  const subtotal = r2(perLine.reduce((s, x) => s + x.base, 0));
  const taxTotal = r2(perLine.reduce((s, x) => s + x.taxAmt, 0));
  const serviceTotal = r2(perLine.reduce((s, x) => s + x.svcAmt, 0));
  const grandTotal = r2(subtotal + taxTotal + serviceTotal);

  return { perLine, subtotal, taxTotal, serviceTotal, grandTotal };
}

type TotalsPreviewProps = {
  serviceType: ServiceType;
  items: Item[];
  currency: string;
};

/** UI box that shows live totals; completely read-only (no layout assumptions) */
const TotalsPreview: React.FC<TotalsPreviewProps> = ({ serviceType, items, currency }) => {
  const t = calcTotals(serviceType, items);

  return (
    <div className="mt-4 rounded-xl border p-4">
      <div className="mb-2 text-sm font-semibold text-gray-700">Live Calculation</div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-2 py-2 text-left">S. No.</th>
              <th className="px-2 py-2 text-right">Base</th>
              <th className="px-2 py-2 text-right">Tax</th>
              <th className="px-2 py-2 text-right">Service</th>
              <th className="px-2 py-2 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {t.perLine.map((l) => (
              <tr key={l.sNo} className="odd:bg-white even:bg-gray-50">
                <td className="px-2 py-1">{l.sNo}</td>
                <td className="px-2 py-1 text-right">
                  {currency} {inr(l.base)}
                </td>
                <td className="px-2 py-1 text-right">
                  {currency} {inr(l.taxAmt)}
                </td>
                <td className="px-2 py-1 text-right">
                  {currency} {inr(l.svcAmt)}
                </td>
                <td className="px-2 py-1 text-right font-medium">
                  {currency} {inr(l.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t">
              <td className="px-2 py-2 font-medium text-right" colSpan={1}>
                Totals
              </td>
              <td className="px-2 py-2 text-right font-medium">
                {currency} {inr(t.subtotal)}
              </td>
              <td className="px-2 py-2 text-right font-medium">
                {currency} {inr(t.taxTotal)}
              </td>
              <td className="px-2 py-2 text-right font-medium">
                {currency} {inr(t.serviceTotal)}
              </td>
              <td className="px-2 py-2 text-right font-semibold">
                {currency} {inr(t.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Tax% and Service% (if present on a line) are applied on that line’s Base amount.
      </p>
    </div>
  );
};

export default TotalsPreview;
