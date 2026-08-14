"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Close, Tune } from "@/components/icons";
import { ChipFiltro, CHIP_BASE, CHIP_OFF, CHIP_ON } from "@/components/leads/ChipFiltro";
import { FiltroPerdido } from "@/components/leads/FiltroPerdido";
import { SelectorBuscable } from "@/components/leads/SelectorBuscable";
import { ChannelDot } from "@/components/shared/ChannelDot";
import {
  contarFiltrosActivos,
  ETAPA_REQUIERE_HUMANO,
  ETAPAS_FILTRO,
  PARAM,
  PARAMS_VEHICULO,
  parseFiltrosLeads,
  resultadoLabel,
  vehiculoLabel,
} from "@/lib/ui/filtros-leads";
import { motivoPerdidaLabel } from "@/lib/ui/motivo-perdida";
import { canalLabel } from "@/lib/ui/canal";
import { stageColor, stageLabel } from "@/lib/ui/stage";
import { cn } from "@/lib/utils";
import { CANAL } from "@/types/domain";
import type { OpcionBuscable } from "@/components/leads/SelectorBuscable";
import type { MotivoPerdida } from "@/types/domain";
import type { EtiquetaOpcion, VehiculoOpcion } from "@/types/leads";
import type { ReactNode } from "react";

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

  // Ganado y Perdido comparten el param `resultado`, así que se excluyen solos:
  // prender uno apaga el otro sin que haya que limpiarlo a mano. El motivo solo
  // acompaña a Perdido y se limpia en cualquier otra transición.
  const ganado = filtros.resultado === "exito";
  const perdido = filtros.resultado === "perdido";

  function alternarGanado() {
    navegar([
      [PARAM.resultado, ganado ? null : "exito"],
      [PARAM.motivo, null],
    ]);
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
            {ETAPAS_FILTRO.map((s) => (
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
            <ChipFiltro activo={ganado} onClick={alternarGanado}>
              {resultadoLabel("exito")}
            </ChipFiltro>
            <FiltroPerdido
              activo={perdido}
              motivo={filtros.motivoPerdida}
              motivos={motivos}
              onPrender={() =>
                navegar([
                  [PARAM.resultado, "perdido"],
                  [PARAM.motivo, null],
                ])
              }
              onApagar={() =>
                navegar([
                  [PARAM.resultado, null],
                  [PARAM.motivo, null],
                ])
              }
              // `resultado` se mantiene junto al motivo: el service los aplica
              // con AND, así que el recorte queda explícito y el chip sigue
              // encendido aunque el motivo cambie.
              onElegirMotivo={(m) =>
                navegar([
                  [PARAM.resultado, "perdido"],
                  [PARAM.motivo, m],
                ])
              }
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
            {/* No es una etiqueta del catálogo sino `current_stage`, pero para
                quien filtra es una marca sobre el lead y no un paso del embudo.
                Vive acá y escribe `etapa`: sin fila en `lead_tags`, no hay copia
                que pueda quedar desincronizada del estado real. */}
            <ChipFiltro
              activo={filtros.etapa === ETAPA_REQUIERE_HUMANO}
              onClick={() =>
                alternar(
                  PARAM.etapa,
                  ETAPA_REQUIERE_HUMANO,
                  filtros.etapa === ETAPA_REQUIERE_HUMANO,
                )
              }
            >
              <span
                aria-hidden
                className="size-[6px] shrink-0 rounded-full"
                style={{ backgroundColor: stageColor(ETAPA_REQUIERE_HUMANO) }}
              />
              {stageLabel(ETAPA_REQUIERE_HUMANO)}
            </ChipFiltro>
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
  if (filtros.etapa === ETAPA_REQUIERE_HUMANO) {
    // Sin el prefijo "Etapa:": se eligió desde Etiquetas y así se nombra.
    out.push({ claves: [PARAM.etapa], texto: stageLabel(ETAPA_REQUIERE_HUMANO) });
  } else if (filtros.etapa) {
    out.push({ claves: [PARAM.etapa], texto: `Etapa: ${stageLabel(filtros.etapa)}` });
  }
  // El cierre es un renglón solo aunque ocupe dos params: se eligió con un
  // gesto y se quita con uno, igual que el vehículo.
  if (filtros.resultado !== undefined || filtros.motivoPerdida !== undefined) {
    out.push({
      claves: [PARAM.resultado, PARAM.motivo],
      texto:
        filtros.motivoPerdida !== undefined
          ? `${resultadoLabel("perdido")}: ${motivoPerdidaLabel(filtros.motivoPerdida)}`
          : resultadoLabel(filtros.resultado ?? "perdido"),
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
