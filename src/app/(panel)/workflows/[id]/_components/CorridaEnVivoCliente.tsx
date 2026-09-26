"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CorridaEnVivo, type PlanReanudacion } from "@/components/workflows/editor";
import { useCorridaEnVivo } from "@/hooks/use-corrida-en-vivo";
import { PRESION_TACTIL, TRANSICION_CONTROL } from "@/lib/ui/motion";
import {
  cancelarCorridaAction,
  ejecutarCorridaDeNuevoAction,
  obtenerCorridaAction,
  reanudarCorridaAction,
} from "../../_actions/corridas.actions";
import { pantallaDeCorrida } from "../_lib/vista-corrida";
import { presentacionDe } from "../_lib/presentacion-nodos";
import { DetalleBajoLienzo } from "./DetalleBajoLienzo";

import type { CatalogosDeCondicion } from "../_lib/campos-condicion";
import type { VistaCorrida } from "@/server/services/workflows/corridas.service";
import type { Nodo } from "@/types/workflows";

/** La ventana de `corridasPorNodo` (`VENTANA_POR_NODO_MS` del servicio de corridas). */
const DIAS_POR_NODO = 30;

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
  catalogos,
}: {
  workflowId: string;
  inicial: VistaCorrida;
  zona: string;
  /** Los nombres de intents y etiquetas que la condición dibuja. Ver `resumenDe`. */
  catalogos?: CatalogosDeCondicion;
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
  const resolver = useCallback((n: Nodo) => presentacionDe(n, catalogos), [catalogos]);

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

  // "Cancelar corrida" confirma antes: no se deshace, y lo que ya salió no
  // vuelve. La acción pide admin; a quien no lo es se lo dice el aviso.
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const cancelar = useCallback(() => {
    setAviso(null);
    setCancelando(true);
    void (async () => {
      const r = await cancelarCorridaAction({ runId });
      setCancelando(false);
      setConfirmarCancelar(false);
      if (!r.ok) {
        setAviso(r.error);
        return;
      }
      toast.success("Corrida cancelada.");
      await releer();
    })();
  }, [runId, releer]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <CorridaEnVivo
          nombreFlujo={vista.workflow.nombre}
          grafo={vista.version.grafo}
          pasos={pantalla.pasos}
          resolver={resolver}
          identificacion={pantalla.identificacion}
          enVivo={pantalla.enVivo}
          esPrueba={pantalla.esPrueba}
          topePasos={pantalla.topePasos}
          conexion={conexion}
          estado={pantalla.estado}
          volverEtiqueta="Historial"
          onVolver={volver}
          onCancelar={pantalla.enVivo ? () => setConfirmarCancelar(true) : undefined}
          reanudar={pantalla.reanudar}
          repetir={pantalla.repetir}
          onReanudar={reanudar}
          onEjecutarDeNuevo={ejecutarDeNuevo}
          enCurso={enCurso}
          trafico={{
            corridas: pantalla.porNodo.corridas,
            vivas: pantalla.porNodo.vivas,
            version: vista.version.numero,
            dias: DIAS_POR_NODO,
            nodos: pantalla.porNodo.nodos,
          }}
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
      </div>
      <DetalleBajoLienzo mensajes={pantalla.mensajes} />
      <Dialog
        open={confirmarCancelar}
        onOpenChange={(abierto) => !cancelando && setConfirmarCancelar(abierto)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar esta corrida</DialogTitle>
            <DialogDescription>
              {pantalla.esPrueba
                ? "La corrida de prueba se corta acá. No se puede reanudar."
                : "El flujo deja de avanzar para este lead: no se ejecuta ningún bloque más, y si estaba esperando, no sigue cuando se cumpla la espera. Lo que ya salió queda enviado. No se puede reanudar."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cancelando}
              onClick={() => setConfirmarCancelar(false)}
              className={`${TRANSICION_CONTROL} ${PRESION_TACTIL}`}
            >
              Seguir corriendo
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={cancelando}
              onClick={cancelar}
              className={`${TRANSICION_CONTROL} ${PRESION_TACTIL}`}
            >
              {cancelando ? "Cancelando…" : "Cancelar corrida"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
