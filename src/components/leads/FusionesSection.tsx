"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { canalesDelLead } from "@/lib/ui/canal";
import type { Lead } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";
import type { FusionRegistrada } from "@/types/leads";

/**
 * Las fusiones que absorbieron otros leads dentro de este, y cómo deshacerlas.
 *
 * El lead absorbido ya no existe: lo que se muestra se reconstruye del registro
 * de la fusión, que es lo único que quedó de él. Por eso la ficha es de solo
 * lectura y no enlaza a ningún lado.
 *
 * Una fusión anterior al registro reversible no se puede deshacer, y el botón
 * no se limita a estar apagado: dice por qué. Un control deshabilitado sin
 * explicación se lee como un error de la aplicación.
 */
export function FusionesSection({
  fusiones,
  onRevert,
}: {
  fusiones: FusionRegistrada[];
  onRevert: (input: { accionId: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (fusiones.length === 0) return null;

  const revertir = (f: FusionRegistrada) => {
    startTransition(async () => {
      const r = await onRevert({ accionId: f.accionId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${f.perdedor.nombre} volvió a ser un lead aparte.`);
      router.refresh();
    });
  };

  return (
    <section className="border-line-layout border-t px-5 py-4">
      <h3 className="text-ink-primary text-sm font-[620]">Leads absorbidos ({fusiones.length})</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {fusiones.map((f) => (
          <li key={f.accionId} className="border-line-card rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <FichaAbsorbida lead={f.perdedor} />
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-ink-faint text-[11px]">
                  fusionado <RelativeTime iso={f.fecha.toISOString()} />
                </span>
                {f.revertida ? (
                  <span className="text-ink-faint text-[11px]">Ya se deshizo.</span>
                ) : f.reversible ? (
                  <Dialog>
                    <DialogTrigger
                      render={<Button variant="outline" size="sm" disabled={isPending} />}
                    >
                      Deshacer fusión
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Deshacer la fusión</DialogTitle>
                        <DialogDescription>
                          <span className="text-ink-primary font-[620]">{f.perdedor.nombre}</span>{" "}
                          vuelve a ser un lead aparte, con las conversaciones y sesiones que trajo.
                          Lo que se haya editado después de fusionar no se toca.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button onClick={() => revertir(f)} disabled={isPending}>
                          {isPending ? "Deshaciendo…" : "Confirmar"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                ) : (
                  <span className="text-ink-faint max-w-[230px] text-right text-[11px]">
                    No se puede deshacer: es anterior al registro que guarda qué se movió.
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** El lead borrado, reconstruido del registro. Solo lectura: ya no existe. */
function FichaAbsorbida({ lead }: { lead: Lead }) {
  const vehiculo = [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio || ""]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-ink-primary text-[12.5px] font-[620]">{lead.nombre}</span>
      {/* Crudo, como en la comparación: acá se leen teléfonos dígito a dígito. */}
      <span className="text-ink-secondary font-mono text-[11px]">{lead.telefono}</span>
      <ChannelIcons activos={canalesDelLead(lead)} activoActual={lead.canal_origen} />
      {vehiculo || lead.email ? (
        <span className="text-ink-dim text-[11px]">
          {[vehiculo, lead.email].filter(Boolean).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}
