"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NuevaRegla } from "@/components/reglas/NuevaRegla";
import { NuevoIntent } from "@/components/reglas/NuevoIntent";
import {
  crearIntentAction,
  crearReglaAction,
  setIntentActivoAction,
  setReglaActivaAction,
} from "../../intents-reglas/_actions/reglas.actions";
import { DetalleRegla } from "./DetalleRegla";
import { IntentsPendientes } from "./IntentsPendientes";
import { TablaReglas } from "./TablaReglas";
import { TarjetaConsola } from "./TarjetaConsola";
import type {
  IntentConReglas,
  ReglaConIntent,
} from "@/server/services/reglas/reglas-admin.service";
import type { RespuestaTipo } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

export function TabReglas({
  intents,
  reglas,
  esAdmin,
}: {
  intents: IntentConReglas[];
  reglas: ReglaConIntent[];
  esAdmin: boolean;
}) {
  const router = useRouter();
  const [seleccionada, setSeleccionada] = useState<UUID | null>(reglas[0]?.regla.id ?? null);

  const pendientes = intents.filter((i) => i.intent.auto_detectado && !i.intent.activo);
  const activos = intents.filter((i) => i.intent.activo).map((i) => i.intent);
  const fila = reglas.find((r) => r.regla.id === seleccionada) ?? null;

  /**
   * Aprobar el intent y darle su regla es un solo gesto para el admin, pero
   * son dos Server Actions: la regla se crea y recién después el intent se
   * activa. No es atómico y no se hace atómico acá — si la segunda falla, la
   * regla existe colgada de un intent apagado, que es un estado inerte (no
   * responde nada) y el toast lo dice. Al revés —activar primero— dejaría al
   * intent reconociéndose sin regla, que sí cambia el comportamiento.
   */
  async function crearReglaYAprobar(input: {
    intentId: UUID;
    respuestaTipo: RespuestaTipo;
    respuestaContenido: string;
    prioridad: number;
  }): Promise<ActionResult> {
    const creada = await crearReglaAction(input);
    if (!creada.ok) return creada;
    const activada = await setIntentActivoAction({ id: input.intentId, valor: true });
    router.refresh();
    if (!activada.ok) {
      return { ok: false, error: `Regla creada, pero el intent quedó apagado: ${activada.error}` };
    }
    return { ok: true };
  }

  return (
    <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
      <div className="flex min-w-0 flex-col gap-5">
        {esAdmin && pendientes.length > 0 ? (
          <IntentsPendientes
            intents={pendientes.map((p) => p.intent)}
            onCrearRegla={crearReglaYAprobar}
          />
        ) : null}

        <TarjetaConsola
          titulo="Reglas activas"
          subtitulo="se ejecutan antes del LLM — sin costo de tokens"
          acciones={
            esAdmin ? <NuevaRegla intents={activos} onCrear={crearReglaAction} /> : undefined
          }
        >
          <TablaReglas
            filas={reglas}
            seleccionada={seleccionada}
            onSeleccionar={setSeleccionada}
            onToggle={setReglaActivaAction}
            esAdmin={esAdmin}
          />
          <p className="text-ink-ghost mt-3 text-[10.5px]">
            Usos/sem y Ahorro están vacíos a propósito. El pipeline audita cada disparo en{" "}
            <code className="font-mono">rule_executions</code>, pero nadie los cuenta por ventana de
            tiempo; y el ahorro exige el costo del turno que la regla evitó, que no se registra por
            intent.
          </p>
        </TarjetaConsola>

        <TarjetaConsola
          titulo="Intents"
          subtitulo={`${intents.length} cargados · el clasificador solo puede reconocer los que estén activos`}
          acciones={esAdmin ? <NuevoIntent onCrear={crearIntentAction} /> : undefined}
        >
          <ul className="flex flex-col">
            {intents.map(({ intent, reglasActivas, reglasTotales }) => (
              <li
                key={intent.id}
                className="border-line-layout flex items-center gap-2 border-b py-2 last:border-0"
              >
                <span
                  aria-label={intent.activo ? "Activo" : "Inactivo"}
                  className={`h-[7px] w-[7px] shrink-0 rounded-full ${intent.activo ? "bg-ok" : "bg-ink-ghost"}`}
                />
                <span className="text-ink-primary min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {intent.nombre}
                </span>
                {intent.auto_detectado ? (
                  <span className="text-info bg-info/12 rounded px-1 py-px font-mono text-[9px] tracking-wide uppercase">
                    detectado por la IA
                  </span>
                ) : null}
                <span className="text-ink-faint shrink-0 font-mono text-[10px]">
                  {reglasActivas}/{reglasTotales} reglas
                </span>
              </li>
            ))}
            {intents.length === 0 ? (
              <li className="text-ink-faint text-[11.5px]">
                Sin intents cargados: hoy todo mensaje pasa por el LLM.
              </li>
            ) : null}
          </ul>
        </TarjetaConsola>
      </div>

      <div className="sticky top-[22px] min-w-0">
        <DetalleRegla fila={fila} />
      </div>
    </div>
  );
}
