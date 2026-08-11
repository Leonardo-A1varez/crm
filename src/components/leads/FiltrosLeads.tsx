"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Close, Tune } from "@/components/icons";
import { ChipFiltro, CHIP_BASE, CHIP_OFF, CHIP_ON } from "@/components/leads/ChipFiltro";
import { SelectorBuscable } from "@/components/leads/SelectorBuscable";
import { ChannelDot } from "@/components/shared/ChannelDot";
import {
  contarFiltrosActivos,
  PARAM,
  PARAMS_VEHICULO,
  parseFiltrosLeads,
  resultadoLabel,
  vehiculoLabel,
} from "@/lib/ui/filtros-leads";
import { motivoPerdidaLabel } from "@/lib/ui/motivo-perdida";
import { canalLabel } from "@/lib/ui/canal";
import { stageLabel } from "@/lib/ui/stage";
import { cn } from "@/lib/utils";
import { CANAL, CURRENT_STAGE, RESULTADO } from "@/types/domain";
import type { OpcionBuscable } from "@/components/leads/SelectorBuscable";
import type { MotivoPerdida } from "@/types/domain";
import type { EtiquetaOpcion, VehiculoOpcion } from "@/types/leads";
import type { ReactNode } from "react";

/**
 * Cómo se codifica una opción del selector de cierre.
 *
 * El control es uno solo —"cómo terminó"— pero escribe dos params distintos:
 * "Ganado" es un resultado y "Perdido: Precio" es un motivo. El prefijo dice
 * cuál de los dos, y elegir uno siempre limpia el otro: `resultado=exito` con
 * `motivo=precio` es una combinación que no puede devolver nada.
 */
const PREFIJO_RESULTADO = "resultado:";
const PREFIJO_MOTIVO = "motivo:";

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
 * Chips de filtro de `/leads`. Todos combinables y todos en la URL: lo que se
 * ve en pantalla se comparte pegando el link.
 *
 * Tres dimensiones no son chips sino mini-pantallas con buscador —cierre,
 * etiquetas y vehículos—: son las que crecen y se reducen con los datos, y
 * como chips inline llenaban la barra con una lista que cambia sola. Las otras
 * dos son enums cerrados de pocos valores y siguen siendo chips, que se leen y
 * se tocan en un gesto.
 *
 * Navega con `router.replace` —no `push`— porque tocar seis chips seguidos no
 * son seis pasos atrás para el vendedor; y la pantalla es un server component,
 * así que cada `replace` es el re-fetch con los filtros nuevos, sin estado
 * duplicado de este lado.
 */
export function FiltrosLeads({
  etiquetas,
  vehiculos,
  motivos,
}: {
  etiquetas: EtiquetaOpcion[];
  vehiculos: VehiculoOpcion[];
  /** Motivos presentes en los datos, no el enum entero. */
  motivos: MotivoPerdida[];
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
      [PARAM.resultado, null],
      [PARAM.motivo, null],
      [PARAM.sinResponder, null],
      ...PARAMS_VEHICULO.map((clave) => [clave, null] as const),
    ]);
  }

  const opcionesCierre: OpcionBuscable[] = [
    ...RESULTADO.map((r) => ({ valor: `${PREFIJO_RESULTADO}${r}`, texto: resultadoLabel(r) })),
    ...motivos.map((m) => ({
      valor: `${PREFIJO_MOTIVO}${m}`,
      texto: `Perdido: ${motivoPerdidaLabel(m)}`,
    })),
  ];
  const valorCierre =
    filtros.motivoPerdida !== undefined
      ? `${PREFIJO_MOTIVO}${filtros.motivoPerdida}`
      : filtros.resultado !== undefined
        ? `${PREFIJO_RESULTADO}${filtros.resultado}`
        : undefined;

  function elegirCierre(valor: string | null) {
    if (valor === null) {
      navegar([
        [PARAM.resultado, null],
        [PARAM.motivo, null],
      ]);
      return;
    }
    navegar(
      valor.startsWith(PREFIJO_MOTIVO)
        ? [
            [PARAM.resultado, null],
            [PARAM.motivo, valor.slice(PREFIJO_MOTIVO.length)],
          ]
        : [
            [PARAM.resultado, valor.slice(PREFIJO_RESULTADO.length)],
            [PARAM.motivo, null],
          ],
    );
  }

  const opcionesEtiquetas: OpcionBuscable[] = etiquetas.map((e) => ({
    valor: e.id,
    texto: e.nombre,
    adorno: (
      <span
        aria-hidden
        className="size-[6px] shrink-0 rounded-full"
        style={{ backgroundColor: e.color }}
      />
    ),
  }));

  const opcionesVehiculos: OpcionBuscable[] = vehiculos.map((v) => ({
    valor: v.clave,
    texto: v.texto,
  }));
  const vehiculoElegido = vehiculos.find(
    (v) =>
      v.marca === filtros.vehiculoMarca &&
      v.modelo === filtros.vehiculoModelo &&
      v.anio === (filtros.vehiculoAnio ?? 0),
  );

  function elegirVehiculo(clave: string | null) {
    const v = clave === null ? undefined : vehiculos.find((o) => o.clave === clave);
    if (!v) {
      navegar(PARAMS_VEHICULO.map((p) => [p, null] as const));
      return;
    }
    navegar([
      [PARAM.marca, v.marca || null],
      [PARAM.modelo, v.modelo || null],
      [PARAM.anio, v.anio > 0 ? String(v.anio) : null],
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
          ? resumen(filtros, etiquetas).map(({ claves, texto }) => (
              <span key={claves.join("+")} className={cn(CHIP_BASE, CHIP_ON)}>
                {texto}
                <button
                  type="button"
                  aria-label={`Quitar filtro ${texto}`}
                  onClick={() => navegar(claves.map((c) => [c, null] as const))}
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
          <Grupo titulo="Etapa">
            {CURRENT_STAGE.map((s) => (
              <ChipFiltro
                key={s}
                activo={filtros.etapa === s}
                onClick={() => alternar(PARAM.etapa, s, filtros.etapa === s)}
              >
                {stageLabel(s)}
              </ChipFiltro>
            ))}
          </Grupo>

          <Grupo titulo="Cierre">
            <SelectorBuscable
              etiqueta="Cierre"
              vacio="Cómo terminó"
              placeholder="Buscar cierre o motivo…"
              opciones={opcionesCierre}
              valor={valorCierre}
              sinOpciones="Todavía no hay sesiones cerradas."
              onElegir={elegirCierre}
            />
          </Grupo>

          <Grupo titulo="Canales">
            {CANAL.map((c) => (
              <ChipFiltro
                key={c}
                activo={filtros.canal === c}
                onClick={() => alternar(PARAM.canal, c, filtros.canal === c)}
              >
                <ChannelDot canal={c} size={6} />
                {canalLabel(c)}
              </ChipFiltro>
            ))}
          </Grupo>

          <Grupo titulo="Etiquetas">
            <SelectorBuscable
              etiqueta="Etiquetas"
              vacio="Etiqueta"
              placeholder="Buscar etiqueta…"
              opciones={opcionesEtiquetas}
              valor={filtros.etiquetaId}
              sinOpciones="Todavía no hay etiquetas."
              onElegir={(id) => navegar([[PARAM.etiqueta, id]])}
            />
          </Grupo>

          <Grupo titulo="Vehículos">
            <SelectorBuscable
              etiqueta="Vehículos"
              vacio="Vehículo"
              placeholder="Buscar marca, modelo o año…"
              opciones={opcionesVehiculos}
              valor={vehiculoElegido?.clave}
              textoActivo={vehiculoLabel(filtros)}
              sinOpciones="Ningún lead del resultado tiene vehículo cargado."
              onElegir={elegirVehiculo}
            />
          </Grupo>

          {/* Las dos banderas que no son una dimensión sino un pendiente: no
              recortan por un atributo del lead sino por trabajo sin hacer. */}
          <Grupo titulo="Pendientes">
            <ChipFiltro
              activo={filtros.sinResponder === true}
              onClick={() => alternar(PARAM.sinResponder, "1", filtros.sinResponder === true)}
            >
              Sin responder
            </ChipFiltro>
            <ChipFiltro
              activo={filtros.soloDuplicados === true}
              onClick={() => alternar(PARAM.duplicados, "1", filtros.soloDuplicados === true)}
            >
              Posibles duplicados
            </ChipFiltro>
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
): { claves: readonly string[]; texto: string }[] {
  const out: { claves: readonly string[]; texto: string }[] = [];
  if (filtros.etapa) {
    out.push({ claves: [PARAM.etapa], texto: `Etapa: ${stageLabel(filtros.etapa)}` });
  }
  if (filtros.resultado) {
    out.push({ claves: [PARAM.resultado], texto: resultadoLabel(filtros.resultado) });
  }
  if (filtros.motivoPerdida) {
    out.push({
      claves: [PARAM.motivo],
      texto: `Motivo: ${motivoPerdidaLabel(filtros.motivoPerdida)}`,
    });
  }
  if (filtros.canal) out.push({ claves: [PARAM.canal], texto: canalLabel(filtros.canal) });
  if (filtros.etiquetaId !== undefined) {
    const nombre = etiquetas.find((e) => e.id === filtros.etiquetaId)?.nombre;
    out.push({ claves: [PARAM.etiqueta], texto: `Etiqueta: ${nombre ?? "—"}` });
  }
  // Los tres params del vehículo salen juntos: son un solo filtro elegido.
  const vehiculo = vehiculoLabel(filtros);
  if (vehiculo !== undefined) out.push({ claves: PARAMS_VEHICULO, texto: vehiculo });
  if (filtros.sinResponder) out.push({ claves: [PARAM.sinResponder], texto: "Sin responder" });
  if (filtros.soloDuplicados) {
    out.push({ claves: [PARAM.duplicados], texto: "Posibles duplicados" });
  }
  return out;
}
