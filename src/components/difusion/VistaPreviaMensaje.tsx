"use client";

import { useState } from "react";
import { KeyboardArrowDown } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { etiquetaCampo } from "./campos-mensaje";
import { CostoEstimado } from "./CostoEstimado";
import { camposFaltantes, componerTexto, type PiezaMensaje, type Resolucion } from "./mensaje";
import { CATEGORIA_PLANTILLA, COLOR_RUTA, tinte } from "./paleta";
import { CodigoMeta, Nota, Punto } from "./primitivas";
import { BadgeCategoria } from "./SelectorPlantilla";
import { idRespaldo } from "./VariablesPlantilla";
import type {
  CampoVariable,
  ConfigMensaje,
  Destinatario,
  LineaCosto,
  Plantilla,
  ValoresLead,
} from "./tipos";

/**
 * Las tres marcas de lo que no es texto aprobado. Cada una además tiene su
 * forma: el respaldo va subrayado a trazos y la falta se escribe con palabras,
 * así que ninguna depende solo del color.
 */
const MARCA = {
  valor: tinte("var(--color-info)", 18),
  respaldo: tinte("var(--color-caution)", 20),
  falta: tinte("var(--color-danger)", 12),
} as const;

type PiezaVariable = Extract<PiezaMensaje, { tipo: "variable" }>;

function minusculaInicial(texto: string): string {
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

/** «modelo del vehículo», «modelo del vehículo ni lo que consultó». */
function enPalabras(campos: readonly CampoVariable[]): string {
  const nombres = campos.map((c) => minusculaInicial(etiquetaCampo(c)));
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} ni ${nombres.at(-1) ?? ""}`;
}

/**
 * El mensaje tal como le llega a una persona concreta de la audiencia.
 *
 * Contra un lead de la audiencia y no contra un ejemplo inventado, porque lo
 * que rompe un mensaje no es el texto aprobado: es el dato.
 *
 * Hoy el texto de la plantilla no se lee de Meta (`cuerpo` en `null`), y en
 * ese caso la vista previa lo dice en vez de mostrar un mensaje que no es el
 * que va a salir. La ruta de cada persona y el costo sí se muestran: salen del
 * planificador, no del texto.
 */
export function VistaPreviaMensaje({
  plantilla,
  config,
  destinatarios,
  valoresPorLead,
  lineasCosto,
}: {
  plantilla: Plantilla | null;
  config: ConfigMensaje | null;
  /** La muestra de la audiencia: la gente contra la que se previsualiza. */
  destinatarios: readonly Destinatario[];
  valoresPorLead: Readonly<Record<string, ValoresLead>>;
  lineasCosto: readonly LineaCosto[] | null;
}) {
  const [actual, setActual] = useState(0);
  const total = destinatarios.length;
  const lead = destinatarios[actual] ?? destinatarios[0] ?? null;

  const huecos =
    plantilla && config
      ? destinatarios.map((d) => camposFaltantes(plantilla, config, valoresPorLead[d.leadId]))
      : [];
  const conHuecos = huecos.filter((h) => h.length > 0).length;
  const huecosDelLead = huecos[actual] ?? [];
  const piezas =
    plantilla && plantilla.cuerpo !== null && config && lead
      ? componerTexto(plantilla.cuerpo, config.variables, valoresPorLead[lead.leadId])
      : null;
  const primerHueco = piezas?.find(
    (p): p is PiezaVariable => p.tipo === "variable" && p.resolucion.tipo === "falta",
  );

  function irA(i: number) {
    if (total > 0) setActual(((i % total) + total) % total);
  }

  function siguienteConHuecos() {
    for (let salto = 1; salto <= total; salto++) {
      const i = (actual + salto) % total;
      if ((huecos[i]?.length ?? 0) > 0) {
        setActual(i);
        return;
      }
    }
  }

  return (
    <aside
      aria-label="Vista previa del mensaje"
      className="border-line-layout bg-surface-panel flex w-[340px] shrink-0 flex-col overflow-auto border-l"
    >
      <div className="border-line-row flex flex-col gap-3 border-b p-4">
        <Eyebrow>Vista previa</Eyebrow>

        {lead ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-ink-faint shrink-0 text-[11px]">Así le llega a</span>
              <Select
                items={Object.fromEntries(
                  destinatarios.map((d) => [d.leadId, d.nombre || "Sin nombre"]),
                )}
                value={lead.leadId}
                onValueChange={(v) => {
                  const i = destinatarios.findIndex((d) => d.leadId === v);
                  if (i >= 0) setActual(i);
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Persona de la audiencia para la vista previa"
                  className="bg-surface-card min-w-0 flex-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {destinatarios.map((d, i) => (
                    <SelectItem key={d.leadId} value={d.leadId}>
                      {d.nombre || "Sin nombre"}
                      {(huecos[i]?.length ?? 0) > 0 ? (
                        <span className="text-caution font-mono text-[10px]">sin dato</span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Anterior de la muestra"
                onClick={() => irA(actual - 1)}
              >
                <KeyboardArrowDown className="rotate-90" aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Siguiente de la muestra"
                onClick={() => irA(actual + 1)}
              >
                <KeyboardArrowDown className="-rotate-90" aria-hidden />
              </Button>
            </div>
            <span className="text-ink-ghost truncate font-mono text-[10px]">
              {lead.telefono}
              {lead.vehiculo ? ` · ${lead.vehiculo}` : ""}
            </span>
            <RutaDelLead lead={lead} plantilla={plantilla} />
          </div>
        ) : (
          <Nota>Todavía no hay nadie de la audiencia contra quien previsualizar.</Nota>
        )}

        {plantilla === null ? (
          <div className="border-line-control flex flex-col items-center gap-1.5 rounded-[11px] border border-dashed px-4 py-8 text-center">
            <p className="text-ink-secondary text-[12px] font-[650]">Todavía no hay mensaje</p>
            <p className="text-ink-faint text-[11px] leading-relaxed text-balance">
              Elegí una plantilla y acá aparece qué se sabe de ella.
            </p>
          </div>
        ) : plantilla.cuerpo === null ? (
          <div className="border-line-control flex flex-col gap-1.5 rounded-[11px] border border-dashed px-3.5 py-4">
            <p className="text-ink-secondary font-mono text-[11.5px] font-medium">
              {plantilla.nombre}
            </p>
            <p className="text-ink-faint text-[11px] leading-relaxed text-pretty">
              El texto no se ve acá: la lectura de plantillas de Meta que usa este CRM no lo trae.
              Revisalo en el administrador de WhatsApp antes de programar.
            </p>
          </div>
        ) : piezas && lead ? (
          <>
            <figure className="bg-surface-chat border-line-row flex flex-col gap-1 rounded-[11px] border p-3">
              <figcaption className="sr-only">Mensaje como le llega a {lead.nombre}</figcaption>
              <div className="bg-surface-bubble-in text-ink-body max-w-[94%] rounded-[10px] rounded-tl-[3px] px-3 py-2.5">
                {plantilla.encabezado ? (
                  <p className="text-ink-primary mb-1 text-[12px] font-[650]">
                    {plantilla.encabezado}
                  </p>
                ) : null}
                <p className="text-[12px] leading-[1.65] text-pretty whitespace-pre-line">
                  {piezas.map((p, i) =>
                    p.tipo === "texto" ? (
                      <span key={i}>{p.texto}</span>
                    ) : (
                      <MarcaVariable key={i} indice={p.indice} resolucion={p.resolucion} />
                    ),
                  )}
                </p>
                {plantilla.pie ? (
                  <p className="text-ink-faint mt-1.5 text-[10.5px] leading-snug">
                    {plantilla.pie}
                  </p>
                ) : null}
              </div>
              {plantilla.botones.length > 0 ? (
                <ul aria-label="Botones de respuesta" className="flex max-w-[94%] flex-col gap-1">
                  {plantilla.botones.map((b) => (
                    <li
                      key={b.id}
                      className="bg-surface-bubble-in text-info rounded-[9px] px-2 py-1.5 text-center text-[11.5px] font-medium"
                    >
                      {b.texto}
                    </li>
                  ))}
                </ul>
              ) : null}
            </figure>

            {piezas.some((p) => p.tipo === "variable") ? <Leyenda /> : null}

            <div role="status">
              {huecosDelLead.length > 0 && primerHueco ? (
                <div
                  className="flex flex-col gap-2 rounded-[9px] border px-3 py-2.5"
                  style={{
                    borderColor: tinte("var(--color-caution)", 34),
                    backgroundColor: tinte("var(--color-caution)", 8),
                  }}
                >
                  <p className="text-caution text-[11.5px] leading-snug font-[650]">
                    A {lead.nombre} no se le manda:{" "}
                    {huecosDelLead.length === 1
                      ? "queda una variable vacía"
                      : `quedan ${huecosDelLead.length} variables vacías`}
                  </p>
                  <p className="text-ink-secondary text-[11px] leading-relaxed text-pretty">
                    No tiene {enPalabras(huecosDelLead)}. Poné un respaldo o elegí otro dato.
                  </p>
                  <Button
                    variant="outline"
                    size="xs"
                    className="w-fit"
                    onClick={() => document.getElementById(idRespaldo(primerHueco.indice))?.focus()}
                  >
                    Poner respaldo en {`{{${primerHueco.indice}}}`}
                  </Button>
                </div>
              ) : null}
            </div>

            {conHuecos > 0 ? (
              <p className="text-ink-ghost text-[10.5px] leading-relaxed">
                En la muestra, <span className="font-mono tabular-nums">{conHuecos}</span> de{" "}
                <span className="font-mono tabular-nums">{total}</span> reciben algún hueco.{" "}
                <button
                  type="button"
                  onClick={siguienteConHuecos}
                  className="text-ink-secondary hover:text-ink-primary focus-visible:ring-ring/50 rounded-[3px] underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
                >
                  Ver el siguiente
                </button>
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <Eyebrow>Categoría y costo</Eyebrow>
        {plantilla && lineasCosto ? (
          <>
            <CategoriaDePlantilla plantilla={plantilla} />
            <CostoEstimado lineas={lineasCosto} />
          </>
        ) : (
          <Nota>
            El costo depende de la categoría de la plantilla y del reparto de la audiencia, así que
            aparece cuando están los dos.
          </Nota>
        )}
      </div>
    </aside>
  );
}

function RutaDelLead({ lead, plantilla }: { lead: Destinatario; plantilla: Plantilla | null }) {
  const abierta = lead.ruta === "ventana_abierta";
  return (
    <p className="text-ink-dim flex items-center gap-1.5 text-[11px] leading-snug">
      <Punto color={COLOR_RUTA[lead.ruta]} />
      {abierta
        ? `Tiene la ventana abierta: le llega la misma plantilla${
            plantilla && plantilla.categoria === "marketing" ? ", y se cobra igual" : ""
          }.`
        : `Fuera de la ventana: le llega como plantilla${
            plantilla
              ? ` de ${CATEGORIA_PLANTILLA[plantilla.categoria].etiqueta.toLowerCase()}`
              : ""
          }.`}
    </p>
  );
}

function MarcaVariable({ indice, resolucion }: { indice: number; resolucion: Resolucion }) {
  switch (resolucion.tipo) {
    case "valor":
      return (
        <mark
          className="text-ink-primary rounded-[3px] box-decoration-clone px-[2px]"
          style={{ backgroundColor: MARCA.valor }}
        >
          {resolucion.texto}
        </mark>
      );
    case "respaldo":
      return (
        <mark
          className="text-ink-primary rounded-[3px] box-decoration-clone px-[2px] underline decoration-dashed underline-offset-[3px]"
          style={{ backgroundColor: MARCA.respaldo, textDecorationColor: "var(--color-caution)" }}
        >
          {resolucion.texto}
        </mark>
      );
    case "falta":
      return (
        <span
          className="text-danger rounded-[3px] box-decoration-clone px-1 font-mono text-[10.5px]"
          style={{ backgroundColor: MARCA.falta }}
        >
          falta · {etiquetaCampo(resolucion.campo)}
        </span>
      );
    case "sin_asignar":
      return (
        <span className="text-caution border-caution rounded-[3px] border border-dashed px-1 font-mono text-[10.5px]">
          {`{{${indice}}}`}
        </span>
      );
  }
}

function Leyenda() {
  return (
    <ul
      aria-label="Qué significa cada marca"
      className="text-ink-ghost flex flex-wrap gap-x-3 gap-y-1 text-[10px]"
    >
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2.5 w-3.5 rounded-[3px]"
          style={{ backgroundColor: MARCA.valor }}
        />
        dato del lead
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="border-caution h-2.5 w-3.5 rounded-[3px] border-b border-dashed"
          style={{ backgroundColor: MARCA.respaldo }}
        />
        respaldo
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2.5 w-3.5 rounded-[3px]"
          style={{ backgroundColor: MARCA.falta }}
        />
        falta el dato
      </li>
    </ul>
  );
}

function CategoriaDePlantilla({ plantilla }: { plantilla: Plantilla }) {
  const categoria = CATEGORIA_PLANTILLA[plantilla.categoria];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <BadgeCategoria categoria={plantilla.categoria} />
        <span className="text-ink-secondary text-[11.5px] leading-snug">{categoria.cobro}</span>
      </div>
      <p className="text-ink-dim text-[11px] leading-relaxed text-pretty">
        {categoria.cuentaEnTope ? (
          <>
            Cuenta contra el tope de marketing que Meta le pone a cada persona: si en los últimos 7
            días ya le llegaron promociones de varios negocios, la rebota con{" "}
            <CodigoMeta codigo="131049" />.
          </>
        ) : (
          "No cuenta contra el tope de marketing que Meta le pone a cada persona."
        )}
      </p>
      <Nota>La categoría la decide Meta al aprobarla, no el nombre de la plantilla.</Nota>
    </div>
  );
}
