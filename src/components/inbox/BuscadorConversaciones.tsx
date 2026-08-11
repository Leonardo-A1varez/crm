"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Close, SearchIcon } from "@/components/icons";
import { ChipFiltro } from "@/components/leads/ChipFiltro";
import { SelectorBuscable } from "@/components/leads/SelectorBuscable";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { StageBadge } from "@/components/shared/StageBadge";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { canalLabel } from "@/lib/ui/canal";
import { partirTexto } from "@/lib/ui/busqueda-hilo";
import { nombreVisible, sinNombre } from "@/lib/ui/lead";
import { stageLabel } from "@/lib/ui/stage";
import { formatearTelefono } from "@/lib/ui/telefono";
import { cn } from "@/lib/utils";
import { CANAL, CURRENT_STAGE } from "@/types/domain";
import { SESION_BUSCADA } from "@/types/inbox";
import { VENTANA_ACTIVIDAD } from "@/types/leads";
import type { Canal, CurrentStage } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { BusquedaPage, ResultadoBusqueda, SesionBuscada } from "@/types/inbox";
import type { EtiquetaOpcion, VentanaActividad } from "@/types/leads";

/** Lo que se manda a la Server Action además del texto. */
interface FiltrosBusqueda {
  canal?: Canal;
  etapa?: CurrentStage;
  etiquetaId?: UUID;
  actividad?: VentanaActividad;
  sesion?: SesionBuscada;
}

export type BuscarFn = (
  raw: unknown,
) => Promise<{ ok: true; pagina: BusquedaPage } | { ok: false; error: string }>;

/**
 * Cuánto esperar entre teclas antes de consultar. 250 ms es lo que tarda una
 * pausa deliberada al escribir: sin esto cada letra sería una vuelta a la DB
 * con un `ILIKE` sobre la tabla de mensajes.
 */
const ESPERA_MS = 250;

/** Espeja `MIN_CARACTERES` del service: con una letra no se busca nada. */
const MIN_CARACTERES = 2;

const LABEL_ACTIVIDAD: Record<VentanaActividad, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mas_30: "+30 días",
};

const LABEL_SESION: Record<SesionBuscada, string> = {
  activa: "Activa",
  cerrada: "Cerrada",
};

/**
 * El texto con las coincidencias marcadas, como **nodos**.
 *
 * Nunca `dangerouslySetInnerHTML`: esto es texto que escribió un tercero por
 * WhatsApp y pasarlo por el parser de HTML sería ejecutar lo que mande.
 * `partirTexto` es la misma función que resalta el buscador del hilo, así que
 * las dos búsquedas marcan exactamente lo mismo.
 */
function Resaltado({ texto, consulta }: { texto: string; consulta: string }) {
  return (
    <>
      {partirTexto(texto, consulta, 0).map((tramo, i) =>
        tramo.ordinal === null ? (
          <Fragment key={i}>{tramo.texto}</Fragment>
        ) : (
          <mark key={i} className="bg-brand/25 text-ink-primary rounded-[3px] px-[1px]">
            {tramo.texto}
          </mark>
        ),
      )}
    </>
  );
}

/** Fila de chips de una dimensión cerrada. Volver a tocar el puesto lo apaga. */
function GrupoChips<T extends string>({
  etiqueta,
  opciones,
  valor,
  rotulo,
  onElegir,
}: {
  etiqueta: string;
  opciones: readonly T[];
  valor: T | undefined;
  rotulo: (opcion: T) => string;
  onElegir: (valor: T | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={etiqueta}>
      <span className="text-ink-fainter mr-0.5 w-[52px] shrink-0 text-[10px]">{etiqueta}</span>
      {opciones.map((opcion) => (
        <ChipFiltro
          key={opcion}
          activo={valor === opcion}
          onClick={() => onElegir(valor === opcion ? undefined : opcion)}
        >
          {rotulo(opcion)}
        </ChipFiltro>
      ))}
    </div>
  );
}

function FilaResultado({
  resultado,
  consulta,
  onElegir,
}: {
  resultado: ResultadoBusqueda;
  consulta: string;
  onElegir: () => void;
}) {
  const { fragmento } = resultado;
  return (
    <Link
      href={`/inbox/${resultado.leadId}`}
      onClick={onElegir}
      className="hover:bg-surface-hover flex items-start gap-2.5 rounded-[10px] p-2 transition-colors"
    >
      <InitialsAvatar nombre={resultado.nombre} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[12.5px] font-[600]",
              sinNombre(resultado.nombre) ? "text-ink-faint" : "text-ink-primary",
            )}
          >
            <Resaltado texto={nombreVisible(resultado.nombre)} consulta={consulta} />
          </span>
          {resultado.currentStage ? (
            <StageBadge stage={resultado.currentStage} className="shrink-0 text-[9.5px]" />
          ) : (
            <span className="text-ink-fainter shrink-0 text-[9.5px]">Cerrada</span>
          )}
        </div>

        {fragmento ? (
          <p className="text-ink-dim mt-0.5 line-clamp-2 text-[11.5px] leading-[1.45]">
            {fragmento.direction === "out" ? <span className="text-ink-fainter">Vos: </span> : null}
            {fragmento.recortadoInicio ? "…" : null}
            <Resaltado texto={fragmento.texto} consulta={consulta} />
            {fragmento.recortadoFin ? "…" : null}
          </p>
        ) : null}

        <div className="text-ink-fainter mt-0.5 flex items-center gap-1.5 text-[10px]">
          <span className="truncate">
            <Resaltado texto={formatearTelefono(resultado.telefono)} consulta={consulta} />
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{canalLabel(resultado.canalOrigen)}</span>
          {resultado.mensajesCoincidentes > 1 ? (
            <>
              <span aria-hidden>·</span>
              <MonoMeta className="shrink-0 text-[9.5px]">
                {resultado.mensajesCoincidentes} mensajes
              </MonoMeta>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/**
 * Buscador de conversaciones del panel de lista: una mini-pantalla propia, no
 * un campo inline.
 *
 * **Busca en todo el historial, no filtra la lista de la pantalla.** La lista
 * del Inbox muestra solo sesiones activas; el mensaje que alguien busca suele
 * estar en una conversación que ya terminó, y por eso el filtro de "sesión"
 * ofrece activa Y cerrada. Los resultados que la purga de 29 días se llevó no
 * están, y RLS decide qué ve cada vendedor: las dos cosas son del dominio.
 *
 * Mismo lenguaje que el resto de los popovers del panel: flotante sobre el
 * contenido, `useCerrarAlSalir` en el contenedor (click afuera + Escape) y sin
 * botón "Cerrar" propio más que la cruz del encabezado.
 *
 * Con el selector de etapa o de etiqueta abierto, el primer Escape cierra solo
 * ése y el segundo esta mini-pantalla: lo resuelve `useCerrarAlSalir`, que sabe
 * cuál de los popovers abiertos es el más interno.
 */
export function BuscadorConversaciones({
  etiquetas,
  buscar,
}: {
  etiquetas: readonly EtiquetaOpcion[];
  /** La Server Action. Se inyecta para que `components/` no importe de `app/`. */
  buscar: BuscarFn;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [filtros, setFiltros] = useState<FiltrosBusqueda>({});
  const [pagina, setPagina] = useState<BusquedaPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, iniciarBusqueda] = useTransition();
  const contenedor = useRef<HTMLDivElement>(null);

  // Cada búsqueda lleva número: la respuesta de una consulta vieja que llega
  // tarde no puede pisar la de la última tecla.
  const turno = useRef(0);

  const cerrar = useCallback(() => setAbierto(false), []);
  useCerrarAlSalir(abierto, contenedor, cerrar);

  const consulta = q.trim();
  const suficiente = consulta.length >= MIN_CARACTERES;

  // El estado se limpia en el `onChange` del input y no acá: un `setState`
  // sincrónico dentro del efecto encadena renders (`react-hooks/set-state-in-effect`).
  useEffect(() => {
    if (!abierto || !suficiente) return;
    const mio = ++turno.current;
    const id = setTimeout(() => {
      iniciarBusqueda(async () => {
        const res = await buscar({ q: consulta, ...filtros });
        if (turno.current !== mio) return;
        if (res.ok) {
          setPagina(res.pagina);
          setError(null);
        } else {
          setPagina(null);
          setError(res.error);
        }
      });
    }, ESPERA_MS);
    return () => clearTimeout(id);
  }, [abierto, consulta, suficiente, filtros, buscar]);

  const opcionesEtiqueta = etiquetas.map((e) => ({
    valor: e.id,
    texto: e.nombre,
    adorno: (
      <span
        aria-hidden
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: e.color }}
      />
    ),
  }));

  const resultados = pagina?.resultados ?? [];

  return (
    // El `relative` abarca todo el ancho del encabezado y no solo el botón: la
    // mini-pantalla se ancla al borde izquierdo del panel, no al del disparador.
    // Anclada al botón arrancaría casi en el borde derecho del panel y quedaría
    // flotando sobre la conversación, desprendida de la lista que la abrió.
    <div ref={contenedor} className="relative">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className={cn(
          "border-line-card flex w-full items-center gap-1.5 rounded-[8px] border px-2 py-[5px] text-[11.5px] transition-colors",
          abierto
            ? "bg-surface-hover text-ink-primary"
            : "text-ink-faint hover:text-ink-body hover:bg-surface-elevated",
        )}
      >
        <SearchIcon size={13} className="shrink-0" />
        <span className="truncate">Buscar en todas las conversaciones</span>
      </button>

      {abierto ? (
        // `absolute` sobre el contenedor `relative`: el encabezado no puede
        // crecer al abrir, o abrir el buscador empujaría la lista hacia abajo.
        //
        // Los 420px desbordan a propósito los 322 del panel —una fila con el
        // fragmento del mensaje no entra en 322— y se apoyan sobre el panel de
        // la conversación. La cuenta, medida y relativa al shell (sin contar la
        // barra lateral): el contenedor arranca en x=14 (el `px-3.5` del
        // encabezado), así que el borde derecho cae en 434.
        // El shell mide 1164 de mínimo (322 del panel + 520 de mínimo de la
        // conversación + el Twin), y 434 < 1164: la mini-pantalla nunca le
        // agrega scroll horizontal al shell ni empuja el panel.
        <div className="border-line-control bg-surface-elevated absolute top-[calc(100%+6px)] left-0 z-40 flex max-h-[560px] w-[420px] flex-col rounded-[12px] border shadow-xl">
          <div className="border-line-layout flex items-center gap-2 border-b px-3 py-2.5">
            <SearchIcon size={15} className="text-ink-ghost shrink-0" />
            <input
              // `text` y no `search`: con `search` el Escape del navegador vacía
              // el campo y nunca llega al handler que cierra la mini-pantalla.
              type="text"
              value={q}
              autoFocus
              maxLength={80}
              onChange={(e) => {
                const valor = e.target.value;
                setQ(valor);
                // Volver por debajo del mínimo borra lo que había: si no, el
                // pie seguiría contando conversaciones de una búsqueda que ya
                // no se está haciendo. No se limpia en cada tecla a propósito
                // —dejaría la lista en blanco mientras se escribe—.
                if (valor.trim().length < MIN_CARACTERES) {
                  setPagina(null);
                  setError(null);
                }
              }}
              placeholder="Buscar mensajes, nombres, teléfonos…"
              aria-label="Buscar en todas las conversaciones"
              className="text-ink-body placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
            />
            <button
              type="button"
              onClick={cerrar}
              aria-label="Cerrar el buscador"
              className="text-ink-faint hover:text-ink-body hover:bg-surface-hover shrink-0 rounded-[6px] p-[3px] transition-colors"
            >
              <Close size={14} />
            </button>
          </div>

          <div className="border-line-layout flex flex-col gap-1.5 border-b px-3 py-2.5">
            <GrupoChips
              etiqueta="Canal"
              opciones={CANAL}
              valor={filtros.canal}
              rotulo={canalLabel}
              onElegir={(canal) => setFiltros((f) => ({ ...f, canal }))}
            />
            <GrupoChips
              etiqueta="Sesión"
              opciones={SESION_BUSCADA}
              valor={filtros.sesion}
              rotulo={(s) => LABEL_SESION[s]}
              onElegir={(sesion) => setFiltros((f) => ({ ...f, sesion }))}
            />
            <GrupoChips
              etiqueta="Actividad"
              opciones={VENTANA_ACTIVIDAD}
              valor={filtros.actividad}
              rotulo={(v) => LABEL_ACTIVIDAD[v]}
              onElegir={(actividad) => setFiltros((f) => ({ ...f, actividad }))}
            />
            {/*
              Etapa y Etiqueta van en filas propias y no juntas en una: el panel
              que abre `SelectorBuscable` mide 232px, se ancla al borde
              izquierdo de su disparador y no se reubica solo si no entra.

              Medido sobre el DOM (coordenadas de viewport, con esta
              mini-pantalla en 236…656): en fila propia los dos disparadores
              arrancan en x=307 y su panel va de 307 a 539, o sea 117px de aire
              contra el borde derecho. Compartiendo fila, el segundo disparador
              queda empujado a x=465 por el ancho del primero más su rótulo, y
              su panel termina en 697: 41px afuera, desbordando sobre el panel
              de la conversación.
            */}
            <div className="flex items-center gap-1">
              <span className="text-ink-fainter mr-0.5 w-[52px] shrink-0 text-[10px]">Etapa</span>
              <SelectorBuscable
                etiqueta="Etapa"
                vacio="Cualquiera"
                placeholder="Buscar etapa"
                sinOpciones="No hay etapas."
                opciones={CURRENT_STAGE.map((s) => ({ valor: s, texto: stageLabel(s) }))}
                valor={filtros.etapa}
                onElegir={(v) =>
                  setFiltros((f) => ({
                    ...f,
                    etapa: (v as CurrentStage | null) ?? undefined,
                  }))
                }
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-ink-fainter mr-0.5 w-[52px] shrink-0 text-[10px]">
                Etiqueta
              </span>
              <SelectorBuscable
                etiqueta="Etiqueta"
                vacio="Cualquiera"
                placeholder="Buscar etiqueta"
                sinOpciones="Todavía no hay etiquetas."
                opciones={opcionesEtiqueta}
                valor={filtros.etiquetaId}
                onElegir={(v) => setFiltros((f) => ({ ...f, etiquetaId: v ?? undefined }))}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {!suficiente ? (
              <p className="text-ink-faint px-2 py-6 text-center text-[11.5px] leading-relaxed">
                Escribí al menos {MIN_CARACTERES} caracteres. Busca en el historial completo:
                mensajes, nombre, perfil de WhatsApp y teléfono, también en conversaciones cerradas.
              </p>
            ) : error !== null ? (
              <p className="text-warn px-2 py-6 text-center text-[11.5px]">{error}</p>
            ) : pagina === null ? (
              <p className="text-ink-faint px-2 py-6 text-center text-[11.5px]">Buscando…</p>
            ) : resultados.length === 0 ? (
              <p className="text-ink-faint px-2 py-6 text-center text-[11.5px] leading-relaxed">
                Sin coincidencias. Los mensajes de conversaciones cerradas hace más de 29 días ya no
                están: el sistema los borra.
              </p>
            ) : (
              <ul aria-label="Resultados de la búsqueda" aria-busy={buscando}>
                {resultados.map((r) => (
                  <li key={r.leadId}>
                    <FilaResultado resultado={r} consulta={consulta} onElegir={cerrar} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pagina !== null && resultados.length > 0 ? (
            <div className="border-line-layout text-ink-fainter flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[10px]">
              <span>
                {resultados.length} {resultados.length === 1 ? "conversación" : "conversaciones"}
              </span>
              {pagina.truncado ? (
                <span className="text-caution">
                  Hay más: quedaron afuera. Afiná el texto o los filtros.
                </span>
              ) : pagina.soloDatosDelLead ? (
                <span>Con 2 letras no se busca dentro de los mensajes.</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
