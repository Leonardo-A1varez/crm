"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { ConstructorCondiciones } from "@/components/shared/condiciones";
import {
  COMPARADORES_POR_TIPO,
  COMPARADOR_LABEL,
  contarIncompletas,
  contarReglas,
  type CampoCondicion,
  type Grupo,
  type TipoCampo,
} from "@/lib/ui/condiciones";
import { CURVA, DURACION, FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "@/lib/ui/motion";
import { MEDIDAS } from "./tokens-editor";

const TIPO_LABEL: Record<TipoCampo, string> = {
  lista: "Opción de una lista",
  multilista: "Varias de una lista",
  texto: "Texto",
  numero: "Número",
  fecha: "Fecha",
  booleano: "Sí o no",
};

/**
 * Cuántos leads coinciden, ahora mismo.
 *
 * `null` = todavía no se sabe (la primera consulta no volvió). No es cero:
 * dibujar un 0 mientras se calcula hace que alguien conclúya que su condición
 * no matchea nada y la reescriba sin motivo.
 */
export interface Coincidencias {
  cantidad: number | null;
  /** Hay una consulta en vuelo. El número anterior se sigue mostrando, atenuado. */
  recalculando?: boolean;
  onVerLista?: () => void;
}

export interface CuerpoCondicionProps {
  condicion: Grupo;
  campos: readonly CampoCondicion[];
  onCambiar: (g: Grupo) => void;
  /**
   * El contador de leads alcanzados. Ausente cuando la pantalla no tiene de
   * dónde sacarlo: el panel no inventa un número, y el aviso de filas a medias
   * deja de hablar de un contador que no está.
   */
  coincidencias?: Coincidencias;
  className?: string;
}

/**
 * Lo de adentro del panel de condición: la caja, el aviso de filas a medias
 * (o el contador) y la ayuda de operadores.
 *
 * Está separado del marco porque la condición se monta en dos lugares: sola,
 * en su panel de 400 px (`ConstructorCondicion`), y dentro del panel de
 * configuración del editor, que ya trae su encabezado, su scroll y su pie.
 * Montar el panel entero ahí adentro daba dos encabezados y dos scrolls
 * anidados.
 *
 * Es la pantalla más importante del producto y por una razón puntual: una
 * condición mal armada no falla, **acierta de más**. Un flujo roto no manda
 * nada y alguien lo nota; una condición demasiado ancha manda a media base y
 * nadie lo nota hasta que Meta baja la calidad del número. Las tres decisiones
 * de acá salen de eso:
 *
 *  1. **Los grupos son cajas** (ver `ConstructorCondiciones`), no paréntesis en un
 *     texto. `A Y B O C` directamente no se puede escribir.
 *  2. **Ningún campo acepta código** (ver `EditorValor`). Los campos cerrados
 *     eligen de una lista; el texto libre compara literal.
 *  3. **Una condición incompleta no muestra número.** Ver abajo — es la
 *     decisión menos obvia y la que más plata ahorra.
 */
export function CuerpoCondicion({
  condicion,
  campos,
  onCambiar,
  coincidencias,
  className,
}: CuerpoCondicionProps) {
  const total = useMemo(() => contarReglas(condicion), [condicion]);
  const incompletas = useMemo(() => contarIncompletas(condicion), [condicion]);

  /** Los tipos que están realmente en uso. La ayuda del pie muestra sólo esos. */
  const tiposEnUso = useMemo(() => {
    const vistos = new Set<TipoCampo>();
    for (const c of campos) vistos.add(c.tipo);
    return [...vistos];
  }, [campos]);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-2">
        <Eyebrow>Si</Eyebrow>
        <ConstructorCondiciones grupo={condicion} campos={campos} onCambiar={onCambiar} />
      </div>

      <ContadorCoincidencias
        coincidencias={coincidencias}
        incompletas={incompletas}
        totalReglas={total}
      />

      <div className="flex flex-col gap-2">
        <Eyebrow>El operador depende del tipo del campo</Eyebrow>
        <div className="border-line-card divide-line-row divide-y rounded-lg border">
          {tiposEnUso.map((t) => (
            <div key={t} className="grid grid-cols-[96px_1fr] gap-2.5 px-3 py-2">
              <span className="text-ink-body text-[11px] leading-snug">{TIPO_LABEL[t]}</span>
              <span className="text-ink-faint font-mono text-[10.5px] leading-relaxed">
                {COMPARADORES_POR_TIPO[t].map((c) => COMPARADOR_LABEL[c]).join(" · ")}
              </span>
            </div>
          ))}
        </div>
        <p className="text-ink-ghost text-[10.5px] leading-relaxed text-pretty">
          Cuando el campo es cerrado —etapas, etiquetas, vendedores, intents— el valor también sale
          de una lista. Texto libre sólo cuando no hay más remedio, y se compara literal: no se
          interpreta nada de lo que se escriba.
        </p>
      </div>
    </div>
  );
}

export type ConstructorCondicionProps = CuerpoCondicionProps;

/**
 * El panel de condición entero, con su marco de 400 px: encabezado, cuerpo con
 * scroll. Es la pantalla dedicada; dentro del editor se monta sólo
 * `CuerpoCondicion`, porque el panel de configuración ya pone el marco.
 */
export function ConstructorCondicion({
  condicion,
  campos,
  onCambiar,
  coincidencias,
  className,
}: ConstructorCondicionProps) {
  const total = useMemo(() => contarReglas(condicion), [condicion]);

  return (
    <aside
      style={{ width: MEDIDAS.PANEL_CONDICION }}
      aria-label="Constructor de la condición"
      className={cn(
        "border-line-layout bg-surface-panel flex shrink-0 flex-col border-l",
        className,
      )}
    >
      <div className="border-line-layout flex shrink-0 items-center gap-2 border-b px-4 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-ink-primary text-[13px] leading-none font-semibold">Condición</h2>
          <span className="text-ink-ghost font-mono text-[10.5px] tabular-nums">
            {total} {total === 1 ? "condición" : "condiciones"} · 2 salidas
          </span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <CuerpoCondicion
          condicion={condicion}
          campos={campos}
          onCambiar={onCambiar}
          coincidencias={coincidencias}
          className="p-4"
        />
      </ScrollArea>
    </aside>
  );
}

/**
 * El contador en vivo.
 *
 * ## Por qué una condición incompleta no muestra número
 *
 * Es la decisión menos obvia de la pantalla. Una condición a medio armar
 * —campo elegido, valor todavía no— **matchea a todo el mundo** si el motor
 * ignora las filas incompletas, o a nadie si las cuenta como falsas. Las dos
 * respuestas son número, y las dos mienten.
 *
 * Un "1.842 leads" al lado de una regla a medias es exactamente cómo alguien
 * concluye "listo, funciona" y le da a publicar. Así que mientras falte algo el
 * contador dice qué falta y no dice cuántos. La cifra vuelve sola cuando la
 * condición está entera.
 *
 * Sin contador (`coincidencias` ausente) el aviso de filas a medias sigue, pero
 * no promete una cifra que esta pantalla no va a mostrar.
 *
 * ## Por qué el número no se reemplaza por un spinner
 *
 * Mientras se recalcula se sigue mostrando el número anterior, atenuado. Un
 * spinner en su lugar cambia la altura de la caja y hace saltar todo el panel
 * en cada tecla; y además el número viejo sigue siendo aproximadamente cierto,
 * que es más información que un spinner. `tabular-nums` para que pasar de
 * "47" a "1.842" no corra el texto de al lado.
 */
function ContadorCoincidencias({
  coincidencias,
  incompletas,
  totalReglas,
}: {
  coincidencias?: Coincidencias;
  incompletas: number;
  totalReglas: number;
}) {
  if (incompletas > 0) {
    return (
      <div
        role="status"
        className="border-caution/30 bg-caution/10 flex flex-col gap-1.5 rounded-lg border p-3.5"
      >
        <p className="text-caution text-[12px] leading-snug font-semibold text-pretty">
          {incompletas === 1
            ? "Falta terminar una condición"
            : `Faltan terminar ${incompletas} condiciones`}
        </p>
        <p className="text-ink-dim text-[10.5px] leading-relaxed text-pretty">
          {coincidencias
            ? "No se muestra a cuántos leads alcanza hasta que estén todas completas. Una condición a medias alcanza a todos o a ninguno según el caso, y las dos cifras engañan."
            : "Completá cada fila: una condición a medias no dice por qué salida sigue cada lead."}
        </p>
      </div>
    );
  }

  if (totalReglas === 0 || !coincidencias) return null;

  const { cantidad, recalculando, onVerLista } = coincidencias;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-ok/30 bg-ok/10 flex flex-col gap-2 rounded-lg border p-3.5"
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-ok font-mono text-[20px] leading-none font-semibold tabular-nums",
            recalculando && "opacity-50",
            "transition-opacity",
            DURACION.FLOTANTE,
            CURVA.SALIDA,
          )}
        >
          {cantidad === null ? "—" : cantidad.toLocaleString("es-AR")}
        </span>
        <span className="text-ink-body flex-1 text-[12px] leading-snug text-pretty">
          {cantidad === null
            ? "calculando a cuántos leads alcanza"
            : cantidad === 1
              ? "lead coincide ahora mismo"
              : "leads coinciden ahora mismo"}
        </span>
        {onVerLista && cantidad !== null && cantidad > 0 ? (
          <button
            type="button"
            onClick={onVerLista}
            className={cn(
              "text-ok shrink-0 rounded text-[11.5px] font-medium underline underline-offset-2",
              TRANSICION_CONTROL,
              PRESION_TACTIL,
              FOCO,
            )}
          >
            Ver la lista
          </button>
        ) : null}
      </div>
      <p className="text-ink-dim text-[10.5px] leading-relaxed text-pretty">
        Se recalcula con cada cambio. Nadie arma una condición a ciegas.
      </p>
    </div>
  );
}

/**
 * Pie del panel: guardar o descartar.
 *
 * Se exporta aparte porque el panel de condición aparece embebido en el editor
 * —donde el guardado es del flujo entero y este pie no va— y también solo, en
 * la pantalla dedicada. Meterlo adentro obligaría a un flag `mostrarPie`, que
 * es la forma larga de tener dos componentes.
 */
export function PieCondicion({
  onGuardar,
  onDescartar,
  puedeGuardar,
}: {
  onGuardar: () => void;
  onDescartar: () => void;
  puedeGuardar: boolean;
}) {
  return (
    <div className="border-line-layout flex shrink-0 gap-2 border-t px-4 py-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDescartar}
        className={cn("flex-1", TRANSICION_CONTROL, PRESION_TACTIL)}
      >
        Descartar
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onGuardar}
        disabled={!puedeGuardar}
        title={puedeGuardar ? undefined : "Faltan condiciones por completar"}
        className={cn("flex-1", TRANSICION_CONTROL, PRESION_TACTIL)}
      >
        Guardar condición
      </Button>
    </div>
  );
}
