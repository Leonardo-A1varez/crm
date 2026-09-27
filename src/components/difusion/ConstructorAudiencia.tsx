"use client";

import { useId, useMemo } from "react";
import { Casilla } from "@/components/shared/Casilla";
import { ConstructorCondiciones } from "@/components/shared/condiciones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { contarReglas } from "@/lib/ui/condiciones";
import { LARGO_MAXIMO_NOMBRE_DIFUSION } from "@/lib/validation/difusion-acciones.schema";
import { cn } from "@/lib/utils";
import { AlcanceEnVivo } from "./AlcanceEnVivo";
import { CabeceraDifusion } from "./CabeceraDifusion";
import { camposAudiencia, type CatalogosAudiencia } from "./campos-audiencia";
import { ExclusionesAudiencia } from "./ExclusionesAudiencia";
import { tinte } from "./paleta";
import { Nota } from "./primitivas";
import { SelectorModo } from "./SelectorModo";
import type {
  EstadoAlcance,
  Exclusion,
  GrupoAudiencia,
  ModoAudiencia,
  MotivoExclusion,
} from "./tipos";

function exclusionesDe(estado: EstadoAlcance): readonly Exclusion[] | null {
  switch (estado.estado) {
    case "listo":
      return estado.alcance.exclusiones;
    case "calculando":
    case "error":
      return estado.previo?.exclusiones ?? null;
    case "incompleta":
    case "sin-condiciones":
      return null;
  }
}

/**
 * Paso 1: a quién le llega.
 *
 * Dos columnas y no una: los filtros a la izquierda y el tamaño a la derecha,
 * siempre visible. Si el número vive abajo del formulario, editar seis
 * condiciones es hacerlo a ciegas.
 *
 * El árbol de condiciones es el mismo componente que usa el nodo Condición de
 * un workflow; lo propio de esta pantalla es el catálogo de campos, el
 * contador sobre el padrón y las exclusiones con motivo.
 *
 * ## "Toda la base" es una elección, no un árbol vacío
 *
 * Mandarle a todos se marca con su propio control. Mientras está marcado, el
 * árbol no se usa —la base rechaza toda la base con condiciones— pero no se
 * borra: si se desmarca, las condiciones que había vuelven.
 */
export function ConstructorAudiencia({
  nombre,
  onCambiarNombre,
  modo,
  onCambiarModo,
  raiz,
  onCambiarCondiciones,
  todaLaBase,
  onCambiarTodaLaBase,
  catalogos,
  aviso,
  estado,
  aplicadas,
  onAlternarExclusion,
  onReintentar,
  pendiente,
  guardando,
  error,
  onVolver,
  onContinuar,
}: {
  nombre: string;
  onCambiarNombre: (nombre: string) => void;
  modo: ModoAudiencia;
  onCambiarModo: (modo: ModoAudiencia) => void;
  raiz: GrupoAudiencia;
  onCambiarCondiciones: (raiz: GrupoAudiencia) => void;
  todaLaBase: boolean;
  onCambiarTodaLaBase: (todaLaBase: boolean) => void;
  /** Etiquetas, vendedores y campañas reales. Etapas, canales y motivos salen del dominio. */
  catalogos?: CatalogosAudiencia;
  /** Algo que no se pudo leer y cambia lo que se puede elegir. */
  aviso: string | null;
  estado: EstadoAlcance;
  /** Lo elegido para las dos exclusiones que se pueden levantar. */
  aplicadas: Partial<Record<MotivoExclusion, boolean>>;
  onAlternarExclusion: (motivo: MotivoExclusion, aplicada: boolean) => void;
  onReintentar: () => void;
  /** Por qué todavía no se puede seguir; `null` = se puede. */
  pendiente: string | null;
  guardando: boolean;
  /** El error del último guardado. */
  error: string | null;
  onVolver: () => void;
  onContinuar: () => void;
}) {
  const idNombre = useId();
  const idAviso = useId();
  const campos = useMemo(() => camposAudiencia(catalogos), [catalogos]);
  const hayCondiciones = contarReglas(raiz) > 0;
  const bloqueado = pendiente !== null || guardando;
  const avisoBoton = error ?? pendiente;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CabeceraDifusion
        nombre={nombre.trim() || "Difusión nueva"}
        paso="Audiencia"
        etiquetaVolver="Difusión"
        onVolver={onVolver}
        acciones={
          <>
            {avisoBoton ? (
              <span
                id={idAviso}
                role={error ? "alert" : undefined}
                className={cn(
                  "max-w-[320px] truncate text-[11.5px]",
                  error ? "text-danger" : "text-ink-faint",
                )}
                title={avisoBoton}
              >
                {avisoBoton}
              </span>
            ) : null}
            <Button
              onClick={onContinuar}
              disabled={bloqueado}
              focusableWhenDisabled
              aria-describedby={avisoBoton ? idAviso : undefined}
              aria-busy={guardando || undefined}
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
            {aviso ? (
              <p
                role="status"
                className="text-ink-secondary rounded-[11px] border px-3.5 py-2.5 text-[11.5px] leading-relaxed text-pretty"
                style={{
                  borderColor: tinte("var(--color-caution)", 32),
                  backgroundColor: tinte("var(--color-caution)", 9),
                }}
              >
                {aviso}
              </p>
            ) : null}

            <section className="flex flex-col gap-2">
              <label htmlFor={idNombre} className="text-ink-primary text-[13px] font-[650]">
                Nombre
              </label>
              <Input
                id={idNombre}
                value={nombre}
                maxLength={LARGO_MAXIMO_NOMBRE_DIFUSION}
                autoComplete="off"
                placeholder="Ej.: Frenos · septiembre"
                onChange={(e) => onCambiarNombre(e.target.value)}
                className="max-w-[420px]"
              />
              <span className="text-ink-ghost text-[11px]">
                Lo ven sólo las personas del panel: no le llega a nadie.
              </span>
            </section>

            <SelectorModo
              modo={modo}
              coinciden={estado.estado === "listo" ? estado.alcance.coinciden : null}
              onCambiar={onCambiarModo}
            />

            <section className="flex flex-col gap-3">
              <h2 className="text-ink-primary text-[13px] font-[650]">Condiciones</h2>

              <label
                className={cn(
                  "has-[:focus-visible]:ring-ring/50 flex cursor-pointer items-start gap-2.5 rounded-[11px] border p-3 transition-colors duration-150 has-[:focus-visible]:ring-3",
                  todaLaBase
                    ? "border-ink-primary bg-surface-card"
                    : "border-line-card bg-surface-card/50 hover:border-line-control",
                )}
              >
                <Casilla
                  checked={todaLaBase}
                  onChange={(e) => onCambiarTodaLaBase(e.target.checked)}
                  className="mt-[1px]"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-ink-primary text-[12px] font-[650]">
                    Mandarle a toda la base
                  </span>
                  <span className="text-ink-faint text-[11px] leading-relaxed text-pretty">
                    Sin condiciones: le llega a todos los leads, menos a los que excluye la lista de
                    abajo. Se elige a propósito: un árbol vacío no se interpreta como «todos».
                  </span>
                </span>
              </label>

              {todaLaBase ? (
                hayCondiciones ? (
                  <Nota>
                    Las condiciones que armaste no se usan mientras esté elegida toda la base.
                    Quedan acá: si la destildás, vuelven.
                  </Nota>
                ) : null
              ) : (
                <ConstructorCondiciones
                  grupo={raiz}
                  campos={campos}
                  onCambiar={onCambiarCondiciones}
                />
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-ink-primary text-[13px] font-[650]">Excluir siempre</h2>
              <ExclusionesAudiencia
                exclusiones={exclusionesDe(estado)}
                aplicadas={aplicadas}
                onAlternar={onAlternarExclusion}
              />
            </section>
          </div>
        </div>

        <AlcanceEnVivo estado={estado} onReintentar={onReintentar} />
      </div>
    </div>
  );
}
