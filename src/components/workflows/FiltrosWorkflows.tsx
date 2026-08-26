"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchField } from "@/components/shared/SearchField";
import {
  ESTADOS_WORKFLOW_FILTRO,
  ESTADO_WORKFLOW_FILTRO_LABEL,
  ORDENAR_WORKFLOWS,
  ORDENAR_WORKFLOWS_LABEL,
  PARAM,
} from "@/lib/ui/filtros-workflows";
import type { EstadoWorkflowFiltro, OrdenarWorkflows } from "@/lib/ui/filtros-workflows";

const selectClass =
  "border-line-control bg-surface-root text-ink-secondary shrink-0 rounded-[9px] border px-2 py-[7px] text-[11.5px] outline-none";

/**
 * Buscador + estado + orden de `/workflows`.
 *
 * El buscador es `SearchField` -- el mismo GET con `next/form` que usa Leads:
 * el término vive en la URL, sobrevive a un refresh y se comparte por link, y
 * no hay dos formas distintas de buscar entre pantallas del panel. Los dos
 * `<select>` sí navegan por `router.replace`: no tiene sentido pedir un submit
 * para elegir una opción de una lista cerrada.
 */
export function FiltrosWorkflows({
  q,
  estado,
  ordenar,
}: {
  q?: string;
  estado: EstadoWorkflowFiltro;
  ordenar: OrdenarWorkflows;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navegar(clave: string, valor: string, valorPorDefecto: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor === valorPorDefecto) params.delete(clave);
    else params.set(clave, valor);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // El GET del buscador manda sólo `q`: sin arrastrar estos dos, buscar
  // apagaría el filtro de estado y el orden que la pantalla tenga puestos.
  const conservar: Record<string, string> = {};
  if (estado !== "todos") conservar[PARAM.estado] = estado;
  if (ordenar !== "editado") conservar[PARAM.ordenar] = ordenar;

  return (
    <div className="border-line-layout bg-surface-panel flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2.5">
      <SearchField
        action="/workflows"
        defaultValue={q}
        placeholder="Buscar flujo…"
        label="Buscar flujo"
        className="min-w-[220px] flex-1"
        conservar={conservar}
      />

      <select
        value={estado}
        onChange={(e) => navegar(PARAM.estado, e.target.value, "todos")}
        aria-label="Filtrar por estado"
        className={selectClass}
      >
        {ESTADOS_WORKFLOW_FILTRO.map((e) => (
          <option key={e} value={e}>
            {ESTADO_WORKFLOW_FILTRO_LABEL[e]}
          </option>
        ))}
      </select>

      <select
        value={ordenar}
        onChange={(e) => navegar(PARAM.ordenar, e.target.value, "editado")}
        aria-label="Ordenar"
        className={selectClass}
      >
        {ORDENAR_WORKFLOWS.map((o) => (
          <option key={o} value={o}>
            {ORDENAR_WORKFLOWS_LABEL[o]}
          </option>
        ))}
      </select>
    </div>
  );
}
