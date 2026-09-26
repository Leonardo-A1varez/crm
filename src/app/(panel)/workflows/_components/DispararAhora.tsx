"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { PlayIcon, SearchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "@/lib/ui/motion";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/types/inbox";
import type { LeadListItem } from "@/types/leads";

type BuscarLeads = (
  raw: unknown,
) => Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>;

/**
 * «Disparar ahora»: arranca un flujo de disparador manual para un lead.
 *
 * Es un envío de verdad —el flujo corre como en producción y puede mandarle
 * mensajes al lead—, así que no dispara al primer clic: se elige el lead y el
 * botón dice para quién. Cada confirmación lleva un id nuevo
 * (`crypto.randomUUID()`), que la action usa como clave de deduplicación: un
 * reintento del mismo clic arranca una corrida, dos clics arrancan dos.
 *
 * Vive en `app/**` porque recibe Server Actions, igual que `MenuFlujo`.
 */
export function DispararAhora({
  workflowId,
  nombreFlujo,
  onBuscarLeads,
  onDisparar,
}: {
  workflowId: string;
  nombreFlujo: string;
  onBuscarLeads: BuscarLeads;
  onDisparar: (input: {
    workflowId: string;
    leadId: string;
    solicitudId: string;
  }) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<LeadListItem[]>([]);
  const [lead, setLead] = useState<LeadListItem | null>(null);
  const [resultado, setResultado] = useState<{ ok: true } | { ok: false; error: string } | null>(
    null,
  );
  const [buscando, startBuscar] = useTransition();
  const [disparando, startDisparar] = useTransition();

  useEffect(() => {
    if (!abierto || lead || query.trim().length === 0) return;
    const id = setTimeout(() => {
      startBuscar(async () => {
        const r = await onBuscarLeads({ q: query.trim() });
        setResultados(r.ok ? r.items : []);
      });
    }, 300);
    return () => clearTimeout(id);
  }, [abierto, lead, query, onBuscarLeads]);

  const alAbrirOCerrar = (siguiente: boolean) => {
    if (!siguiente) {
      setQuery("");
      setResultados([]);
      setLead(null);
      setResultado(null);
    }
    setAbierto(siguiente);
  };

  const disparar = () => {
    if (!lead) return;
    const solicitudId = crypto.randomUUID();
    startDisparar(async () => {
      setResultado(await onDisparar({ workflowId, leadId: lead.leadId, solicitudId }));
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          "border-line-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary flex h-7 items-center gap-1 rounded-[8px] border px-2.5 text-[11.5px] font-medium",
          TRANSICION_CONTROL,
          PRESION_TACTIL,
          FOCO,
        )}
      >
        <PlayIcon aria-hidden size={12} strokeWidth={2.25} />
        Disparar ahora
      </button>

      <Dialog open={abierto} onOpenChange={alAbrirOCerrar}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disparar «{nombreFlujo}»</DialogTitle>
            <DialogDescription>
              Corre la versión publicada para un lead, como si lo hubiera disparado una persona. Es
              real: los mensajes del flujo le llegan.
            </DialogDescription>
          </DialogHeader>

          {resultado?.ok ? (
            <p role="status" className="text-ok text-[12.5px] leading-relaxed text-pretty">
              Listo: la corrida para {lead?.nombre} arranca en unos segundos. La ves en el{" "}
              <Link
                href={`/workflows/${workflowId}/historial`}
                className="underline underline-offset-2"
              >
                historial
              </Link>
              .
            </p>
          ) : lead ? (
            <div className="bg-surface-panel border-line-card flex items-center justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-ink-primary truncate text-[13px] font-medium">{lead.nombre}</p>
                <p className="text-ink-faint truncate text-[11px]">
                  {lead.vehiculo || lead.telefono}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLead(null);
                  setResultado(null);
                }}
              >
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <SearchIcon
                  aria-hidden
                  className="text-ink-ghost pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                />
                <Input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar el lead por nombre o teléfono…"
                  aria-label="Buscar el lead para disparar el flujo"
                  className="pl-8"
                />
              </div>
              {buscando ? (
                <p className="text-ink-faint text-[12px]">Buscando…</p>
              ) : query.trim() && resultados.length > 0 ? (
                <ul className="border-line-card max-h-56 overflow-y-auto rounded-lg border">
                  {resultados.map((r) => (
                    <li key={r.leadId}>
                      <button
                        type="button"
                        onClick={() => setLead(r)}
                        className={cn(
                          "hover:bg-surface-hover flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left",
                          TRANSICION_CONTROL,
                          FOCO,
                        )}
                      >
                        <span className="text-ink-primary text-[12.5px] font-medium">
                          {r.nombre}
                        </span>
                        <span className="text-ink-faint text-[11px]">
                          {r.vehiculo || r.telefono}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() ? (
                <p className="text-ink-faint text-[12px]">Ningún lead coincide.</p>
              ) : null}
            </div>
          )}

          {resultado && !resultado.ok ? (
            <p role="alert" className="text-danger text-[12px] leading-relaxed">
              {resultado.error}
            </p>
          ) : null}

          <DialogFooter>
            {resultado?.ok ? (
              <>
                <Button variant="outline" onClick={() => setResultado(null)}>
                  Disparar otra vez
                </Button>
                <Button onClick={() => alAbrirOCerrar(false)}>Cerrar</Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => alAbrirOCerrar(false)}
                  disabled={disparando}
                >
                  Cancelar
                </Button>
                <Button onClick={disparar} disabled={!lead || disparando}>
                  {disparando
                    ? "Disparando…"
                    : lead
                      ? `Disparar para ${lead.nombre}`
                      : "Elegí un lead"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
