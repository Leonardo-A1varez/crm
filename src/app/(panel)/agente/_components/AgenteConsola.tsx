"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { guardarConfigAction } from "../_actions/guardar-config.action";
import { previsualizarAction } from "../_actions/previsualizar.action";
import { rollbackConfigAction } from "../_actions/rollback-config.action";
import { HistorialVersiones } from "./HistorialVersiones";
import { PanelPreview } from "./PanelPreview";
import { TabComportamiento } from "./TabComportamiento";
import { TabEscalado } from "./TabEscalado";
import { TabLimites } from "./TabLimites";
import { TabReglas } from "./TabReglas";
import { TabsConsola } from "./TabsConsola";
import type { TabAgente } from "./tabs";
import type {
  IntentConReglas,
  ReglaConIntent,
} from "@/server/services/reglas/reglas-admin.service";
import type { AgenteConfig, AgenteConfigValores } from "@/types/agente";

interface PreviewResultado {
  respuesta: string;
  respuestaOriginal: string | null;
}

/** Los campos de dominio, sin metadatos de versión. `useState` no debe arrastrar id/version/activa. */
function extraerValores(c: AgenteConfig): AgenteConfigValores {
  return {
    modelo: c.modelo,
    instrucciones: c.instrucciones,
    tono: c.tono,
    largo: c.largo,
    emojis: c.emojis,
    descuento_max_pct: c.descuento_max_pct,
    max_pasos_tool: c.max_pasos_tool,
    ventana_contexto_mensajes: c.ventana_contexto_mensajes,
    umbral_resumen_turnos: c.umbral_resumen_turnos,
    timeout_tool_ms: c.timeout_tool_ms,
    tope_gasto_diario_usd: c.tope_gasto_diario_usd,
    politica_tope: c.politica_tope,
    escalar_umbral_intents: c.escalar_umbral_intents,
    // Copia: el estado del formulario no puede compartir el array con el
    // baseline `guardado`, o "Descartar" no tendría a qué volver.
    escalar_palabras: [...c.escalar_palabras],
    escalar_cotizacion_desde: c.escalar_cotizacion_desde,
    horario: c.horario,
    horario_timezone: c.horario_timezone,
    plantilla_fuera_horario: c.plantilla_fuera_horario,
  };
}

export function AgenteConsola({
  configActiva,
  historial,
  sesiones,
  esAdmin,
  intents,
  reglas,
  tabInicial,
}: {
  configActiva: AgenteConfig;
  historial: AgenteConfig[];
  sesiones: { id: string; etiqueta: string }[];
  esAdmin: boolean;
  intents: IntentConReglas[];
  reglas: ReglaConIntent[];
  tabInicial: TabAgente;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabAgente>(tabInicial);
  const [activaId, setActivaId] = useState(configActiva.id);
  const [valores, setValores] = useState<AgenteConfigValores>(() => extraerValores(configActiva));
  const [guardado, setGuardado] = useState<AgenteConfigValores>(() => extraerValores(configActiva));
  const [isPending, startTransition] = useTransition();
  const [previewResultado, setPreviewResultado] = useState<PreviewResultado | null>(null);
  const [previewCargando, setPreviewCargando] = useState(false);

  // La config activa cambió por debajo (guardar o restaurar + router.refresh()):
  // resincroniza el formulario con el nuevo baseline. Ajuste de estado durante
  // el render (guía oficial de React), no un useEffect, para no perder un frame
  // mostrando el formulario viejo.
  if (configActiva.id !== activaId) {
    setActivaId(configActiva.id);
    setValores(extraerValores(configActiva));
    setGuardado(extraerValores(configActiva));
    setPreviewResultado(null);
  }

  const sucio = JSON.stringify(valores) !== JSON.stringify(guardado);

  function handleChange(patch: Partial<AgenteConfigValores>) {
    if (!esAdmin) return; // Defensa en profundidad: los inputs ya llegan disabled.
    setValores((v) => ({ ...v, ...patch }));
  }

  function handleGuardar() {
    startTransition(async () => {
      const r = await guardarConfigAction(valores);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Guardado. Se aplica en menos de un minuto.");
      router.refresh();
    });
  }

  async function handleRestaurar(configId: string) {
    const r = await rollbackConfigAction({ configId });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Versión restaurada como una nueva versión activa.");
    router.refresh();
  }

  async function handlePrevisualizar(leadSessionId: string) {
    setPreviewCargando(true);
    const r = await previsualizarAction({ config: valores, leadSessionId });
    setPreviewCargando(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setPreviewResultado({ respuesta: r.respuesta, respuestaOriginal: r.respuestaOriginal });
  }

  return (
    <div className="flex flex-col">
      <TabsConsola activa={tab} onChange={setTab} />

      <div className="pt-5">
        {tab === "reglas" ? (
          <TabReglas intents={intents} reglas={reglas} esAdmin={esAdmin} />
        ) : null}

        {tab === "escalado" ? (
          <TabEscalado valores={valores} onChange={handleChange} disabled={!esAdmin} />
        ) : null}

        {tab === "comporta" ? (
          <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
            <div className="min-w-0">
              <TabComportamiento valores={valores} onChange={handleChange} disabled={!esAdmin} />
            </div>
            <div className="sticky top-[22px] min-w-0">
              <PanelPreview
                valores={valores}
                sesiones={sesiones}
                onPrevisualizar={handlePrevisualizar}
                resultado={previewResultado}
                cargando={previewCargando}
              />
            </div>
          </div>
        ) : null}

        {tab === "limites" ? (
          <TabLimites valores={valores} onChange={handleChange} disabled={!esAdmin} />
        ) : null}
      </div>

      {/* Fuera del handoff, pero transversal a las tres pestañas de config: el
          historial es de la versión completa, no de una pestaña. Por eso va
          debajo y no adentro de una columna. Reglas queda afuera porque sus
          filas viven en otra tabla y no entran en la versión de config. */}
      {tab !== "reglas" ? (
        <div className="mt-5">
          <HistorialVersiones
            versiones={historial}
            onRestaurar={handleRestaurar}
            puedeRestaurar={esAdmin}
          />
        </div>
      ) : null}

      {sucio ? (
        <div className="bg-surface-elevated border-line-card sticky bottom-0 -mx-5 mt-5 -mb-5 flex items-center gap-3 border-t px-5 py-3">
          <span className="text-ink-secondary text-[12px]">
            Cambios sin guardar. Al guardar, se aplican en menos de un minuto (el proveedor cachea
            la config 30 s).
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setValores(guardado)}
              disabled={isPending}
              className="text-ink-dim hover:text-ink-primary text-[11.5px] underline disabled:opacity-50"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={handleGuardar}
              disabled={isPending}
              className="bg-brand text-brand-ink rounded-[9px] px-4 py-2 text-[11.5px] font-semibold disabled:opacity-50"
            >
              {isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
