"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { CorridaEnVivo, type PlanReanudacion } from "@/components/workflows/editor";
import { useCorridaEnVivo } from "@/hooks/use-corrida-en-vivo";
import {
  ejecutarCorridaDeNuevoAction,
  obtenerCorridaAction,
  reanudarCorridaAction,
} from "../../_actions/corridas.actions";
import { pantallaDeCorrida } from "../_lib/vista-corrida";
import { presentacionDe } from "../_lib/presentacion-nodos";

import type { VistaCorrida } from "@/server/services/workflows/corridas.service";

/**
 * La corrida en vivo, cableada: la vista inicial la trae el servidor, y cada
 * cambio que avisa Realtime la vuelve a pedir entera por la Server Action.
 *
 * Las relecturas no se pisan: si llega un aviso con una en vuelo, se anota y se
 * hace una más al terminar. Con cinco pasos seguidos eso son dos lecturas, no
 * cinco, y la última siempre ve el estado final.
 */
export function CorridaEnVivoCliente({
  workflowId,
  inicial,
  zona,
}: {
  workflowId: string;
  inicial: VistaCorrida;
  zona: string;
}) {
  const router = useRouter();
  const [vista, setVista] = useState(inicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<PlanReanudacion | null>(null);
  const runId = inicial.run.id;

  const enVuelo = useRef(false);
  const otraVez = useRef(false);

  const releer = useCallback(async () => {
    if (enVuelo.current) {
      otraVez.current = true;
      return;
    }
    enVuelo.current = true;
    try {
      do {
        otraVez.current = false;
        const r = await obtenerCorridaAction({ runId });
        if (!r.ok) setAviso(r.error);
        else if (r.data === null) setAviso("La corrida ya no existe o no la podés ver.");
        else setVista(r.data);
      } while (otraVez.current);
    } finally {
      enVuelo.current = false;
    }
  }, [runId]);

  const conexion = useCorridaEnVivo(runId, () => void releer());

  const pantalla = useMemo(() => pantallaDeCorrida(vista, zona), [vista, zona]);

  const reanudar = useCallback(() => {
    setAviso(null);
    setEnCurso("reanudar");
    void (async () => {
      const r = await reanudarCorridaAction({ runId });
      setEnCurso(null);
      if (!r.ok) {
        setAviso(r.error);
        return;
      }
      toast.success("Corrida reanudada desde el paso que falló.");
      await releer();
    })();
  }, [runId, releer]);

  const ejecutarDeNuevo = useCallback(() => {
    setAviso(null);
    setEnCurso("desde_cero");
    void (async () => {
      const r = await ejecutarCorridaDeNuevoAction({ runId });
      setEnCurso(null);
      if (!r.ok) {
        setAviso(r.error);
        return;
      }
      toast.success("Arrancó una corrida nueva desde el principio.");
      router.push(`/workflows/${workflowId}/corridas/${r.data.runId}`);
    })();
  }, [runId, workflowId, router]);

  const volver = useCallback(
    () => router.push(`/workflows/${workflowId}/historial?corrida=${runId}`),
    [router, workflowId, runId],
  );

  return (
    <CorridaEnVivo
      nombreFlujo={vista.workflow.nombre}
      grafo={vista.version.grafo}
      pasos={pantalla.pasos}
      resolver={presentacionDe}
      identificacion={pantalla.identificacion}
      enVivo={pantalla.enVivo}
      esPrueba={pantalla.esPrueba}
      topePasos={pantalla.topePasos}
      conexion={conexion}
      volverEtiqueta="Historial"
      onVolver={volver}
      reanudar={pantalla.reanudar}
      repetir={pantalla.repetir}
      onReanudar={reanudar}
      onEjecutarDeNuevo={ejecutarDeNuevo}
      enCurso={enCurso}
      aviso={
        aviso ? (
          <p
            role="alert"
            className="border-danger/30 bg-danger/10 text-danger shrink-0 border-b px-4 py-1.5 text-[11.5px] leading-snug text-pretty"
          >
            {aviso}
          </p>
        ) : null
      }
    />
  );
}
