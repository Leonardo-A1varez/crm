"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ORDENAR_WORKFLOWS, ORDENAR_WORKFLOWS_LABEL, PARAM } from "@/lib/ui/filtros-workflows";
import type { OrdenarWorkflows } from "@/lib/ui/filtros-workflows";

/**
 * El orden de la lista, en la URL.
 *
 * Es lo único que sobrevive de `FiltrosWorkflows`: el buscador se mudó al
 * encabezado y el `<select>` de estado lo reemplazaron los chips de
 * `ListadoFlujos`, que muestran el conteo por estado sin abrir nada. Tener las
 * dos cosas a la vez sería el mismo filtro dicho dos veces, con dos aspectos
 * distintos y la posibilidad de que se contradigan.
 *
 * Sigue siendo `<select>` y no chips porque el orden no tiene conteo que
 * mostrar y son cuatro opciones excluyentes: la lista cerrada es la forma
 * correcta y ocupa una línea.
 */
export function OrdenFlujos({ ordenar }: { ordenar: OrdenarWorkflows }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function cambiar(valor: string) {
    const params = new URLSearchParams(searchParams.toString());
    // "editado" es el default del parser: dejarlo en la URL sólo la ensucia.
    if (valor === "editado") params.delete(PARAM.ordenar);
    else params.set(PARAM.ordenar, valor);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <select
      value={ordenar}
      onChange={(e) => cambiar(e.target.value)}
      aria-label="Ordenar los flujos"
      className="border-line-control bg-surface-root text-ink-secondary h-8 shrink-0 rounded-[9px] border px-2 text-[11.5px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
    >
      {ORDENAR_WORKFLOWS.map((o) => (
        <option key={o} value={o}>
          {ORDENAR_WORKFLOWS_LABEL[o]}
        </option>
      ))}
    </select>
  );
}
