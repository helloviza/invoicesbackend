import { Link as RouterLink } from "react-router-dom";
import { Button } from "@mui/material";

// ...
<Button
  component={RouterLink}
  to="/invoices/new"
  variant="contained"
  sx={{ background: "#00477f" }}
>
  Create Invoice
</Button>
