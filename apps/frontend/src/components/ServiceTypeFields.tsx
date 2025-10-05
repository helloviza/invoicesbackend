// apps/frontend/src/components/ServiceTypeFields.tsx
import { TextField, Grid } from "@mui/material";
import * as React from "react";
import { canonicalServiceType, ServiceType } from "../lib/serviceTypes"; // adjust path if you use "@/lib/..."

type Item = Record<string, any>;

export interface ServiceTypeFieldsProps {
  serviceType: any;
  item: Item | null | undefined;
  onChange: (patch: Partial<Item>) => void;
}

const get = (o: any, k: string, d: any = "") => (o && o[k] != null ? o[k] : d);

function GenericFields({ item, onChange }: { item: Item; onChange: ServiceTypeFieldsProps["onChange"] }) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <TextField label="Description" fullWidth value={get(item,"description")}
          onChange={(e) => onChange({ description: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Qty" type="number" fullWidth value={get(item,"qty",1)}
          onChange={(e) => onChange({ qty: Number(e.target.value || 0) })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Unit Price" type="number" fullWidth value={get(item,"unitPrice",0)}
          onChange={(e) => onChange({ unitPrice: Number(e.target.value || 0) })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Discount" type="number" fullWidth value={get(item,"discount",0)}
          onChange={(e) => onChange({ discount: Number(e.target.value || 0) })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Currency" fullWidth value={get(item,"currency","INR")}
          onChange={(e) => onChange({ currency: e.target.value })}/>
      </Grid>
    </Grid>
  );
}

function FlightFields({ item, onChange }: { item: Item; onChange: ServiceTypeFieldsProps["onChange"] }) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={6}>
        <TextField label="Passenger Name" fullWidth value={get(item,"passengerName")}
          onChange={(e) => onChange({ passengerName: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="From" fullWidth value={get(item,"from")}
          onChange={(e) => onChange({ from: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="To" fullWidth value={get(item,"to")}
          onChange={(e) => onChange({ to: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Airline" fullWidth value={get(item,"airline")}
          onChange={(e) => onChange({ airline: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="PNR" fullWidth value={get(item,"pnr")}
          onChange={(e) => onChange({ pnr: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Base Fare" type="number" fullWidth value={get(item,"baseFare",0)}
          onChange={(e) => onChange({ baseFare: Number(e.target.value || 0) })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Tax %" type="number" fullWidth value={get(item,"taxPct","")}
          onChange={(e) => onChange({ taxPct: Number(e.target.value || 0) })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Service %" type="number" fullWidth value={get(item,"svcPct","")}
          onChange={(e) => onChange({ svcPct: Number(e.target.value || 0) })}/>
      </Grid>
    </Grid>
  );
}

function HotelFields({ item, onChange }: { item: Item; onChange: ServiceTypeFieldsProps["onChange"] }) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={6}>
        <TextField label="Guest" fullWidth value={get(item,"guest")}
          onChange={(e) => onChange({ guest: e.target.value })}/>
      </Grid>
      <Grid item xs={12} md={6}>
        <TextField label="Hotel" fullWidth value={get(item,"hotel")}
          onChange={(e) => onChange({ hotel: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Room Type" fullWidth value={get(item,"roomType")}
          onChange={(e) => onChange({ roomType: e.target.value })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Rooms" type="number" fullWidth value={get(item,"rooms",1)}
          onChange={(e) => onChange({ rooms: Number(e.target.value || 0) })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Nights" type="number" fullWidth value={get(item,"nights",1)}
          onChange={(e) => onChange({ nights: Number(e.target.value || 0) })}/>
      </Grid>
      <Grid item xs={6} md={3}>
        <TextField label="Rate" type="number" fullWidth value={get(item,"rate",0)}
          onChange={(e) => onChange({ rate: Number(e.target.value || 0) })}/>
      </Grid>
    </Grid>
  );
}

export default function ServiceTypeFields({ serviceType, item: rawItem, onChange }: ServiceTypeFieldsProps) {
  const item = rawItem ?? {};
  const type: ServiceType = canonicalServiceType(serviceType);
  switch (type) {
    case "Flight": return <FlightFields item={item} onChange={onChange} />;
    case "Hotel":  return <HotelFields item={item} onChange={onChange} />;
    default:       return <GenericFields item={item} onChange={onChange} />;
  }
}
