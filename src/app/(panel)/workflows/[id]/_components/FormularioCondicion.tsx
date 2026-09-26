"use client";

import { useCallback, useMemo, useState } from "react";
import { CuerpoCondicion, type Coincidencias } from "@/components/workflows/editor";
import { arbolDeConfig } from "@/lib/workflows/condiciones.schema";
import { camposDeCondicion } from "../_lib/campos-condicion";
import { ListaCoincidencias } from "./ListaCoincidencias";
import {
  useCatalogosCondicion,
  useConteoCondicion,
  type EstadoConteo,
} from "./use-datos-condicion";

import type { Grupo } from "@/lib/ui/condiciones";

/**
 * El formulario del bloque Condición (`logica_condicion` y el `condicion`
 * legacy) dentro del panel de configuración del editor.
 *
 * Abre lo guardado con `arbolDeConfig` y escribe siempre `{ arbol }`, que es la
 * única forma que el constructor produce. Un flujo guardado con el trío plano
 * de antes se abre ya convertido —con la misma semántica, lo prueba
 * `condiciones.test.ts`— y pasa al formato nuevo recién cuando alguien lo
 * cambia: abrirlo no reescribe nada.
 *
 * Una config que no es ni árbol ni trío no se abre. Mostrar un árbol vacío en
 * su lugar sería invitar a "arreglarla" pisando lo que había, sin que nadie
 * haya visto qué era.
 */
export function FormularioCondicion({
  config,
  onChange,
  readonly = false,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readonly?: boolean;
}) {
  const arbol = useMemo(() => arbolDeConfig(config), [config]);
  // Reemplaza la config entera: las claves del trío viejo no quedan colgando
  // al lado del árbol, donde nadie las lee pero el diff las mostraría.
  const cambiar = useCallback((g: Grupo) => onChange({ arbol: g }), [onChange]);
  // Intent y etiquetas se eligen de la base: sin catálogo, sus listas están
  // vacías hasta que llega (no se inventan opciones).
  const catalogos = useCatalogosCondicion();
  const campos = useMemo(() => camposDeCondicion(catalogos ?? undefined), [catalogos]);
  const conteo = useConteoCondicion(arbol);
  const [listaAbierta, setListaAbierta] = useState(false);
  const coincidencias = useMemo(
    () => coincidenciasDe(conteo, () => setListaAbierta(true)),
    [conteo],
  );

  if (arbol === null) {
    return (
      <div
        role="alert"
        className="border-danger/30 bg-danger/10 flex flex-col gap-1.5 rounded-lg border p-3.5"
      >
        <p className="text-danger text-[12px] leading-snug font-semibold text-pretty">
          Esta condición no se puede abrir
        </p>
        <p className="text-ink-dim text-[11px] leading-relaxed text-pretty">
          Lo que tiene guardado no tiene la forma de una condición, y abrirla acá la reemplazaría
          por una vacía. Queda como está: para rehacerla, eliminá el bloque y agregá una condición
          nueva.
        </p>
      </div>
    );
  }

  const formatoViejo = !Object.hasOwn(config, "arbol") && Object.hasOwn(config, "campo");

  return (
    // `disabled` en el fieldset apaga todos los controles de adentro de una
    // vez, incluidos los disparadores de los selectores, que son `<button>`.
    // Sin esto, quien no puede guardar podía armar una condición entera que
    // se perdía al salir, igual que pasaba en el lienzo antes de `editable`.
    <fieldset disabled={readonly} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      {formatoViejo ? (
        <p className="text-ink-ghost text-[10.5px] leading-relaxed text-pretty">
          Se guardó con el formato anterior de condición. Se muestra convertida, con el mismo
          resultado, y pasa al formato nuevo cuando la cambies.
        </p>
      ) : null}
      <CuerpoCondicion
        condicion={arbol}
        campos={campos}
        onCambiar={cambiar}
        coincidencias={coincidencias}
      />
      {conteo.tipo === "no_contable" ? (
        <p role="status" className="text-ink-dim text-[10.5px] leading-relaxed text-pretty">
          No se cuenta a cuántos leads alcanza: «Respondió» depende de lo que dispara el flujo, no
          de un dato guardado del lead.
        </p>
      ) : conteo.tipo === "error" ? (
        <p role="status" className="text-ink-dim text-[10.5px] leading-relaxed text-pretty">
          {conteo.mensaje}
        </p>
      ) : null}
      <ListaCoincidencias arbol={arbol} abierto={listaAbierta} onAbiertoCambia={setListaAbierta} />
    </fieldset>
  );
}

/**
 * Del estado del conteo a lo que dibuja el contador. Sin número que mostrar
 * (no contable, o falló) no hay contador: el panel no inventa una cifra.
 */
function coincidenciasDe(conteo: EstadoConteo, onVerLista: () => void): Coincidencias | undefined {
  if (conteo.tipo === "pendiente") return { cantidad: null };
  if (conteo.tipo === "contado") {
    return { cantidad: conteo.cantidad, recalculando: conteo.recalculando, onVerLista };
  }
  return undefined;
}
