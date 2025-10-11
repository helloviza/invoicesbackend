// apps/frontend/src/lib/serviceTypes.ts
export type ServiceType =
  | "Flight"
  | "Hotel"
  | "Holiday"
  | "Visa"
  | "MICE"
  | "Stationary"
  | "Gift Items"
  | "Goodies"
  | "Others";

// Legacy values some parts of the app/DB still use
export type LegacyServiceType =
  | "FLIGHTS"
  | "HOTELS"
  | "HOLIDAYS"
  | "VISAS"
  | "MICE"
  | "STATIONERY"
  | "GIFT_ITEMS"
  | "GOODIES"
  | "OTHER";

/** Always returns a string; never throws if v is null/undefined */
export const safeTrim = (v: any): string =>
  v == null ? "" : String(v).trim();

/** Lowercases + strips non-alnum; never throws */
const normalizeKey = (x: any) =>
  safeTrim(x).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Canonicalize to friendly labels used by UI: Flight/Hotel/Holiday/... */
export function canonicalServiceType(raw: any): ServiceType {
  const s = normalizeKey(raw);
  if (["flight", "flights", "air", "airticket", "ticket"].includes(s)) return "Flight";
  if (["hotel", "hotels", "stay"].includes(s)) return "Hotel";
  if (["holiday", "holidays", "tour", "package", "packages"].includes(s)) return "Holiday";
  if (["visa", "visas"].includes(s)) return "Visa";
  if (["mice", "conference", "event", "meeting"].includes(s)) return "MICE";
  if (["stationary", "stationery"].includes(s)) return "Stationary";
  if (["gift", "gifts", "giftitems", "gift_items"].includes(s)) return "Gift Items";
  if (["goodies", "goodie"].includes(s)) return "Goodies";

  // heuristics
  if (s.startsWith("flight") || s.startsWith("air")) return "Flight";
  if (s.startsWith("hotel") || s.includes("stay")) return "Hotel";
  if (s.startsWith("holiday") || s.includes("tour") || s.includes("package")) return "Holiday";
  return "Others";
}

/** Convert canonical -> legacy (for old components/DB) */
export function toLegacy(canonical: any): LegacyServiceType {
  switch (canonicalServiceType(canonical)) {
    case "Flight":      return "FLIGHTS";
    case "Hotel":       return "HOTELS";
    case "Holiday":     return "HOLIDAYS";
    case "Visa":        return "VISAS";
    case "MICE":        return "MICE";
    case "Stationary":  return "STATIONERY";
    case "Gift Items":  return "GIFT_ITEMS";
    case "Goodies":     return "GOODIES";
    default:            return "OTHER";
  }
}

/** Convert legacy -> canonical (for new UI logic) */
export function fromLegacy(legacy: any): ServiceType {
  const s = normalizeKey(legacy);
  // map the exact legacy tokens up-front for speed/clarity
  switch (s) {
    case "flights":      return "Flight";
    case "hotels":       return "Hotel";
    case "holidays":     return "Holiday";
    case "visas":        return "Visa";
    case "mice":         return "MICE";
    case "stationery":   return "Stationary";
    case "gift_items":   return "Gift Items";
    case "goodies":      return "Goodies";
    case "other":        return "Others";
    default:
      // fallback through generic canonicalization (covers weird inputs)
      return canonicalServiceType(legacy);
  }
}
