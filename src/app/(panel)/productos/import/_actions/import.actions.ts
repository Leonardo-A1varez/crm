"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "../../_actions/action-error";
import type { ImportConfirmActionResult, ImportPreviewActionResult } from "@/types/productos";

// Server Actions body limit default 1MB — cap alineado. Catálogos más grandes
// se parten en varios archivos (pilot ~5K SKUs ≈ 400KB, entra holgado).
const MAX_CSV_BYTES = 1_000_000;

const ImportCsvFormSchema = z.object({ file: z.instanceof(File) });

async function readCsvFile(formData: FormData): Promise<string | { error: string }> {
  const parsed = ImportCsvFormSchema.safeParse({ file: formData.get("file") });
  if (!parsed.success || parsed.data.file.size === 0) {
    return { error: "Seleccioná un archivo CSV." };
  }
  if (parsed.data.file.size > MAX_CSV_BYTES) {
    return { error: "Archivo muy grande (máx 1 MB). Partí el catálogo en varios CSV." };
  }
  return parsed.data.file.text();
}

export async function previewImportCsvAction(
  formData: FormData,
): Promise<ImportPreviewActionResult> {
  const csv = await readCsvFile(formData);
  if (typeof csv !== "string") return { ok: false, error: csv.error };

  try {
    const svc = await getCatalogServiceForRequest();
    return { ok: true, preview: svc.previewImport(csv) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return toActionError(e, "preview-import-csv");
  }
}

export async function confirmImportCsvAction(
  formData: FormData,
): Promise<ImportConfirmActionResult> {
  const csv = await readCsvFile(formData);
  if (typeof csv !== "string") return { ok: false, error: csv.error };

  try {
    const svc = await getCatalogServiceForRequest();
    const result = await svc.confirmImport(csv);
    revalidatePath("/productos");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return toActionError(e, "confirm-import-csv");
  }
}
