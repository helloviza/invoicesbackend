// apps/frontend/src/pages/invoices/ProformaInvoicePage.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Checkbox,
  Stack,
  Typography,
} from "@mui/material";

const BACKEND = (import.meta as any).env?.VITE_BACKEND_ORIGIN || "http://localhost:8080";
const isObjectId = (s: string) => /^[0-9a-f]{24}$/i.test(s);

type ApiJson = { ok?: boolean; url?: string; pdfKey?: string } & Record<string, any>;

export default function ProformaInvoicePage() {
  const { id } = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  const location = useLocation();

  const idOrNo = useMemo(() => (id ? id : (search.get("no") || "").trim()), [id, search]);

  // JSON API that (re)generates the Proforma and returns {url,pdfKey} OR streams a PDF
  const apiEndpoint = useMemo(() => {
    if (!idOrNo) return "";
    const base = isObjectId(idOrNo)
      ? `/api/invoices/${encodeURIComponent(idOrNo)}/pdf`
      : `/api/invoices/by-no/${encodeURIComponent(idOrNo)}/pdf`;
    return `${BACKEND}${base}?doc=performa&force=1`;
  }, [idOrNo]);

  // Final display URL (prefer blob URL if we can fetch bytes)
  const [viewerUrl, setViewerUrl] = useState<string>("");
  const [downloadUrl, setDownloadUrl] = useState<string>(""); // direct link for "Open / Download"
  const [rawJson, setRawJson] = useState<ApiJson | null>(null);
  const [pretty, setPretty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Revoke old object URLs
  useEffect(() => {
    return () => {
      if (viewerUrl.startsWith("blob:")) {
        URL.revokeObjectURL(viewerUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    console.debug("[ProformaInvoicePage] route", {
      path: location.pathname,
      id,
      no: search.get("no"),
      apiEndpoint,
      backend: BACKEND,
    });
  }, [location.pathname, id, search, apiEndpoint]);

  useEffect(() => {
    let aborted = false;

    async function resolvePdf() {
      if (!apiEndpoint) {
        setErr("Missing invoice id or number.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);
      setRawJson(null);
      setViewerUrl("");
      setDownloadUrl("");

      try {
        // Step 1: Call the JSON API endpoint
        const res = await fetch(apiEndpoint, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json,application/pdf" },
        });

        const ct = (res.headers.get("content-type") || "").toLowerCase();

        // If server streams a PDF directly
        if (ct.includes("application/pdf")) {
          const blob = await res.blob();
          if (aborted) return;
          const blobUrl = URL.createObjectURL(blob);
          setViewerUrl(blobUrl);
          setDownloadUrl(blobUrl); // we can also use blob for download
          setRawJson(null);
          setLoading(false);
          return;
        }

        // Otherwise expect JSON with {url} or {pdfKey}
        let json: ApiJson | null = null;
        try {
          json = await res.json();
        } catch {
          const text = await res.text();
          if (!aborted) {
            setErr(
              `Expected JSON or PDF but got: ${ct || "unknown"} (status ${res.status}).`
            );
            setRawJson({ ok: false, note: "Non-JSON body", sample: text?.slice(0, 400) });
            setLoading(false);
          }
          return;
        }

        if (aborted) return;
        setRawJson(json || {});
        let directUrl =
          json?.url ||
          (json?.pdfKey
            ? /^https?:\/\//i.test(String(json.pdfKey))
              ? String(json.pdfKey)
              : `${BACKEND}/${String(json.pdfKey).startsWith("static/") ? String(json.pdfKey) : `static/${String(json.pdfKey)}`}`
            : "");

        if (!directUrl) {
          setErr("API did not return a usable PDF URL.");
          setLoading(false);
          return;
        }

        setDownloadUrl(directUrl);

        // Step 2: Try to fetch the *final* PDF URL as bytes to make a blob
        // This avoids X-Frame-Options / CSP frame-ancestors on other origins.
        try {
          const r2 = await fetch(directUrl, {
            method: "GET",
            credentials: "include",
            // If the static host doesn't send CORS, this becomes an opaque response and blob() will throw.
            // That's fine; we catch and fall back to opening in a new tab.
          });

          const ct2 = (r2.headers.get("content-type") || "").toLowerCase();
          if (!r2.ok || !ct2.includes("application/pdf")) {
            throw new Error(`Static PDF not OK (${r2.status}) or not a PDF (${ct2}).`);
          }

          const blob2 = await r2.blob();
          if (aborted) return;

          const blobUrl2 = URL.createObjectURL(blob2);
          setViewerUrl(blobUrl2); // iframe this blob — not the cross-origin URL
        } catch (e) {
          // Most likely CORS prevented reading the bytes; keep viewerUrl empty → show fallback message
          console.warn("[Proforma] Could not fetch static PDF as blob; falling back to open-in-new-tab.", e);
          setViewerUrl(""); // keep empty to show fallback UI
        } finally {
          if (!aborted) setLoading(false);
        }
      } catch (e: any) {
        if (!aborted) {
          setErr(e?.message || "Failed to fetch proforma PDF.");
          setLoading(false);
        }
      }
    }

    resolvePdf();
    return () => {
      aborted = true;
    };
  }, [apiEndpoint]);

  const backHref = isObjectId(idOrNo) ? `/invoices/${encodeURIComponent(idOrNo)}` : "/history";

  return (
    <Box p={3}>
      {/* Debug banner */}
      <Box
        sx={{
          mb: 1,
          p: 1,
          fontSize: 12,
          color: "#036",
          bgcolor: "rgba(0,71,127,0.06)",
          borderRadius: 1,
        }}
      >
        Proforma route active — param: {id ?? "—"} · query no: {search.get("no") ?? "—"}
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        gap={2}
        mb={2}
      >
        <Typography variant="h5" fontWeight={700}>
          Proforma Invoice — {idOrNo || "—"}
        </Typography>

        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button component={RouterLink} to={backHref} variant="outlined">
            Back
          </Button>

          <Button
            component="a"
            href={downloadUrl || undefined}
            target="_blank"
            rel="noreferrer"
            variant="outlined"
            disabled={!downloadUrl}
          >
            Open in new tab
          </Button>

          <Button
            component="a"
            href={downloadUrl || undefined}
            target="_blank"
            rel="noreferrer"
            variant="contained"
            disabled={!downloadUrl}
          >
            Download PDF
          </Button>
        </Stack>
      </Stack>

      <Card>
        <CardContent>
          {loading ? (
            <Stack alignItems="center" justifyContent="center" height={420}>
              <CircularProgress />
              <Box mt={2}>
                <Typography variant="body2">Preparing proforma…</Typography>
              </Box>
            </Stack>
          ) : viewerUrl ? (
            // ✅ Blob-backed preview (immune to X-Frame-Options/CSP on other origins)
            <Box
              sx={{
                border: "1px solid #eee",
                borderRadius: 1,
                overflow: "hidden",
                height: "80vh",
              }}
            >
              <iframe title="Proforma PDF" src={viewerUrl} style={{ width: "100%", height: "100%", border: 0 }} />
            </Box>
          ) : (
            // Fallback: Explain why we can't preview and still allow opening
            <Stack alignItems="center" justifyContent="center" minHeight={280} gap={1.5}>
              {err ? (
                <Typography color="error" align="center">{err}</Typography>
              ) : (
                <Typography align="center" sx={{ color: "text.secondary" }}>
                  Cannot show inline preview. This usually happens when the static host blocks
                  iframes (X-Frame-Options / frame-ancestors) or CORS prevents fetching bytes.
                </Typography>
              )}

              {rawJson ? (
                <Box
                  component="pre"
                  sx={{
                    mt: 1,
                    p: 2,
                    width: "100%",
                    maxWidth: "100%",
                    overflow: "auto",
                    bgcolor: "#fafafa",
                    border: "1px solid #eee",
                    borderRadius: 1,
                  }}
                >
                  <FormControlLabel
                    control={<Checkbox checked={pretty} onChange={(e) => setPretty(e.target.checked)} />}
                    label="Pretty-print"
                  />
                  {pretty ? JSON.stringify(rawJson, null, 2) : JSON.stringify(rawJson)}
                </Box>
              ) : null}

              <Stack direction="row" gap={1}>
                <Button
                  component="a"
                  href={downloadUrl || undefined}
                  target="_blank"
                  rel="noreferrer"
                  variant="outlined"
                  disabled={!downloadUrl}
                >
                  Open in new tab
                </Button>
                <Button
                  component="a"
                  href={downloadUrl || undefined}
                  target="_blank"
                  rel="noreferrer"
                  variant="contained"
                  disabled={!downloadUrl}
                >
                  Download PDF
                </Button>
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
