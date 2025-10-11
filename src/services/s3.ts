/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "path";
import fs from "fs";

let hasAws = false;
let getSignedUrl: any;
let S3Client: any;
let PutObjectCommand: any;
let GetObjectCommand: any;

try {
  // Lazy imports so local dev works even without AWS deps/config
  // @ts-ignore
  ({ S3Client, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3"));
  // @ts-ignore
  ({ getSignedUrl } = await import("@aws-sdk/s3-request-presigner"));
  hasAws = Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_REGION);
} catch {
  hasAws = false;
}

/**
 * Local storage root for PDFs (when AWS isn't configured).
 * MUST match your Express static mount.
 * If unset, defaults to "<cwd>/pdfs".
 *
 * In server.ts, use:
 *   const STATIC_ROOT = process.env.PDF_OUTPUT_DIR || path.join(process.cwd(), 'pdfs');
 *   app.use('/static', express.static(STATIC_ROOT, { fallthrough:false, etag:true, maxAge:'365d' }));
 */
const localRoot = process.env.PDF_OUTPUT_DIR || path.join(process.cwd(), "pdfs");

/** Ensure a dir exists (recursive, safe for concurrent calls) */
async function ensureDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

/** Sanitize object key segments for local filenames while preserving folders */
function sanitizeKey(key: string): string {
  return key
    .split("/")
    .map((seg) => seg.replace(/[^A-Za-z0-9._\-]/g, "").trim())
    .filter(Boolean)
    .join("/");
}

/**
 * Upload buffer to storage.
 * - If AWS env is present, upload to S3 and return the same key.
 * - Otherwise write to local disk under `PDF_OUTPUT_DIR` (or ./pdfs) atomically.
 *   If the destination is locked (EBUSY/EPERM), falls back to a timestamped filename.
 * @returns the final stored key (may differ if fallback versioning was used).
 */
export async function uploadPdfToS3(buffer: Buffer, rawKey: string): Promise<string> {
  if (hasAws) {
    const client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          }
        : undefined,
    });
    const Bucket = process.env.AWS_S3_BUCKET!;
    const Key = rawKey;
    await client.send(
      new PutObjectCommand({ Bucket, Key, Body: buffer, ContentType: "application/pdf" })
    );
    return Key;
  }

  // Local mode (write to disk and serve via /static)
  const key = sanitizeKey(rawKey);
  if (!key) throw new Error("Invalid/empty key");

  const full = path.join(localRoot, key);
  const dir = path.dirname(full);
  await ensureDir(dir);

  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tmp, buffer);

  try {
    // Atomic replace (works if target isn't locked)
    await fs.promises.rename(tmp, full);
    return key;
  } catch (err: any) {
    // If viewer has file open, fall back to versioned name
    if (err && (err.code === "EBUSY" || err.code === "EPERM")) {
      const stampedKey = key.replace(/\.pdf$/i, `-${Date.now()}.pdf`);
      const stampedFull = path.join(localRoot, stampedKey);
      await ensureDir(path.dirname(stampedFull));
      await fs.promises.rename(tmp, stampedFull);
      return stampedKey;
    }
    // Cleanup tmp and rethrow others
    try { await fs.promises.unlink(tmp); } catch {}
    throw err;
  }
}

/**
 * Return a URL for the stored key.
 * - S3 => time-limited signed URL
 * - Local => URL under /static (served by Express)
 */
export async function getSignedS3Url(key: string): Promise<string> {
  if (hasAws) {
    const client = new S3Client({ region: process.env.AWS_REGION });
    const Bucket = process.env.AWS_S3_BUCKET!;
    const Key = key;
    const cmd = new GetObjectCommand({ Bucket, Key });
    // 15 minutes
    return await getSignedUrl(client, cmd, { expiresIn: 900 });
  }
  const base = process.env.BACKEND_PUBLIC_URL || "http://localhost:8080";
  // Encode but keep slashes
  return `${base}/static/${encodeURI(key).replace(/%2F/g, "/")}`;
}
