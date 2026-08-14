"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowForward, Warning } from "@/components/icons";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { Button } from "@/components/ui/button";
import { canalesDelLead } from "@/lib/ui/canal";
import { contarDescartes, planDeFusion } from "@/lib/ui/plan-fusion";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { DestinoCampo } from "@/lib/ui/plan-fusion";
import type { Lead, UUID } from "@/types/entities";
import type { DuplicadoPendiente } from "@/types/leads";
import type { ActionResult } from "@/types/inbox";

/** Encabezado de una columna: quién es el lead, con sus canales. */
function CabezaLead({ lead, rotulo }: { lead: Lead; rotulo: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
        {rotulo}
      </span>
      <span className="text-ink-primary truncate text-[12.5px] font-[620]">{lead.nombre}</span>
      <ChannelIcons activos={canalesDelLead(lead)} activoActual={lead.canal_origen} />
    </div>
  );
}

/**
 * Marca de qué le pasa al valor del lead que se fusiona.
 *
 * Solo aparece donde la fusión cambia algo: en las filas iguales o vacías el
 * ruido visual haría más difícil encontrar las dos que importan.
 */
function MarcaDestino({ destino }: { destino: DestinoCampo }) {
  if (destino === "se_copia") {
    return (
      <span
        title="El lead conservado está vacío acá: este valor se copia."
        className="text-go inline-flex items-center gap-1 font-mono text-[9.5px] font-semibold"
      >
        <ArrowForward size={11} className="shrink-0" />
        se copia
      </span>
    );
  }
  if (destino === "se_suma") {
    return (
      <span
        title="Los dos valores quedan sobre el lead fusionado. No se pierde ninguno."
        className="text-go inline-flex items-center gap-1 font-mono text-[9.5px] font-semibold"
      >
        <ArrowForward size={11} className="shrink-0" />
        se suma
      </span>
    );
  }
  if (destino === "se_descarta") {
    return (
      <span
        title="Los dos tienen valor: queda el del lead conservado y este se pierde."
        className="text-danger inline-flex items-center gap-1 font-mono text-[9.5px] font-semibold"
      >
        <Warning size={11} className="shrink-0" />
        se pierde
      </span>
    );
  }
  return null;
}

/**
 * La comparación campo por campo, con lo que va a pasar en cada uno.
 *
 * Es lo que convierte "estos dos se parecen" en "esto es lo que voy a perder".
 * Los valores van en monoespaciada porque acá se leen dos teléfonos dígito a
 * dígito para decidir si son la misma persona.
 */
function TablaComparacion({ ganador, perdedor }: { ganador: Lead; perdedor: Lead }) {
  const filas = planDeFusion(ganador, perdedor);
  const descartes = contarDescartes(filas);

  return (
    <div className="flex flex-col gap-2">
      <div className="border-line-card overflow-x-auto rounded-[9px] border">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr className="border-line-card border-b">
              <th className="text-ink-faint px-2.5 py-1.5 text-left font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
                Campo
              </th>
              <th className="px-2.5 py-1.5 text-left">
                <CabezaLead lead={ganador} rotulo="Se conserva" />
              </th>
              <th className="px-2.5 py-1.5 text-left">
                <CabezaLead lead={perdedor} rotulo="Se fusiona y borra" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const cambia =
                f.destino === "se_copia" || f.destino === "se_suma" || f.destino === "se_descarta";
              return (
                <tr key={f.campo} className="border-line-card/60 border-b last:border-b-0">
                  <td className="text-ink-dim px-2.5 py-1.5 align-top text-[11px] whitespace-nowrap">
                    {f.campo}
                  </td>
                  <td className="text-ink-secondary px-2.5 py-1.5 align-top font-mono text-[11px] break-all">
                    {f.ganador || <span className="text-ink-fainter">—</span>}
                  </td>
                  <td className="px-2.5 py-1.5 align-top">
                    <span
                      className={cn(
                        "font-mono text-[11px] break-all",
                        f.destino === "se_descarta"
                          ? "text-ink-fainter line-through"
                          : "text-ink-secondary",
                      )}
                    >
                      {f.perdedor || <span className="text-ink-fainter">—</span>}
                    </span>
                    {cambia ? (
                      <div className="mt-0.5">
                        <MarcaDestino destino={f.destino} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {descartes > 0 ? (
        <p className="text-danger inline-flex items-start gap-1.5 text-[11.5px]">
          <Warning size={13} className="mt-[1px] shrink-0" />
          <span>
            {descartes === 1
              ? "1 valor del lead que se borra no se conserva."
              : `${descartes} valores del lead que se borra no se conservan.`}{" "}
            Las conversaciones, sesiones y etiquetas sí pasan al conservado.
          </span>
        </p>
      ) : (
        <p className="text-ink-dim text-[11.5px]">
          No se pierde ningún dato: todo lo del lead que se borra pasa al conservado.
        </p>
      )}
    </div>
  );
}

export function DuplicadosSection({
  leadActual,
  duplicados,
  onApprove,
  onReject,
}: {
  leadActual: Lead;
  duplicados: DuplicadoPendiente[];
  onApprove: (input: { candidateId: UUID; keepLeadId: UUID }) => Promise<ActionResult>;
  onReject: (input: { candidateId: UUID }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // keep por candidate: default = lead actual.
  const [keepPorCandidate, setKeepPorCandidate] = useState<Record<string, UUID>>({});

  if (duplicados.length === 0) return null;

  const approve = (d: DuplicadoPendiente) => {
    const keepLeadId = keepPorCandidate[d.candidateId] ?? leadActual.id;
    const nombreGanador = keepLeadId === leadActual.id ? leadActual.nombre : d.otherLead.nombre;
    startTransition(async () => {
      const r = await onApprove({ candidateId: d.candidateId, keepLeadId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Leads fusionados — historia completa bajo ${nombreGanador}.`);
      if (keepLeadId === leadActual.id) router.refresh();
      else router.push(`/leads/${keepLeadId}`);
    });
  };

  const reject = (d: DuplicadoPendiente) => {
    startTransition(async () => {
      const r = await onReject({ candidateId: d.candidateId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Par descartado — no se volverá a proponer.");
      router.refresh();
    });
  };

  return (
    <section className="border-border border-t px-4 py-4">
      <h3 className="text-sm font-medium">Posibles duplicados ({duplicados.length})</h3>
      <ul className="mt-2 flex flex-col gap-3">
        {duplicados.map((d) => {
          const keep = keepPorCandidate[d.candidateId] ?? leadActual.id;
          // La comparación depende de cuál se conserva: cambiar el radio da
          // vuelta las columnas y con eso qué campo se copia y cuál se pierde.
          const ganador = keep === leadActual.id ? leadActual : d.otherLead;
          const perdedor = keep === leadActual.id ? d.otherLead : leadActual;
          return (
            <li key={d.candidateId} className="border-line-card rounded-md border p-3">
              <p className="text-ink-faint mb-2 text-xs">
                Motivos: {d.reasons.join(", ")} · score {d.score} ·{" "}
                <RelativeTime iso={new Date(d.createdAt).toISOString()} />
              </p>
              <TablaComparacion ganador={ganador} perdedor={perdedor} />
              <fieldset className="mt-3 flex flex-col gap-1 text-sm" disabled={isPending}>
                <legend className="text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
                  Conservar
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`keep-${d.candidateId}`}
                    checked={keep === leadActual.id}
                    onChange={() =>
                      setKeepPorCandidate((m) => ({ ...m, [d.candidateId]: leadActual.id }))
                    }
                  />
                  {leadActual.nombre} (este)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`keep-${d.candidateId}`}
                    checked={keep === d.otherLead.id}
                    onChange={() =>
                      setKeepPorCandidate((m) => ({ ...m, [d.candidateId]: d.otherLead.id }))
                    }
                  />
                  {d.otherLead.nombre}
                </label>
              </fieldset>
              <div className="mt-3 flex items-center gap-2">
                <Dialog>
                  <DialogTrigger render={<Button size="sm" disabled={isPending} />}>
                    Fusionar
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Fusionar leads</DialogTitle>
                      <DialogDescription>
                        <span className="text-ink-primary font-[620]">{perdedor.nombre}</span> se
                        elimina y toda su historia —conversaciones, sesiones y etiquetas— pasa a{" "}
                        <span className="text-ink-primary font-[620]">{ganador.nombre}</span>. Hoy
                        no se puede deshacer.
                      </DialogDescription>
                    </DialogHeader>
                    {/* La misma tabla que abajo: quien confirma no tiene que
                        acordarse de lo que leyó antes de abrir el diálogo. */}
                    <div className="max-h-[46vh] overflow-y-auto">
                      <TablaComparacion ganador={ganador} perdedor={perdedor} />
                    </div>
                    <DialogFooter>
                      <Button variant="destructive" onClick={() => approve(d)} disabled={isPending}>
                        {isPending ? "Fusionando…" : "Confirmar fusión"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button variant="outline" size="sm" onClick={() => reject(d)} disabled={isPending}>
                  Descartar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
