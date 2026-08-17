"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CampaniaFormDialog } from "@/components/metricas/CampaniaFormDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CampaniaFormValues } from "@/components/metricas/CampaniaFormDialog";
import type { ActionResult } from "@/types/inbox";
import type { Campania } from "@/types/entities";

function fmt(d: Date): string {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function GestionCampanias({
  campanias,
  onCrear,
  onEditar,
  onBorrar,
}: {
  campanias: Campania[];
  onCrear: (values: CampaniaFormValues) => Promise<ActionResult>;
  onEditar: (input: CampaniaFormValues & { id: string }) => Promise<ActionResult>;
  onBorrar: (input: { id: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();

  const borrar = async (id: string) => {
    const result = await onBorrar({ id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Campaña borrada");
    router.refresh();
  };

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Campañas</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Campañas</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <CampaniaFormDialog
            title="Nueva campaña"
            description="Nombre y ventana de fechas. Filtra Métricas por leads.created_at dentro del rango — todavía sin atribución real."
            triggerLabel="Nueva campaña"
            onSubmit={onCrear}
          />
          {campanias.length === 0 ? (
            <p className="text-muted-foreground text-sm">Todavía no hay campañas creadas.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {campanias.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {c.nombre}{" "}
                    <span className="text-muted-foreground text-xs">
                      {fmt(c.desde)} – {fmt(c.hasta)}
                    </span>
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <CampaniaFormDialog
                      title="Editar campaña"
                      description="Cambiar nombre o ventana de fechas."
                      triggerLabel="Editar"
                      triggerVariant="outline"
                      initial={c}
                      onSubmit={(v) => onEditar({ ...v, id: c.id })}
                    />
                    <Button variant="destructive" size="sm" onClick={() => borrar(c.id)}>
                      Borrar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
