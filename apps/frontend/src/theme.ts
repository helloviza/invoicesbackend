// src/theme.ts
import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#00477f" },
    secondary: { main: "#d06549" },
    background: { default: "#f6f8fb", paper: "#ffffff" },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: `"Inter","Roboto","Helvetica","Arial",sans-serif`,
    // sizes will scale from the root html font-size (set below to 12px)
    h5: { fontWeight: 800 },
    h6: { fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { fontSize: "12px" }, // ↓ 25% smaller typography everywhere
        body: {
          background:
            "linear-gradient(180deg, #f6f8fb 0%, #ffffff 60%)",
        },
        "::-webkit-scrollbar": { width: 10, height: 10 },
        "::-webkit-scrollbar-thumb": {
          backgroundColor: "rgba(0,0,0,.2)",
          borderRadius: 8,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background:
            "linear-gradient(90deg, #00477f 0%, #006bb3 100%)",
          boxShadow: "0 6px 16px rgba(0,0,0,0.1)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: "0 6px 28px rgba(2,30,84,0.08)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 12 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 12, backgroundColor: "#fff" },
        input: { paddingTop: 10, paddingBottom: 10 },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: { borderRadius: 14 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { paddingTop: 10, paddingBottom: 10 },
      },
    },
  },
});

export default theme;
