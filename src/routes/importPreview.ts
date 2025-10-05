// apps/backend/src/routes/importPreview.ts
import { Router, type Request, type Response } from "express";
import multer from "multer";
import * as XLSX from "xlsx";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/** Return a real ArrayBuffer (avoids SharedArrayBuffer union typing). */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // Creating a new Uint8Array copy guarantees a normal ArrayBuffer backing store
  return u8.length ? new Uint8Array(u8).buffer : new ArrayBuffer(0);
}

router.post(
  "/import/preview",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file || !file.buffer) {
        return res
          .status(400)
          .json({ ok: false, message: "No file uploaded (field name must be 'file')." });
      }

      // Normalize to Uint8Array -> ArrayBuffer
      // (Buffer is a Uint8Array subclass; this makes a clean copy)
      const u8 = new Uint8Array(file.buffer);
      const ab = toArrayBuffer(u8);

      const ext = (file.originalname?.split(".").pop() || "").toLowerCase();
      const isCSV = file.mimetype?.includes("csv") || ext === "csv";

      // Read workbook (XLSX for binaries, 'string' path for CSV)
      let wb: XLSX.WorkBook;
      if (isCSV) {
        const text = new TextDecoder("utf-8").decode(new Uint8Array(ab));
        wb = XLSX.read(text, { type: "string" });
      } else {
        wb = XLSX.read(ab, { type: "array" });
      }

      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        return res.status(400).json({ ok: false, message: "No sheets found in the uploaded file." });
      }

      const ws = wb.Sheets[sheetName];
      // defval keeps empty cells as "" so columns stay aligned
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, {
        defval: "",
        raw: false,
      });

      // Build header set from the first few rows
      const sample = rows.slice(0, 50);
      const headers = Array.from(
        new Set(sample.flatMap((r: Record<string, any>) => Object.keys(r ?? {})))
      );

      return res.json({
        ok: true,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        sheet: sheetName,
        headers,
        preview: sample,
        totalRows: rows.length,
      });
    } catch (err: any) {
      return res
        .status(500)
        .json({ ok: false, message: err?.message || "Failed to parse file" });
    }
  }
);

export default router;
