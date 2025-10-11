import React from "react";
import { Alert, Box } from "@mui/material";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: String(err?.message || err) };
  }
  componentDidCatch(err: any, info: any) {
    console.error("UI crashed:", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">Something went wrong: {this.state.message}</Alert>
        </Box>
      );
    }
    return this.props.children as any;
  }
}
