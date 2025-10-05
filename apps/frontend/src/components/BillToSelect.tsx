// src/components/BillToSelect.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { TextField, Autocomplete, CircularProgress } from "@mui/material";
import { api } from "../api/client";
import { CONTRACT } from "../api/contract";

type Client = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
};

type Props = {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
};

/* ---- simple module-level cache so we never refetch repeatedly ---- */
let clientsCache: Client[] | null = null;
let inflight: Promise<Client[]> | null = null;

async function loadClientsOnce(): Promise<Client[]> {
  if (clientsCache) return clientsCache;
  if (!inflight) {
    inflight = api.get(CONTRACT.endpoints.clients).then((r) => {
      const list = CONTRACT.unwrapList(r) as any[];
      const normalized: Client[] = list.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
      }));
      clientsCache = normalized;
      inflight = null;
      return normalized;
    });
  }
  return inflight;
}

export default function BillToSelect({
  value,
  onChange,
  label = "Bill To",
  required,
  disabled,
}: Props) {
  const [options, setOptions] = useState<Client[]>(clientsCache || []);
  const [loading, setLoading] = useState(!clientsCache);
  const did = useRef(false); // guard against StrictMode double run

  useEffect(() => {
    if (did.current) return;
    did.current = true;

    if (!clientsCache) {
      setLoading(true);
      let alive = true;
      loadClientsOnce()
        .then((data) => {
          if (!alive) return;
          setOptions(data);
        })
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    } else {
      setOptions(clientsCache);
      setLoading(false);
    }
  }, []);

  const selected = useMemo(
    () => options.find((o) => o.id === value) || null,
    [options, value]
  );

  return (
    <Autocomplete
      value={selected}
      onChange={(_e, v) => onChange(v?.id || "")}
      options={options}
      getOptionLabel={(o) => o.name || ""}
      loading={loading}
      disabled={disabled}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label + (required ? " *" : "")}
          size="small"
          required={required}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      sx={{ minWidth: 360 }}
    />
  );
}
