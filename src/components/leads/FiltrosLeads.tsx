"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Close, Tune } from "@/components/icons";
import { ChannelDot } from "@/components/shared/ChannelDot";
import {
  actividadLabel,
  contarFiltrosActivos,
  motivoPerdidaLabel,
  PARAM,
  parseFiltrosLeads,
  resultadoLabel,
} from "@/lib/ui/filtros-leads";
import { canalLabel } from "@/lib/ui/canal";
import { stageLabel } from "@/lib/ui/stage";
import { cn } from "@/lib/utils";
import { CANAL, CURRENT_STAGE, MOTIVO_PERDIDA, RESULTADO } from "@/types/domain";
import { VENTANA_ACTIVIDAD } from "@/types/leads";
import type { EtiquetaOpcion } from "@/types/leads";
import type { ReactNode } from "react";

const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-[20px] border px-[10px] py-[4.5px] text-[11.5px] font-[550] transition-colors";
const CHIP_ON = "bg-surface-avatar border-line-control text-ink-primary";
const CHIP_OFF = "border-line-card text-ink-dim bg-transparent hover:text-ink-secondary";

function Chip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(CHIP_BASE, activo ? CHIP_ON : CHIP_OFF)}
    >
      {children}
    </button>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={titulo} className="flex min-w-0 items-baseline gap-2.5">
      <span className="text-ink-faint w-[86px] shrink-0 text-right font-mono text-[9px] font-semibold tracking-[0.13em] uppercase">
        {titulo}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * El desplegable de marca/modelo es un `<select>` nativo y no chips.
 *
 * Es la única dimensión de vocabulario abierto —sale de los datos, no de un
 * enum— y con mil leads en pantalla puede traer decenas de marcas: como chips
 * la barra de filtros taparía la lista que filtra. El nativo además trae gratis
 * el teclado y el scroll de la lista larga.
 */
function SelectorTexto({
  etiqueta,
  valor,
  opciones,
  vacio,
  onChange,
}: {
  etiqueta: string;
  valor: string | undefined;
  opciones: string[];
  vacio: string;
  onChange: (valor: string | null) => void;
}) {
  return (
    <select
      aria-label={etiqueta}
      value={valor ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className={cn(
        CHIP_BASE,
        "appearance-none pr-[10px] outline-none",
        valor !== undefined ? CHIP_ON : CHIP_OFF,
        // El popup del `<select>` lo pinta el sistema: sin esto las opciones
        // salen en claro sobre el panel oscuro.
        "[&>option]:bg-surface-panel [&>option]:text-ink-body",
      )}
    >
      <option value="">{vacio}</option>
      {opciones.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/**
 * Chips de filtro de `/leads`. Todos combinables y todos en la URL: lo que se
 * ve en pantalla se comparte pegando el link.
 *
 * Navega con `router.replace` —no `push`— porque tocar seis chips seguidos no
 * son seis pasos atrás para el vendedor; y la pantalla es un server component,
 * así que cada `replace` es el re-fetch con los filtros nuevos, sin estado
 * duplicado de este lado.
 */
export function FiltrosLeads({
  etiquetas,
  marcas,
  modelos,
}: {
  etiquetas: EtiquetaOpcion[];
  marcas: string[];
  modelos: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filtros = parseFiltrosLeads(Object.fromEntries(searchParams.entries()));
  const activos = contarFiltrosActivos(filtros);
  // Plegada de entrada, incluso llegando por un link con filtros puestos:
  // desplegada mide 334px medidos —un tercio de la pantalla— y el resumen de
  // acá abajo ya dice qué está filtrando en 49px.
  const [abierto, setAbierto] = useState(false);

  function navegar(cambios: readonly (readonly [string, string | null])[]) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [clave, valor] of cambios) {
      if (valor === null) params.delete(clave);
      else params.set(clave, valor);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  /** Un chip de opción: volver a tocarlo lo apaga, que es como se limpia uno solo. */
  function alternar(clave: string, valor: string, activo: boolean) {
    navegar([[clave, activo ? null : valor]]);
  }

  function limpiarTodo() {
    // `q` sobrevive: es la búsqueda, no un chip, y borrarla desde acá sería
    // borrar lo que el vendedor escribió sin que lo haya pedido.
    navegar([
      [PARAM.duplicados, null],
      [PARAM.canal, null],
      [PARAM.etapa, null],
      [PARAM.etiqueta, null],
      [PARAM.sesion, null],
      [PARAM.resultado, null],
      [PARAM.motivo, null],
      [PARAM.actividad, null],
      [PARAM.sinResponder, null],
      [PARAM.marca, null],
      [PARAM.modelo, null],
    ]);
  }

  return (
    <section
      aria-label="Filtros de leads"
      className="border-line-layout bg-surface-panel shrink-0 border-b px-5 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
          className={cn(CHIP_BASE, activos > 0 ? CHIP_ON : CHIP_OFF)}
        >
          <Tune size={13} className="shrink-0" />
          Filtros
          {activos > 0 ? (
            <span className="bg-brand text-brand-ink inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 font-mono text-[9.5px] font-semibold">
              {activos}
            </span>
          ) : null}
        </button>

        {activos > 0 ? (
          <button
            type="button"
            onClick={limpiarTodo}
            className="text-ink-faint hover:text-ink-secondary shrink-0 text-[11.5px] font-[550] underline-offset-2 hover:underline"
          >
            Limpiar
          </button>
        ) : null}

        {/* Resumen plegado: qué está filtrando y cómo sacarlo, sin abrir nada. */}
        {!abierto
          ? resumen(filtros, etiquetas).map(({ clave, texto }) => (
              <span key={clave} className={cn(CHIP_BASE, CHIP_ON)}>
                {texto}
                <button
                  type="button"
                  aria-label={`Quitar filtro ${texto}`}
                  onClick={() => navegar([[clave, null]])}
                  className="text-ink-faint hover:text-ink-primary -mr-[3px] shrink-0"
                >
                  <Close size={12} />
                </button>
              </span>
            ))
          : null}
      </div>

      {abierto ? (
        <div className="mt-2.5 flex flex-col gap-2">
          <Grupo titulo="Actividad">
            {VENTANA_ACTIVIDAD.map((v) => (
              <Chip
                key={v}
                activo={filtros.actividad === v}
                onClick={() => alternar(PARAM.actividad, v, filtros.actividad === v)}
              >
                {actividadLabel(v)}
              </Chip>
            ))}
            <Chip
              activo={filtros.sinResponder === true}
              onClick={() => alternar(PARAM.sinResponder, "1", filtros.sinResponder === true)}
            >
              Sin responder
            </Chip>
          </Grupo>

          <Grupo titulo="Sesión">
            <Chip
              activo={filtros.conSesionActiva === true}
              onClick={() => alternar(PARAM.sesion, "activa", filtros.conSesionActiva === true)}
            >
              Con sesión activa
            </Chip>
            <Chip
              activo={filtros.conSesionActiva === false}
              onClick={() => alternar(PARAM.sesion, "cerrada", filtros.conSesionActiva === false)}
            >
              Sin sesión activa
            </Chip>
            <Chip
              activo={filtros.soloDuplicados === true}
              onClick={() => alternar(PARAM.duplicados, "1", filtros.soloDuplicados === true)}
            >
              Posibles duplicados
            </Chip>
          </Grupo>

          <Grupo titulo="Etapa">
            {CURRENT_STAGE.map((s) => (
              <Chip
                key={s}
                activo={filtros.etapa === s}
                onClick={() => alternar(PARAM.etapa, s, filtros.etapa === s)}
              >
                {stageLabel(s)}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Cierre">
            {RESULTADO.map((r) => (
              <Chip
                key={r}
                activo={filtros.resultado === r}
                onClick={() => alternar(PARAM.resultado, r, filtros.resultado === r)}
              >
                {resultadoLabel(r)}
              </Chip>
            ))}
            {MOTIVO_PERDIDA.map((m) => (
              <Chip
                key={m}
                activo={filtros.motivoPerdida === m}
                onClick={() => alternar(PARAM.motivo, m, filtros.motivoPerdida === m)}
              >
                {motivoPerdidaLabel(m)}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Canal">
            {CANAL.map((c) => (
              <Chip
                key={c}
                activo={filtros.canal === c}
                onClick={() => alternar(PARAM.canal, c, filtros.canal === c)}
              >
                <ChannelDot canal={c} size={6} />
                {canalLabel(c)}
              </Chip>
            ))}
          </Grupo>

          {etiquetas.length > 0 ? (
            <Grupo titulo="Etiquetas">
              {etiquetas.map((e) => (
                <Chip
                  key={e.id}
                  activo={filtros.etiquetaId === e.id}
                  onClick={() => alternar(PARAM.etiqueta, e.id, filtros.etiquetaId === e.id)}
                >
                  <span
                    aria-hidden
                    className="size-[6px] shrink-0 rounded-full"
                    style={{ backgroundColor: e.color }}
                  />
                  {e.nombre}
                </Chip>
              ))}
            </Grupo>
          ) : null}

          <Grupo titulo="Vehículo">
            <SelectorTexto
              etiqueta="Marca del vehículo"
              valor={filtros.vehiculoMarca}
              opciones={marcas}
              vacio="Marca"
              // Cambiar de marca invalida el modelo elegido: "Corolla" no existe
              // bajo "Ford" y dejarlo puesto vaciaría la lista sin explicación.
              onChange={(v) =>
                navegar([
                  [PARAM.marca, v],
                  [PARAM.modelo, null],
                ])
              }
            />
            <SelectorTexto
              etiqueta="Modelo del vehículo"
              valor={filtros.vehiculoModelo}
              opciones={modelos}
              vacio="Modelo"
              onChange={(v) => navegar([[PARAM.modelo, v]])}
            />
          </Grupo>
        </div>
      ) : null}
    </section>
  );
}

/** Un renglón por filtro puesto, con el nombre de la dimensión adelante. */
function resumen(
  filtros: ReturnType<typeof parseFiltrosLeads>,
  etiquetas: EtiquetaOpcion[],
): { clave: string; texto: string }[] {
  const out: { clave: string; texto: string }[] = [];
  if (filtros.actividad)
    out.push({ clave: PARAM.actividad, texto: actividadLabel(filtros.actividad) });
  if (filtros.sinResponder) out.push({ clave: PARAM.sinResponder, texto: "Sin responder" });
  if (filtros.conSesionActiva !== undefined) {
    out.push({
      clave: PARAM.sesion,
      texto: filtros.conSesionActiva ? "Con sesión activa" : "Sin sesión activa",
    });
  }
  if (filtros.soloDuplicados) out.push({ clave: PARAM.duplicados, texto: "Posibles duplicados" });
  if (filtros.etapa) out.push({ clave: PARAM.etapa, texto: `Etapa: ${stageLabel(filtros.etapa)}` });
  if (filtros.resultado) {
    out.push({ clave: PARAM.resultado, texto: resultadoLabel(filtros.resultado) });
  }
  if (filtros.motivoPerdida) {
    out.push({
      clave: PARAM.motivo,
      texto: `Motivo: ${motivoPerdidaLabel(filtros.motivoPerdida)}`,
    });
  }
  if (filtros.canal) out.push({ clave: PARAM.canal, texto: canalLabel(filtros.canal) });
  if (filtros.etiquetaId !== undefined) {
    const nombre = etiquetas.find((e) => e.id === filtros.etiquetaId)?.nombre;
    out.push({ clave: PARAM.etiqueta, texto: `Etiqueta: ${nombre ?? "—"}` });
  }
  if (filtros.vehiculoMarca) out.push({ clave: PARAM.marca, texto: filtros.vehiculoMarca });
  if (filtros.vehiculoModelo) out.push({ clave: PARAM.modelo, texto: filtros.vehiculoModelo });
  return out;
}
