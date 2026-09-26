"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";

type ImportarFn = (
  raw: unknown,
) => Promise<
  { ok: true; workflowId: string; problemasParaPublicar: number } | { ok: false; error: string }
>;

/**
 * «Importar»: crea un flujo a partir de un JSON, pegado o de un archivo.
 *
 * El formato es `{ nombre, descripcion?, grafo, maxPasos? }`. Entra como
 * borrador —apagado y sin publicar— y se abre en el editor, que es donde se
 * ven los problemas que falten resolver antes de publicar.
 */
export function ImportarFlujo({ onImportar }: { onImportar: ImportarFn }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importando, startImportar] = useTransition();
  const archivoRef = useRef<HTMLInputElement>(null);

  const alAbrirOCerrar = (siguiente: boolean) => {
    if (!siguiente) {
      setTexto("");
      setError(null);
    }
    setAbierto(siguiente);
  };

  const alElegirArchivo = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setError(null);
    setTexto(await archivo.text());
  };

  const importar = () => {
    setError(null);
    startImportar(async () => {
      const r = await onImportar({ texto });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      alAbrirOCerrar(false);
      router.push(`/workflows/${r.workflowId}`);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          "border-line-control bg-surface-panel text-ink-secondary hover:border-line-input hover:text-ink-primary flex h-8 shrink-0 items-center rounded-[9px] border px-3 text-[12.5px] font-medium",
          TRANSICION_CONTROL,
          PRESION_TACTIL,
          FOCO,
        )}
      >
        Importar
      </button>

      <Dialog open={abierto} onOpenChange={alAbrirOCerrar}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar un flujo</DialogTitle>
            <DialogDescription>
              Pegá el JSON del flujo o elegí el archivo. Entra como borrador: apagado y sin
              publicar, para que lo revises en el editor antes de que corra.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              aria-label="JSON del flujo"
              placeholder='{ "nombre": "…", "grafo": { "nodos": […], "aristas": […] } }'
              rows={8}
              className="font-mono text-[11.5px]"
            />
            <div className="flex items-center gap-2">
              <input
                ref={archivoRef}
                type="file"
                accept="application/json,.json"
                onChange={alElegirArchivo}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
              />
              <Button variant="outline" size="sm" onClick={() => archivoRef.current?.click()}>
                Elegir archivo…
              </Button>
              <span className="text-ink-faint text-[11px]">
                Se revisa la forma y que el flujo tenga sentido antes de crearlo.
              </span>
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="text-danger text-[12px] leading-relaxed text-pretty break-words"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => alAbrirOCerrar(false)} disabled={importando}>
              Cancelar
            </Button>
            <Button onClick={importar} disabled={!texto.trim() || importando}>
              {importando ? "Importando…" : "Importar como borrador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
