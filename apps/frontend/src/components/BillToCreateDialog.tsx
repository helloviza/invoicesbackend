import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Grid
} from "@mui/material";
import { useState } from "react";
import { api } from "../api/client";

export type BillTo = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  website?: string;
  logoUrl?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (bt: BillTo) => void;
};

export default function BillToCreateDialog({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Partial<BillTo>>({
    name: "", country: "India"
  });
  const [saving, setSaving] = useState(false);

  const upd = (k: keyof BillTo) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name?.trim()) {
      alert("Name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name?.trim(),
        email: form.email || undefined,
        phone: form.phone || undefined,
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
        website: form.website || undefined,
        logoUrl: form.logoUrl || undefined,
        addressLine1: form.addressLine1 || undefined,
        addressLine2: form.addressLine2 || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        postalCode: form.postalCode || undefined,
        country: form.country || undefined,
      };
      const r = await api.post("/api/billto", body);
      const created: BillTo = r.data?.data || r.data;
      if (!created?.id) {
        throw new Error("Server did not return created Bill-To with id");
      }
      onCreated(created);
      onClose();
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.message || e.message || "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Bill To (Vendor / Client)</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12}>
            <TextField label="Name *" value={form.name || ""} onChange={upd("name")} fullWidth size="small" required />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Email" value={form.email || ""} onChange={upd("email")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Phone" value={form.phone || ""} onChange={upd("phone")} fullWidth size="small" />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField label="GSTIN" value={form.gstin || ""} onChange={upd("gstin")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="PAN" value={form.pan || ""} onChange={upd("pan")} fullWidth size="small" />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField label="Website" value={form.website || ""} onChange={upd("website")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Logo URL" value={form.logoUrl || ""} onChange={upd("logoUrl")} fullWidth size="small" />
          </Grid>

          <Grid item xs={12}>
            <TextField label="Address Line 1" value={form.addressLine1 || ""} onChange={upd("addressLine1")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Address Line 2" value={form.addressLine2 || ""} onChange={upd("addressLine2")} fullWidth size="small" />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField label="City" value={form.city || ""} onChange={upd("city")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="State" value={form.state || ""} onChange={upd("state")} fullWidth size="small" />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField label="Postal Code" value={form.postalCode || ""} onChange={upd("postalCode")} fullWidth size="small" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Country" value={form.country || ""} onChange={upd("country")} fullWidth size="small" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
