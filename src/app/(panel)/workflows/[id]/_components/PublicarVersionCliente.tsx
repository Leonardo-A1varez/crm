"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  DiffPublicacion,
  compararGrafos,
  type CambioParametro,
} from "@/components/workflows/editor";
import { arbolDeConfig } from "@/lib/workflows/condiciones.schema";
import {
  publicarVersionConDescripcionAction,
  rollbackVersionAction,
} from "../../_actions/workflows.actions";
import { resumenDeCondicion } from "../_lib/campos-condicion";
import {
  ETIQUETAS_CONFIG,
  nombreDeTipo,
  presentacionDe,
  problemasConNombre,
} from "../_lib/presentacion-nodos";

import type { ProblemaPublicacion } from "@/lib/workflows/validar-workflow";
import type { Grafo } from "@/types/workflows";

const GRAFO_VACIO: Grafo = { nodos: [], aristas: [] };

/** El tope del CHECK `workflow_versiones_nota_largo`, el mismo que valida `NotaDeVersionSchema`. */
const MAX_NOTA = 500;

/** El árbol de una condición se lee como frase; un objeto que no es árbol, no se interpreta. */
function formatear(clave: string, valor: unknown): string | null | undefined {
  if (clave !== "arbol") return undefined;
  const arbol = arbolDeConfig({ arbol: valor });
  return arbol ? resumenDeCondicion(arbol) : undefined;
}

export interface PublicarVersionClienteProps {
  workflowId: string;
  nombreFlujo: string;
  nueva: {
    id: string;
    version: number;
    grafo: Grafo;
    nota: string | null;
    publicada: boolean;
    maxPasos: number | null;
  };
  actual: { version: number; grafo: Grafo; maxPasos: number | null } | null;
  corridasVivas: { total: number; porVersion: readonly { version: number; cantidad: number }[] };
  /** Lo que impide publicar esta versión, según el servidor al pedir la previa. */
  problemas: readonly ProblemaPublicacion[];
}

/**
 * "Publicar la versión N": el diff dibujado sobre el lienzo, la nota y el
 * botón. Es la única puerta para publicar desde el editor y desde la lista de
 * versiones.
 *
 * **Restaurar no es publicar.** Si la versión elegida es más vieja que la
 * publicada, el botón no la vuelve a encender: `rollbackVersionAction` la copia
 * a una versión nueva y publica ésa. La vieja queda como estaba, con su número
 * y su nota, y el historial sigue contando lo que pasó en orden.
 */
export function PublicarVersionCliente({
  workflowId,
  nombreFlujo,
  nueva,
  actual,
  corridasVivas,
  problemas,
}: PublicarVersionClienteProps) {
  const router = useRouter();
  const [nota, setNota] = useState(nueva.nota ?? "");
  const [error, setError] = useState<string | null>(null);
  // Los que devolvió la acción al publicar: el servidor vuelve a validar, y
  // manda sobre lo que se vio al cargar la previa.
  const [problemasAccion, setProblemasAccion] = useState<readonly ProblemaPublicacion[] | null>(
    null,
  );
  const [publicando, startPublicar] = useTransition();

  const restaura = actual !== null && nueva.version < actual.version;

  const diff = useMemo(() => {
    const anterior = actual?.grafo ?? GRAFO_VACIO;
    const nombres: Record<string, string> = {};
    for (const n of [...anterior.nodos, ...nueva.grafo.nodos]) nombres[n.id] = nombreDeTipo(n.tipo);
    return compararGrafos(anterior, nueva.grafo, {
      nombres,
      etiquetasConfig: ETIQUETAS_CONFIG,
      formatear,
    });
  }, [actual, nueva.grafo]);

  const cambiosDelFlujo = useMemo<CambioParametro[]>(() => {
    if (actual === null || actual.maxPasos === null || nueva.maxPasos === null) return [];
    if (actual.maxPasos === nueva.maxPasos) return [];
    return [
      {
        etiqueta: "Tope de pasos por corrida",
        antes: String(actual.maxPasos),
        despues: String(nueva.maxPasos),
      },
    ];
  }, [actual, nueva.maxPasos]);

  const problemasNombrados = useMemo(
    () => problemasConNombre(nueva.grafo, problemasAccion ?? problemas),
    [nueva.grafo, problemasAccion, problemas],
  );

  const volver = useCallback(() => router.push(`/workflows/${workflowId}`), [router, workflowId]);

  const publicar = useCallback(() => {
    setError(null);
    setProblemasAccion(null);
    startPublicar(async () => {
      const limpia = nota.trim() || undefined;
      const r = restaura
        ? await rollbackVersionAction({ workflowId, versionId: nueva.id, nota: limpia })
        : await publicarVersionConDescripcionAction({ versionId: nueva.id, nota: limpia });
      if (!r.ok) {
        setError(r.error);
        if (r.problemas) setProblemasAccion(r.problemas);
        return;
      }
      toast.success(
        restaura
          ? `v${nueva.version} restaurada como v${r.data.version}, que ya es la que corre.`
          : `v${r.data.version} publicada. Ya es la que corre.`,
      );
      router.push(`/workflows/${workflowId}`);
    });
  }, [nota, restaura, workflowId, nueva.id, nueva.version, router]);

  return (
    <DiffPublicacion
      nombreFlujo={nombreFlujo}
      versionActual={actual?.version ?? null}
      versionNueva={nueva.version}
      diff={diff}
      cambiosDelFlujo={cambiosDelFlujo}
      resolver={presentacionDe}
      nota={nota}
      onNotaChange={setNota}
      maxNota={MAX_NOTA}
      corridasVivas={corridasVivas}
      etiquetaPublicar={restaura ? `Restaurar v${nueva.version} como versión nueva` : undefined}
      publicando={publicando}
      error={error}
      problemas={problemasNombrados}
      bloqueo={nueva.publicada ? `v${nueva.version} ya es la versión publicada.` : null}
      onVolver={volver}
      onPublicar={publicar}
    />
  );
}
