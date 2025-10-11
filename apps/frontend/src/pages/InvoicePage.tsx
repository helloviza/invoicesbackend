// apps/frontend/src/pages/InvoicePage.tsx
import { Box, Container, MenuItem, Stack, TextField } from "@mui/material";
import { useMemo, useState } from "react";
import InvoiceForm from "../components/InvoiceForm";
import BillToSelect from "../components/BillToSelect";
import RequireAuth from "../components/RequireAuth";
import { ServiceType as CanonicalServiceType, canonicalServiceType } from "../lib/serviceTypes";

// Legacy UI/DB values we show in the dropdown
type LegacyServiceType =
  | "FLIGHTS"
  | "HOTELS"
  | "HOLIDAYS"
  | "VISAS"
  | "MICE"
  | "STATIONERY"
  | "GIFT_ITEMS"
  | "GOODIES"
  | "OTHER";

const SERVICE_OPTIONS: Array<{
  value: LegacyServiceType;
  label: string;
  canonical: CanonicalServiceType;
}> = [
  { value: "FLIGHTS",    label: "Flights",     canonical: "Flight" },
  { value: "HOTELS",     label: "Hotels",      canonical: "Hotel" },
  { value: "HOLIDAYS",   label: "Holidays",    canonical: "Holiday" },
  { value: "VISAS",      label: "Visas",       canonical: "Visa" },
  { value: "MICE",       label: "MICE",        canonical: "MICE" },
  { value: "STATIONERY", label: "Stationary",  canonical: "Stationary" },
  { value: "GIFT_ITEMS", label: "Gift Items",  canonical: "Gift Items" },
  { value: "GOODIES",    label: "Goodies",     canonical: "Goodies" },
  { value: "OTHER",      label: "Others",      canonical: "Others" },
];

const DEFAULT_VALUE: LegacyServiceType = "FLIGHTS";

export default function InvoicePage() {
  // Keep legacy/raw select value for prop compatibility with <InvoiceForm />
  const [serviceTypeRaw, setServiceTypeRaw] = useState<LegacyServiceType>(DEFAULT_VALUE);
  const [clientId, setClientId] = useState<string>("");

  // If you need canonical anywhere else, it's available here (safe even if raw changes)
  const canonical: CanonicalServiceType = useMemo(() => {
    const hit = SERVICE_OPTIONS.find((o) => o.value === serviceTypeRaw)?.canonical;
    return (hit ?? canonicalServiceType(serviceTypeRaw)) as CanonicalServiceType;
  }, [serviceTypeRaw]);

  return (
    <RequireAuth>
      <Container maxWidth={false} disableGutters sx={{ px: { xs: 2, md: 3, xl: 4 }, py: 3 }}>
        <Box>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
            <BillToSelect value={clientId} onChange={setClientId} required />
            <TextField
              select
              label="Service Type"
              value={serviceTypeRaw}
              // IMPORTANT: TextField's select uses ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setServiceTypeRaw(e.target.value as LegacyServiceType)
              }
              size="small"
              sx={{ minWidth: 220 }}
            >
              {SERVICE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Box mt={3}>
            {/* Pass the legacy value to InvoiceForm to satisfy its prop type */}
            <InvoiceForm serviceType={serviceTypeRaw as any} clientId={clientId} />
          </Box>
        </Box>
      </Container>
    </RequireAuth>
  );
}
