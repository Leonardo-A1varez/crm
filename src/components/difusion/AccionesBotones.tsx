"use client";

import { SelectOpciones } from "@/components/shared/SelectOpciones";
import { cn } from "@/lib/utils";
import { Nota } from "./primitivas";
import type {
  AccionBoton,
  BotonRespuestaRapida,
  ConfigMensaje,
  OpcionCampo,
  TipoAccionBoton,
} from "./tipos";

interface DescriptorAccion {
  etiqueta: string;
  /** Qué pasa, en presente. Es lo único que importa para elegir entre una y otra. */
  consecuencia: string;
}

/**
 * Lo que se le puede colgar a un botón de respuesta rápida.
 *
 * Son pasos que el PRD pone en el catálogo de CRM (§9.4: etiquetar, escalar a
 * humano) y la supresión irreversible que decide para Difusión. Como el resto
 * de Difusión, ninguna tiene motor todavía: esto guarda la decisión, no la
 * ejecuta.
 *
 * **No está «asignar vendedor».** El modelo no tiene dónde guardar que un lead
 * es de un vendedor, así que la acción no tendría qué escribir.
 */
export const ACCION_BOTON: Record<TipoAccionBoton, DescriptorAccion> = {
  agente: {
    etiqueta: "La contesta el agente",
    consecuencia: "Entra a la bandeja como cualquier respuesta y la contesta el agente IA.",
  },
  humano: {
    etiqueta: "Pasa a una persona",
    consecuencia: "Se escala a una persona y la IA deja de contestar en esa conversación.",
  },
  etiquetar: {
    etiqueta: "Ponerle una etiqueta",
    consecuencia: "Se le pone la etiqueta y la conversación sigue con el agente.",
  },
  baja: {
    etiqueta: "Darlo de baja",
    consecuencia:
      "Queda fuera de toda difusión futura. Solo una persona puede revertirlo, y queda auditado.",
  },
};

const ORDEN_ACCIONES: readonly TipoAccionBoton[] = ["agente", "humano", "etiquetar", "baja"];

const OPCIONES_ACCION = ORDEN_ACCIONES.map((t) => ({ value: t, label: ACCION_BOTON[t].etiqueta }));

function nuevaAccion(tipo: TipoAccionBoton): AccionBoton {
  return tipo === "etiquetar" ? { tipo, etiqueta: null } : { tipo };
}

/**
 * Qué pasa cuando alguien toca cada botón.
 *
 * Es el patrón de Wati que adoptó el PRD (§8.4): cada botón de la plantilla
 * se configura con su propia acción dentro del mismo asistente, en vez de
 * mandar a armar un workflow aparte que alguien tiene que acordarse de
 * conectar con esta difusión.
 *
 * Cada botón se dibuja con la misma pastilla que en la vista previa, para que
 * se reconozca de un vistazo cuál es cuál. La acción arranca en «la contesta
 * el agente», que es lo que pasa con cualquier respuesta: un botón nunca queda
 * en un estado sin decidir.
 */
export function AccionesBotones({
  botones,
  acciones,
  etiquetas,
  onCambiar,
}: {
  botones: readonly BotonRespuestaRapida[];
  acciones: ConfigMensaje["botones"];
  /** Las etiquetas que existen. Vacía = «Ponerle una etiqueta» no tiene qué ofrecer, y lo dice. */
  etiquetas: readonly OpcionCampo[];
  onCambiar: (botonId: string, accion: AccionBoton) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ink-primary text-[13px] font-[650]">Botones</h2>
        <span className="text-ink-ghost text-[11px]">qué pasa cuando alguien toca cada uno</span>
      </div>

      <ul className="border-line-card bg-surface-card flex flex-col rounded-[11px] border">
        {botones.map((b, i) => (
          <li key={b.id} className={cn(i > 0 && "border-line-row border-t")}>
            <FilaBoton
              boton={b}
              accion={acciones[b.id] ?? { tipo: "agente" }}
              etiquetas={etiquetas}
              onCambiar={(a) => onCambiar(b.id, a)}
            />
          </li>
        ))}
      </ul>

      <Nota>
        Cualquier respuesta, toque el botón que toque, entra a la bandeja normal, abre la ventana de
        24 h y dispara «Difusión respondida». La acción del botón se suma a eso.
      </Nota>
    </section>
  );
}

function FilaBoton({
  boton,
  accion,
  etiquetas,
  onCambiar,
}: {
  boton: BotonRespuestaRapida;
  accion: AccionBoton;
  etiquetas: readonly OpcionCampo[];
  onCambiar: (accion: AccionBoton) => void;
}) {
  const idConsecuencia = `consecuencia-${boton.id}`;
  const etiquetaElegida =
    accion.tipo === "etiquetar"
      ? (etiquetas.find((e) => e.valor === accion.etiqueta) ?? null)
      : null;
  const faltaEtiqueta = accion.tipo === "etiquetar" && !etiquetaElegida;
  const consecuencia =
    accion.tipo !== "etiquetar"
      ? ACCION_BOTON[accion.tipo].consecuencia
      : etiquetaElegida
        ? `Se le pone «${etiquetaElegida.etiqueta}» y la conversación sigue con el agente.`
        : "Falta elegir la etiqueta.";

  return (
    <div
      role="group"
      aria-label={`Botón «${boton.texto}»`}
      className="grid grid-cols-[148px_12px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 px-3 py-3"
    >
      <span
        className="bg-surface-bubble-in text-info flex h-7 items-center justify-center truncate rounded-[8px] px-2 text-[11.5px] font-medium"
        title={boton.texto}
      >
        {boton.texto}
      </span>
      <span aria-hidden className="text-line-control text-center text-[11px]">
        →
      </span>

      <div className="flex min-w-0 items-center gap-2">
        <SelectOpciones
          value={accion.tipo}
          onValueChange={(v) => onCambiar(nuevaAccion(v))}
          size="sm"
          aria-label={`Qué pasa al tocar «${boton.texto}»`}
          aria-describedby={idConsecuencia}
          className="bg-surface-panel w-[184px] shrink-0"
          opciones={OPCIONES_ACCION}
        />

        {accion.tipo === "etiquetar" ? (
          <SelectorEtiqueta
            boton={boton.texto}
            valor={accion.etiqueta}
            etiquetas={etiquetas}
            onElegir={(etiqueta) => onCambiar({ tipo: "etiquetar", etiqueta })}
          />
        ) : null}
      </div>

      <p
        id={idConsecuencia}
        className={cn(
          "col-start-3 text-[10.5px] leading-snug text-pretty",
          faltaEtiqueta
            ? "text-caution"
            : accion.tipo === "baja"
              ? "text-danger"
              : "text-ink-ghost",
        )}
      >
        {consecuencia}
      </p>
    </div>
  );
}

function SelectorEtiqueta({
  boton,
  valor,
  etiquetas,
  onElegir,
}: {
  boton: string;
  valor: string | null;
  etiquetas: readonly OpcionCampo[];
  onElegir: (etiqueta: string) => void;
}) {
  if (etiquetas.length === 0) {
    // Un desplegable vacío se lee como «no hay nada que elegir acá» cuando en
    // realidad el catálogo no cargó o todavía no se creó ninguna etiqueta.
    return <span className="text-ink-ghost text-[11px]">Sin etiquetas cargadas</span>;
  }

  return (
    <SelectOpciones
      value={valor}
      onValueChange={onElegir}
      size="sm"
      aria-label={`Etiqueta para «${boton}»`}
      className="bg-surface-panel min-w-0 flex-1"
      placeholder="Elegir etiqueta…"
      opciones={etiquetas.map((e) => ({
        value: e.valor,
        label: e.etiqueta,
        adorno: e.color ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 self-center rounded-full"
            style={{ backgroundColor: e.color }}
          />
        ) : null,
      }))}
    />
  );
}
