"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { Button } from "@/components/ui/button";
import { canalesDelLead } from "@/lib/ui/canal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Lead, UUID } from "@/types/entities";
import type { DuplicadoPendiente } from "@/types/leads";
import type { ActionResult } from "@/types/inbox";

type ResumenLeadFields = Pick<
  Lead,
  | "nombre"
  | "telefono"
  | "canal_origen"
  | "meta_user_ids"
  | "vehiculo_marca"
  | "vehiculo_modelo"
  | "vehiculo_anio"
>;

function ResumenLead({ lead, titulo }: { lead: ResumenLeadFields; titulo: string }) {
  const canales = canalesDelLead(lead);
  const vehiculo = [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio || ""]
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-muted-foreground text-xs">{titulo}</span>
      <span className="font-medium">{lead.nombre}</span>
      {/* Crudo a propósito, contra el resto de la app: acá se comparan dos
          números dígito a dígito para decidir si son la misma persona, y el
          `+593 ` que agrega `formatearTelefono` desalinea esa lectura. */}
      <span className="text-muted-foreground font-mono text-xs">{lead.telefono}</span>
      <ChannelIcons activos={canales} activoActual={lead.canal_origen} />
      <span className="text-muted-foreground text-xs">{vehiculo || "—"}</span>
    </div>
  );
}

export function DuplicadosSection({
  leadActual,
  duplicados,
  onApprove,
  onReject,
}: {
  leadActual: Pick<Lead, "id"> & ResumenLeadFields;
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
          return (
            <li key={d.candidateId} className="border-border rounded-md border p-3">
              <div className="grid grid-cols-2 gap-3">
                <ResumenLead lead={leadActual} titulo="Este lead" />
                <ResumenLead lead={d.otherLead} titulo="Posible duplicado" />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Motivos: {d.reasons.join(", ")} · score {d.score} ·{" "}
                <RelativeTime iso={new Date(d.createdAt).toISOString()} />
              </p>
              <fieldset className="mt-2 flex flex-col gap-1 text-sm" disabled={isPending}>
                <legend className="text-muted-foreground text-xs">Conservar</legend>
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
                        Irreversible: el lead NO conservado se elimina y toda su historia
                        (conversaciones, sesiones, tags) pasa al conservado.
                      </DialogDescription>
                    </DialogHeader>
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
