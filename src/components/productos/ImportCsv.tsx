"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ImportConfirmActionResult,
  ImportPreview,
  ImportPreviewActionResult,
} from "@/types/productos";

const COLUMNAS = "codigo_interno,nombre,descripcion,categoria,precio,stock,sku_proveedor";

// Server Actions bodySizeLimit default = 1MB: pre-check client-side porque
// un archivo mayor es rechazado por Next ANTES de llegar a la action.
const MAX_CSV_BYTES = 1_000_000;

export function ImportCsv({
  onPreview,
  onConfirm,
}: {
  onPreview: (formData: FormData) => Promise<ImportPreviewActionResult>;
  onConfirm: (formData: FormData) => Promise<ImportConfirmActionResult>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isPending, startTransition] = useTransition();

  const buildFormData = (): FormData | null => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Seleccioná un archivo CSV.");
      return null;
    }
    if (file.size > MAX_CSV_BYTES) {
      toast.error("Archivo muy grande (máx 1 MB). Partí el catálogo en varios CSV.");
      return null;
    }
    const fd = new FormData();
    fd.set("file", file);
    return fd;
  };

  const analizar = () => {
    const fd = buildFormData();
    if (!fd) return;
    startTransition(async () => {
      try {
        const r = await onPreview(fd);
        if (!r.ok) {
          toast.error(r.error);
          setPreview(null);
          return;
        }
        setPreview(r.preview);
      } catch {
        // Falla de transporte (body limit, red): sin esto = unhandled rejection sin toast.
        toast.error("No se pudo procesar el archivo. Verificá tamaño (máx 1 MB) y reintentá.");
      }
    });
  };

  const confirmar = () => {
    const fd = buildFormData();
    if (!fd) return;
    startTransition(async () => {
      try {
        const r = await onConfirm(fd);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(
          `${r.result.importados} productos importados` +
            (r.result.omitidos > 0 ? ` (${r.result.omitidos} filas omitidas)` : ""),
        );
        router.push("/productos");
      } catch {
        // Falla de transporte (body limit, red): sin esto = unhandled rejection sin toast.
        toast.error("No se pudo procesar el archivo. Verificá tamaño (máx 1 MB) y reintentá.");
      }
    });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="text-muted-foreground text-sm">
        <p>
          Columnas esperadas (header obligatorio): <code className="font-mono">{COLUMNAS}</code>
        </p>
        <p className="mt-1">
          Requeridas: codigo_interno, nombre, precio, stock. Existentes se actualizan por código;
          nuevos se crean. Filas con error se omiten.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          disabled={isPending}
          aria-label="Archivo CSV"
          onChange={() => setPreview(null)}
          className="max-w-sm"
        />
        <Button onClick={analizar} disabled={isPending} variant="outline">
          {isPending ? "Procesando…" : "Analizar"}
        </Button>
      </div>

      {preview ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <span className="font-medium">{preview.total}</span> filas ·{" "}
            <span className="font-medium text-green-700 dark:text-green-400">
              {preview.validos.length} válidas
            </span>{" "}
            ·{" "}
            <span className="font-medium text-red-700 dark:text-red-400">
              {preview.errores.length} con errores
            </span>
          </p>

          {preview.errores.length > 0 ? (
            <div className="border-border max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Fila</TableHead>
                    <TableHead>Errores</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.errores.map((e) => (
                    <TableRow key={e.fila}>
                      <TableCell className="tabular-nums">{e.fila}</TableCell>
                      <TableCell className="text-sm">{e.errores.join("; ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div>
            <Button onClick={confirmar} disabled={isPending || preview.validos.length === 0}>
              {isPending ? "Importando…" : `Confirmar import (${preview.validos.length} productos)`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
