"use client";

import { BadgeSalud } from "@/components/ajustes/BadgeSalud";
import { descriptorDePlantilla } from "@/components/ajustes/descriptores";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { Button } from "@/components/ui/button";
import { cantidad } from "@/lib/ui/metricas";
import { cn } from "@/lib/utils";
import { formatearEntero } from "./formato";
import { disponibilidad, segmentar, variablesDe } from "./mensaje";
import { CATEGORIA_PLANTILLA, COLOR_RUTA, tinte } from "./paleta";
import { CodigoMeta, Nota } from "./primitivas";
import type { CategoriaPlantilla, Dato, LecturaPlantillas, Plantilla } from "./tipos";

/**
 * La categoría como etiqueta corta. Mono y en mayúsculas porque es una
 * clasificación de Meta, algo que se busca en su documentación. El estado va
 * con `BadgeSalud`, glifo y palabra, como en la tabla de plantillas de Ajustes.
 */
export function BadgeCategoria({ categoria }: { categoria: CategoriaPlantilla }) {
  const { etiqueta, color } = CATEGORIA_PLANTILLA[categoria];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-[5px] px-1.5 py-[3px] font-mono text-[9.5px] leading-none font-semibold tracking-[0.06em] uppercase"
      style={{ color, backgroundColor: tinte(color, 12) }}
    >
      {etiqueta}
    </span>
  );
}

/**
 * Elegir la plantilla.
 *
 * Es el caso principal del paso: una difusión casi siempre le escribe a gente
 * fuera de la ventana de 24 h, y ahí WhatsApp solo acepta plantillas aprobadas.
 *
 * Las plantillas son las de la cuenta, leídas de Meta. Esa lectura trae
 * nombre, idioma, categoría y estado, no el texto, y la pantalla lo dice en
 * vez de inventarlo. Las que no se pueden usar van aparte y sin radio, cada
 * una con su estado, el código con que Meta rechazaría el envío y el porqué.
 */
export function SelectorPlantilla({
  lectura,
  elegidaId,
  porVentanaAbierta,
  porPlantilla,
  onElegir,
  onDespausar,
}: {
  lectura: Dato<LecturaPlantillas>;
  elegidaId: string | null;
  /** Reparto de la audiencia por ruta; `null` mientras no hay cálculo. */
  porVentanaAbierta: number | null;
  porPlantilla: number | null;
  onElegir: (id: string) => void;
  onDespausar: (plantilla: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink-primary text-[13px] font-[650]">Plantilla</h2>
        <span className="text-ink-ghost text-[11px]">
          se crean en el administrador de Meta · acá solo se eligen
        </span>
      </div>

      <p className="text-ink-faint max-w-[640px] text-[11.5px] leading-relaxed text-pretty">
        Fuera de la ventana de 24 h, WhatsApp solo deja escribir con una plantilla aprobada por
        Meta.
        {porPlantilla !== null && porVentanaAbierta !== null ? (
          <>
            {" "}
            A{" "}
            <span className="font-mono tabular-nums" style={{ color: COLOR_RUTA.plantilla }}>
              {formatearEntero(porPlantilla)}
            </span>{" "}
            de esta audiencia les llega fuera de la ventana; los otros{" "}
            <span className="font-mono tabular-nums" style={{ color: COLOR_RUTA.ventana_abierta }}>
              {formatearEntero(porVentanaAbierta)}
            </span>{" "}
            tienen la ventana abierta y reciben la misma plantilla (con marketing, se cobra igual).
          </>
        ) : null}
      </p>

      {lectura.estado === "sin-dato" ? (
        <p
          role="alert"
          className="text-danger rounded-[11px] border px-3.5 py-3 text-[12px] font-medium"
          style={{
            borderColor: tinte("var(--color-danger)", 30),
            backgroundColor: tinte("var(--color-danger)", 8),
          }}
        >
          {lectura.motivo} Sin plantilla, esta difusión no puede salir.
        </p>
      ) : (
        <Lista
          lectura={lectura.valor}
          elegidaId={elegidaId}
          onElegir={onElegir}
          onDespausar={onDespausar}
        />
      )}
    </section>
  );
}

function Lista({
  lectura,
  elegidaId,
  onElegir,
  onDespausar,
}: {
  lectura: LecturaPlantillas;
  elegidaId: string | null;
  onElegir: (id: string) => void;
  onDespausar: (plantilla: string) => void;
}) {
  const disponibles = lectura.plantillas.filter((p) => disponibilidad(p).elegible);
  const bloqueadas = lectura.plantillas.filter((p) => !disponibilidad(p).elegible);

  return (
    <>
      {disponibles.length > 0 ? (
        <fieldset>
          <legend className="sr-only">Plantillas aprobadas</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {disponibles.map((p) => (
              <TarjetaPlantilla
                key={p.id}
                plantilla={p}
                elegida={p.id === elegidaId}
                onElegir={() => onElegir(p.id)}
              />
            ))}
          </div>
        </fieldset>
      ) : (
        <p
          role="status"
          className="text-caution rounded-[11px] border px-3.5 py-3 text-[12px] font-semibold"
          style={{
            borderColor: tinte("var(--color-caution)", 30),
            backgroundColor: tinte("var(--color-caution)", 10),
          }}
        >
          No hay ninguna plantilla aprobada de marketing o utility: sin una, esta difusión no puede
          salir.
        </p>
      )}

      {bloqueadas.length > 0 ? (
        <div className="flex flex-col gap-2 pt-1">
          <Eyebrow>No se pueden elegir · {bloqueadas.length}</Eyebrow>
          <ul className="border-line-card bg-surface-card flex flex-col rounded-[11px] border">
            {bloqueadas.map((p, i) => (
              <li key={p.id} className={cn(i > 0 && "border-line-row border-t")}>
                <FilaBloqueada plantilla={p} onDespausar={onDespausar} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Nota>
        La lectura de plantillas de Meta que usa este CRM trae nombre, idioma, categoría y estado,
        no el texto. La difusión guarda el nombre y la categoría: si la plantilla lleva variables,
        hoy no hay dónde guardar de qué dato sale cada una.
      </Nota>
      {lectura.ocultas > 0 ? (
        <Nota>
          {lectura.ocultas === 1
            ? "Una plantilla de otra categoría no se ofrece"
            : `${formatearEntero(lectura.ocultas)} plantillas de otra categoría no se ofrecen`}{" "}
          (como las de autenticación): una difusión sale con marketing o utility.
        </Nota>
      ) : null}
      {lectura.nota ? <Nota>{lectura.nota}</Nota> : null}
    </>
  );
}

function TarjetaPlantilla({
  plantilla,
  elegida,
  onElegir,
}: {
  plantilla: Plantilla;
  elegida: boolean;
  onElegir: () => void;
}) {
  const variables = variablesDe(plantilla.cuerpo).length;
  const botones = plantilla.botones.length;

  return (
    <label
      className={cn(
        "has-[:focus-visible]:ring-ring/50 flex cursor-pointer flex-col gap-2 rounded-[11px] border p-3 transition-colors duration-150 has-[:focus-visible]:ring-3",
        elegida
          ? "border-ink-primary bg-surface-card"
          : "border-line-card bg-surface-card/50 hover:border-line-control",
      )}
    >
      <input
        type="radio"
        name="plantilla-difusion"
        value={plantilla.id}
        className="sr-only"
        checked={elegida}
        onChange={onElegir}
      />
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-[13px] shrink-0 rounded-full border-2 transition-colors duration-150",
            elegida
              ? "border-ink-primary bg-ink-primary ring-surface-card ring-2 ring-inset"
              : "border-line-control",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium",
            elegida ? "text-ink-primary" : "text-ink-secondary",
          )}
        >
          {plantilla.nombre}
        </span>
        {plantilla.idioma ? (
          <span className="text-ink-ghost shrink-0 font-mono text-[10px]">{plantilla.idioma}</span>
        ) : null}
        <BadgeCategoria categoria={plantilla.categoria} />
      </span>

      {plantilla.cuerpo === null ? (
        <span className="text-ink-ghost text-[11px] leading-relaxed">
          El texto no se lee de Meta: revisalo en su administrador.
        </span>
      ) : (
        <>
          <span className="text-ink-faint line-clamp-2 text-[11px] leading-relaxed">
            {segmentar(plantilla.cuerpo).map((s, i) =>
              s.tipo === "texto" ? (
                <span key={i}>{s.texto}</span>
              ) : (
                <span key={i} className="text-ink-dim font-mono text-[10px]">
                  {`{{${s.indice}}}`}
                </span>
              ),
            )}
          </span>
          <span className="text-ink-ghost font-mono text-[10px] tabular-nums">
            {cantidad(variables, "variable")} ·{" "}
            {botones === 0 ? "sin botones" : cantidad(botones, "botón", "botones")}
          </span>
        </>
      )}
    </label>
  );
}

function FilaBloqueada({
  plantilla,
  onDespausar,
}: {
  plantilla: Plantilla;
  onDespausar: (plantilla: string) => void;
}) {
  const d = disponibilidad(plantilla);
  if (d.elegible) return null;

  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-ink-secondary font-mono text-[11.5px] font-medium">
            {plantilla.nombre}
          </span>
          {plantilla.idioma ? (
            <span className="text-ink-ghost font-mono text-[10px]">{plantilla.idioma}</span>
          ) : null}
          <BadgeSalud descriptor={descriptorDePlantilla(plantilla.estado)} />
          {d.codigo ? <CodigoMeta codigo={d.codigo} /> : null}
        </span>
        <span className="text-ink-dim text-[11px] leading-relaxed text-pretty">{d.motivo}</span>
        {plantilla.nota ? (
          <span className="text-ink-ghost text-[10.5px] leading-relaxed">{plantilla.nota}</span>
        ) : null}
      </div>
      {plantilla.requiereDespausadoManual ? (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => onDespausar(plantilla.nombre)}
        >
          Despausar
        </Button>
      ) : null}
    </div>
  );
}
