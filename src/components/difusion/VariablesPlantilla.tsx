"use client";

import { Eyebrow } from "@/components/shared/Eyebrow";
import { Input } from "@/components/ui/input";
import { SelectOpciones } from "@/components/shared/SelectOpciones";
import { cn } from "@/lib/utils";
import { CAMPOS_VARIABLE, etiquetaCampo } from "./campos-mensaje";
import { contarSinDato, segmentar, variablesDe } from "./mensaje";
import { tinte } from "./paleta";
import { Nota } from "./primitivas";
import type {
  AsignacionVariable,
  CampoVariable,
  ConfigMensaje,
  Plantilla,
  ValoresLead,
} from "./tipos";

/** Agrupadas por `grupo`, en el orden del catálogo. */
const OPCIONES_CAMPO = CAMPOS_VARIABLE.map((c) => ({
  value: c.id,
  label: c.etiqueta,
  grupo: c.grupo,
}));

/**
 * Un respaldo es una o dos palabras en lugar de un dato. Más largo deja de
 * reemplazar un dato y empieza a cambiar el sentido del texto aprobado.
 */
const LARGO_RESPALDO = 40;

/** Id del campo de respaldo de una variable. La vista previa lleva el foco ahí. */
export function idRespaldo(indice: number): string {
  return `respaldo-variable-${indice}`;
}

/**
 * De dónde sale cada variable.
 *
 * **Ningún campo acepta código.** El dato de cada `{{n}}` se elige de una
 * lista cerrada de datos del lead; no hay dónde escribir `{{lead.nombre}}` ni
 * nada parecido. El único texto libre es el respaldo, y es literal: lo que se
 * escribe es lo que le llega a quien no tenga el dato.
 *
 * Arriba va el texto aprobado entero, con cada variable marcada con el dato
 * que tiene elegido. Sin eso, «{{2}} → Modelo del vehículo» obliga a ir a
 * buscar a otra parte qué dice el texto alrededor de `{{2}}`.
 *
 * La cuenta de quién no tiene el dato se hace sobre la muestra cargada, y lo
 * dice. Con el motor real sale del mismo servicio que calcula el alcance.
 */
export function VariablesPlantilla({
  plantilla,
  variables,
  idsMuestra,
  valoresPorLead,
  onCambiar,
}: {
  plantilla: Plantilla;
  variables: ConfigMensaje["variables"];
  /** Los leads cargados de la audiencia. */
  idsMuestra: readonly string[];
  valoresPorLead: Readonly<Record<string, ValoresLead>>;
  onCambiar: (indice: number, asignacion: AsignacionVariable) => void;
}) {
  const indices = variablesDe(plantilla.cuerpo);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink-primary text-[13px] font-[650]">Variables</h2>
        <span className="text-ink-ghost text-[11px]">cada una sale de un dato del lead</span>
      </div>

      <div className="border-line-card bg-surface-card flex flex-col gap-2.5 rounded-[11px] border p-3.5">
        <Eyebrow>Texto aprobado por Meta</Eyebrow>
        <div className="flex flex-col gap-1.5">
          {plantilla.encabezado ? (
            <p className="text-ink-primary text-[12px] font-[650]">{plantilla.encabezado}</p>
          ) : null}
          <p className="text-ink-secondary text-[12px] leading-[1.8] whitespace-pre-line">
            {segmentar(plantilla.cuerpo ?? "").map((s, i) =>
              s.tipo === "texto" ? (
                <span key={i}>{s.texto}</span>
              ) : (
                <ChipVariable
                  key={i}
                  indice={s.indice}
                  campo={variables[s.indice]?.campo ?? null}
                />
              ),
            )}
          </p>
          {plantilla.pie ? <p className="text-ink-faint text-[10.5px]">{plantilla.pie}</p> : null}
        </div>
        <Nota>
          No se edita desde acá. Lo que va en cada variable se elige de la lista de datos del lead:
          no se escribe.
        </Nota>
      </div>

      <ul className="border-line-card bg-surface-card flex flex-col rounded-[11px] border">
        {indices.map((indice, i) => (
          <li key={indice} className={cn(i > 0 && "border-line-row border-t")}>
            <FilaVariable
              indice={indice}
              asignacion={variables[indice] ?? { campo: null, respaldo: "" }}
              idsMuestra={idsMuestra}
              valoresPorLead={valoresPorLead}
              onCambiar={(a) => onCambiar(indice, a)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * La variable dentro del texto aprobado, con el dato que tiene elegido.
 *
 * Sin dato elegido se marca con palabra además de color («sin elegir»): es lo
 * que impide seguir, y el color solo no llega a quien no lo distingue.
 */
function ChipVariable({ indice, campo }: { indice: number; campo: CampoVariable | null }) {
  return (
    <span
      className={cn(
        "mx-px inline-flex items-baseline gap-1 rounded-[5px] px-1.5 py-px leading-snug whitespace-nowrap",
        campo && "bg-surface-input",
      )}
      style={campo ? undefined : { backgroundColor: tinte("var(--color-caution)", 14) }}
    >
      <span
        className={cn(
          "font-mono text-[10.5px] font-semibold",
          campo ? "text-ink-primary" : "text-caution",
        )}
      >
        {`{{${indice}}}`}
      </span>
      <span className={cn("text-[10.5px]", campo ? "text-ink-dim" : "text-caution")}>
        {campo ? etiquetaCampo(campo) : "sin elegir"}
      </span>
    </span>
  );
}

function FilaVariable({
  indice,
  asignacion,
  idsMuestra,
  valoresPorLead,
  onCambiar,
}: {
  indice: number;
  asignacion: AsignacionVariable;
  idsMuestra: readonly string[];
  valoresPorLead: Readonly<Record<string, ValoresLead>>;
  onCambiar: (asignacion: AsignacionVariable) => void;
}) {
  const { campo, respaldo } = asignacion;
  const token = `{{${indice}}}`;
  const idInput = idRespaldo(indice);
  const idCobertura = `cobertura-variable-${indice}`;
  const total = idsMuestra.length;
  const sinDato = campo ? contarSinDato(idsMuestra, valoresPorLead, campo) : 0;
  const respaldoLimpio = respaldo.trim();

  return (
    <div
      role="group"
      aria-label={`Variable ${token}`}
      className="grid grid-cols-[40px_minmax(0,1fr)_auto_168px] items-center gap-x-2.5 gap-y-1.5 px-3 py-3"
    >
      <span
        aria-hidden
        className={cn(
          "font-mono text-[11.5px] font-semibold tabular-nums",
          campo ? "text-ink-secondary" : "text-caution",
        )}
      >
        {token}
      </span>

      <SelectOpciones
        value={campo}
        onValueChange={(v) => onCambiar({ campo: v, respaldo })}
        size="sm"
        aria-label={`Dato del lead para ${token}`}
        aria-describedby={idCobertura}
        className="bg-surface-panel w-full min-w-0"
        placeholder="Elegir un dato del lead…"
        opciones={OPCIONES_CAMPO}
      />

      <label htmlFor={idInput} className="text-ink-faint text-[11px] whitespace-nowrap">
        Si falta
      </label>
      <Input
        id={idInput}
        value={respaldo}
        maxLength={LARGO_RESPALDO}
        autoComplete="off"
        placeholder="texto de respaldo"
        aria-describedby={idCobertura}
        onChange={(e) => onCambiar({ campo, respaldo: e.target.value })}
        className="h-7 text-[11.5px]"
      />

      <p
        id={idCobertura}
        className={cn(
          "col-span-3 col-start-2 text-[10.5px] leading-snug text-pretty",
          !campo || (sinDato > 0 && !respaldoLimpio) ? "text-caution" : "text-ink-ghost",
        )}
      >
        {!campo ? (
          "Falta elegir el dato."
        ) : total === 0 ? null : sinDato === 0 ? (
          <>
            Lo tienen los <span className="font-mono tabular-nums">{total}</span> de la muestra.
          </>
        ) : (
          <>
            <span className="font-mono tabular-nums">{sinDato}</span> de{" "}
            <span className="font-mono tabular-nums">{total}</span> en la muestra no lo tienen:{" "}
            {respaldoLimpio
              ? `les llega «${respaldoLimpio}».`
              : "sin respaldo, a esos no se les manda: Meta rechaza una variable vacía."}
          </>
        )}
      </p>
    </div>
  );
}
