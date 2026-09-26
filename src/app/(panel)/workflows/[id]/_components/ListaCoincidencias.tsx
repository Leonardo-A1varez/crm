"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FOCO, TRANSICION_CONTROL } from "@/lib/ui/motion";
import { coincidenciasCondicionAction } from "../../_actions/condicion.actions";

import type { Grupo } from "@/lib/ui/condiciones";

/** Cuántos se listan. Es una muestra para reconocer a quién alcanza, no un export. */
const MUESTRA = 50;

type Estado =
  | { tipo: "cargando" }
  | { tipo: "lista"; total: number; leads: { id: string; nombre: string | null }[] }
  | { tipo: "error"; mensaje: string };

/**
 * "Ver la lista": los leads que cumplen la condición ahora, los de actividad
 * más reciente primero. Cada uno lleva a su ficha. Se pide al abrir y con el
 * árbol de ese momento: si la condición cambia con el diálogo abierto, la
 * lista no se mueve debajo del dedo.
 */
export function ListaCoincidencias({
  arbol,
  abierto,
  onAbiertoCambia,
}: {
  arbol: Grupo;
  abierto: boolean;
  onAbiertoCambia: (abierto: boolean) => void;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    void coincidenciasCondicionAction({ arbol, muestra: MUESTRA }).then((r) => {
      if (!vivo) return;
      if (!r.ok) setEstado({ tipo: "error", mensaje: r.error });
      else if (r.data.tipo === "no_contable") {
        setEstado({ tipo: "error", mensaje: "Esta condición no se puede contar sobre la base." });
      } else setEstado({ tipo: "lista", total: r.data.total, leads: r.data.leads });
    });
    return () => {
      vivo = false;
    };
    // El árbol se lee al abrir, a propósito: ver el doc de arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  // Al cerrar vuelve a "cargando": la próxima vez que se abra no muestra, ni
  // por un instante, la lista de una condición anterior.
  const cambiar = (siguiente: boolean) => {
    if (!siguiente) setEstado({ tipo: "cargando" });
    onAbiertoCambia(siguiente);
  };

  return (
    <Dialog open={abierto} onOpenChange={cambiar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Leads que cumplen la condición</DialogTitle>
          <DialogDescription>
            {estado.tipo === "lista" && estado.total > estado.leads.length
              ? `Los ${estado.leads.length} con actividad más reciente, de ${estado.total.toLocaleString("es-AR")}.`
              : "Ahora mismo, con los datos de hoy."}
          </DialogDescription>
        </DialogHeader>

        {estado.tipo === "cargando" ? (
          <p role="status" className="text-ink-dim py-6 text-center text-[12px]">
            Buscando…
          </p>
        ) : estado.tipo === "error" ? (
          <p role="alert" className="text-danger py-4 text-[12px] text-pretty">
            {estado.mensaje}
          </p>
        ) : estado.leads.length === 0 ? (
          <p className="text-ink-dim py-6 text-center text-[12px]">Ningún lead la cumple hoy.</p>
        ) : (
          <ScrollArea className="max-h-[360px]">
            <ul className="divide-line-row flex flex-col divide-y">
              {estado.leads.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/leads/${l.id}`}
                    className={cn(
                      "hover:bg-surface-hover flex min-h-10 items-center rounded-md px-2 text-[12.5px]",
                      l.nombre ? "text-ink-body" : "text-ink-ghost italic",
                      TRANSICION_CONTROL,
                      FOCO,
                    )}
                  >
                    {l.nombre ?? "Lead sin nombre"}
                  </Link>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
