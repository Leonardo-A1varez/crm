"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AccionesBotones } from "./AccionesBotones";
import { CabeceraDifusion } from "./CabeceraDifusion";
import { describirPendiente, pendientesMensaje, variablesDe } from "./mensaje";
import { SelectorPlantilla } from "./SelectorPlantilla";
import { TextoLibreMensaje } from "./TextoLibreMensaje";
import { VariablesPlantilla } from "./VariablesPlantilla";
import { VistaPreviaMensaje } from "./VistaPreviaMensaje";
import type {
  AccionBoton,
  AsignacionVariable,
  ConfigMensaje,
  Dato,
  Destinatario,
  LecturaPlantillas,
  LineaCosto,
  OpcionCampo,
  Plantilla,
  ValoresLead,
} from "./tipos";

/**
 * Paso 2: qué le llega.
 *
 * Mismo esqueleto que el paso 1 —configuración a la izquierda, consecuencia a
 * la derecha, en un panel del mismo ancho— para que pasar de un paso al otro
 * no mueva nada de lugar salvo el contenido.
 *
 * Primero la plantilla; después, si la plantilla los tiene, de dónde sale cada
 * variable y qué hace cada botón. Hoy el texto no se lee de Meta, así que
 * variables y botones no aparecen: lo que se decide en este paso es la
 * plantilla, y eso es lo que se guarda.
 *
 * ## Qué frena el «Continuar»
 *
 * Lo que falta configurar. Lo que falta se escribe al lado del botón, y el
 * botón sigue siendo alcanzable con el teclado: uno deshabilitado que no se
 * puede enfocar no le explica a nadie por qué está así.
 */
export function ConstructorMensaje({
  nombre,
  lectura,
  plantilla,
  config,
  destinatarios,
  valoresPorLead,
  etiquetas,
  porVentanaAbierta,
  porPlantilla,
  porTextoLibre,
  textoLibre,
  onCambiarTextoLibre,
  lineasCosto,
  guardando,
  error,
  onElegirPlantilla,
  onCambiarConfig,
  onDespausar,
  onVolver,
  onContinuar,
}: {
  nombre: string;
  lectura: Dato<LecturaPlantillas>;
  /** La elegida, o `null` mientras no se eligió ninguna. */
  plantilla: Plantilla | null;
  config: ConfigMensaje | null;
  /** La muestra de la audiencia: contra ellos se previsualiza. */
  destinatarios: readonly Destinatario[];
  valoresPorLead: Readonly<Record<string, ValoresLead>>;
  /** Las etiquetas que existen, para los botones que etiquetan. */
  etiquetas: readonly OpcionCampo[];
  porVentanaAbierta: number | null;
  porPlantilla: number | null;
  /** A cuántos les sale el texto libre según el plan. `null` sin cálculo. */
  porTextoLibre: number | null;
  /** La versión en texto libre, como se escribe (vacía = sin texto libre). */
  textoLibre: string;
  onCambiarTextoLibre: (texto: string) => void;
  /** El costo con la plantilla elegida. `null` sin plantilla o sin reparto. */
  lineasCosto: readonly LineaCosto[] | null;
  guardando: boolean;
  /** El error del último guardado. */
  error: string | null;
  onElegirPlantilla: (id: string) => void;
  onCambiarConfig: (config: ConfigMensaje) => void;
  onDespausar: (plantilla: string) => void;
  onVolver: () => void;
  onContinuar: () => void;
}) {
  const idAviso = useId();
  const pendientes = pendientesMensaje(plantilla, config);
  const primero = pendientes[0];
  const listo = pendientes.length === 0;
  const idsMuestra = destinatarios.map((d) => d.leadId);
  const aviso =
    error ??
    (primero
      ? `${describirPendiente(primero)}${pendientes.length > 1 ? ` · y ${pendientes.length - 1} más` : ""}`
      : null);

  function cambiarVariable(indice: number, asignacion: AsignacionVariable) {
    if (!config) return;
    onCambiarConfig({ ...config, variables: { ...config.variables, [indice]: asignacion } });
  }

  function cambiarBoton(botonId: string, accion: AccionBoton) {
    if (!config) return;
    onCambiarConfig({ ...config, botones: { ...config.botones, [botonId]: accion } });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CabeceraDifusion
        nombre={nombre}
        paso="Mensaje"
        etiquetaVolver="Audiencia"
        onVolver={onVolver}
        acciones={
          <>
            {aviso ? (
              <span
                id={idAviso}
                role={error ? "alert" : undefined}
                title={aviso}
                className={cn(
                  "max-w-[320px] truncate text-[11.5px]",
                  error ? "text-danger" : "text-ink-faint",
                )}
              >
                {aviso}
              </span>
            ) : null}
            <Button
              onClick={onContinuar}
              disabled={!listo || guardando}
              focusableWhenDisabled
              aria-describedby={aviso ? idAviso : undefined}
              aria-busy={guardando || undefined}
              // Con `focusableWhenDisabled` base-ui no pone el atributo
              // `disabled` —si lo pusiera, el botón dejaría de recibir foco—,
              // así que el estado se pinta desde `data-disabled`.
              className="data-disabled:cursor-not-allowed data-disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Continuar"}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="bg-surface-root min-w-0 flex-1 overflow-auto p-6">
          <div className="flex max-w-[760px] flex-col gap-6">
            <SelectorPlantilla
              lectura={lectura}
              elegidaId={plantilla?.id ?? null}
              porVentanaAbierta={porVentanaAbierta}
              porPlantilla={porPlantilla}
              porTextoLibre={porTextoLibre ?? 0}
              onElegir={onElegirPlantilla}
              onDespausar={onDespausar}
            />

            {plantilla && config && variablesDe(plantilla.cuerpo).length > 0 ? (
              <VariablesPlantilla
                plantilla={plantilla}
                variables={config.variables}
                idsMuestra={idsMuestra}
                valoresPorLead={valoresPorLead}
                onCambiar={cambiarVariable}
              />
            ) : null}

            {plantilla && config && plantilla.botones.length > 0 ? (
              <AccionesBotones
                botones={plantilla.botones}
                acciones={config.botones}
                etiquetas={etiquetas}
                onCambiar={cambiarBoton}
              />
            ) : null}

            {plantilla ? (
              <TextoLibreMensaje
                valor={textoLibre}
                onCambiar={onCambiarTextoLibre}
                porTextoLibre={porTextoLibre}
              />
            ) : null}
          </div>
        </div>

        <VistaPreviaMensaje
          plantilla={plantilla}
          config={config}
          destinatarios={destinatarios}
          valoresPorLead={valoresPorLead}
          lineasCosto={lineasCosto}
          textoLibre={textoLibre}
        />
      </div>
    </div>
  );
}
