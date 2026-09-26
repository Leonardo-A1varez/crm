"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ESTADO_DIFUSION } from "./estado-difusion";
import { EXCLUSION } from "./exclusiones";
import { FallidosPorMotivo } from "./FallidosPorMotivo";
import { PanelDetener } from "./PanelDetener";
import { ProgresoEnvio } from "./ProgresoEnvio";
import { RespuestasEntrantes } from "./RespuestasEntrantes";
import { tinte } from "./paleta";
import { formatearEntero } from "./formato";
import { Cifra, CodigoMeta, Nota, Panel, Punto } from "./primitivas";
import type { EnvioDifusion, EstadoDifusion } from "./tipos";

export type AccionEnvio = "detener" | "pausar" | "reanudar";

/** Los estados en los que todavía queda algo en cola que frenar. */
const ACTIVOS: ReadonlySet<EstadoDifusion> = new Set<EstadoDifusion>([
  "programada",
  "enviando",
  "en_revision",
]);

/** Qué está pasando, en una frase. `null` cuando lo dice el progreso solo. */
function situacion(envio: EnvioDifusion): string | null {
  switch (envio.estado) {
    case "programada":
      return `Programada${envio.programadaPara ? ` el ${envio.programadaPara}` : ""}. Los envíos están en cola: salen cuando el motor de envío toma la difusión.`;
    case "en_revision":
      return `En revisión: el envío está frenado hasta que alguien lo reanude.${
        envio.motivoRevision
          ? ` Motivo: ${envio.motivoRevision}`
          : envio.canaryTamano === null
            ? ""
            : ` La muestra era de ${formatearEntero(envio.canaryTamano)}.`
      }`;
    case "completada":
      return `Terminó${envio.finalizadaAt ? ` el ${envio.finalizadaAt}` : ""}.`;
    case "detenida":
      return `Detenida${envio.finalizadaAt ? ` el ${envio.finalizadaAt}` : ""} ${
        envio.detenidaPorPersona ? "por una persona" : "por el sistema"
      }.${envio.motivoDetencion ? ` Motivo: ${envio.motivoDetencion}` : ""}`;
    case "enviando":
    case "borrador":
      return null;
  }
}

/**
 * Una difusión ya programada: el progreso real de lo que salió, los fallos por
 * código de Meta y el freno.
 *
 * Todo sale de las filas de `difusion_envios`: el progreso, el ritmo medido
 * (lo reservado en los últimos minutos), las respuestas y la muestra. El fin
 * estimado sólo aparece con ritmo medido: un número inventado en esta
 * pantalla es el que alguien usa para decidir si detiene.
 *
 * Los botones son de admin, como las acciones que llaman. Detener está en la
 * barra superior y no se va nunca, porque el momento en que hace falta es
 * justo el momento en que nadie va a buscarlo.
 */
export function EnvioEnCurso({
  envio,
  puedeActuar,
  accion,
  error,
  onVolver,
  onDetener,
  onPausar,
  onReanudar,
}: {
  envio: EnvioDifusion;
  puedeActuar: boolean;
  /** La acción que se está pidiendo al servidor, si hay una. */
  accion: AccionEnvio | null;
  error: string | null;
  onVolver: () => void;
  onDetener: () => void;
  onPausar: () => void;
  onReanudar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const estado = ESTADO_DIFUSION[envio.estado];
  const activa = puedeActuar && ACTIVOS.has(envio.estado);
  const { conteo } = envio;
  const llegaron = conteo.entregado + conteo.leido;
  const texto = situacion(envio);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-line-layout bg-surface-panel flex h-[52px] shrink-0 items-center gap-3 border-b px-4">
        <Button variant="outline" size="sm" onClick={onVolver} className="shrink-0">
          <span aria-hidden>←</span>
          Difusión
        </Button>
        <h1 className="text-ink-primary min-w-0 truncate text-[14px] font-[650] tracking-[-0.01em]">
          {envio.nombre}
        </h1>

        <span
          className="bg-surface-input inline-flex shrink-0 items-center gap-2 rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium"
          style={{ color: estado.color }}
        >
          <Punto color={estado.color} latiendo={envio.estado === "enviando"} />
          {estado.etiqueta}
          {envio.tandaActual && envio.tandaActual.de > 1 ? (
            <span className="text-ink-faint">
              {" "}
              · tanda {envio.tandaActual.numero} de {envio.tandaActual.de}
            </span>
          ) : null}
        </span>

        {activa ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {envio.estado === "enviando" ? (
              <Button variant="outline" onClick={onPausar} disabled={accion !== null}>
                {accion === "pausar" ? "Pausando…" : "Pausar"}
              </Button>
            ) : null}
            {envio.estado === "en_revision" ? (
              <Button onClick={onReanudar} disabled={accion !== null}>
                {accion === "reanudar" ? "Reanudando…" : "Reanudar el envío"}
              </Button>
            ) : null}
            <Button
              variant="destructive"
              onClick={() => setConfirmando(true)}
              disabled={accion !== null}
            >
              Detener
            </Button>
          </div>
        ) : null}
      </header>

      <div className="bg-surface-root min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-3.5">
          <p aria-live="polite" className="sr-only">
            {formatearEntero(llegaron)} de {formatearEntero(envio.total)} llegaron a un teléfono.{" "}
            {formatearEntero(conteo.aceptado)} aceptados sin confirmar,{" "}
            {formatearEntero(conteo.fallido)} fallidos, {formatearEntero(conteo.en_cola)} en cola
            {conteo.cancelado > 0 ? `, ${formatearEntero(conteo.cancelado)} cancelados` : ""}.
          </p>

          {texto ? (
            <p
              role="status"
              className="text-ink-secondary rounded-[11px] border px-3.5 py-3 text-[12px] leading-relaxed text-pretty"
              style={{
                borderColor: tinte(estado.color, 32),
                backgroundColor: tinte(estado.color, 8),
              }}
            >
              {texto}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-danger text-[12px] font-medium">
              {error}
            </p>
          ) : null}

          <Panel>
            <ProgresoEnvio
              conteo={conteo}
              total={envio.total}
              tandas={envio.tandas}
              ritmo={ACTIVOS.has(envio.estado) ? envio.ritmo : undefined}
              respondieron={envio.respuestas.total}
            />
          </Panel>

          <div className="grid grid-cols-[1.2fr_1fr] items-start gap-3.5">
            <Panel titulo="Fallidos por motivo">
              <FallidosPorMotivo fallos={envio.fallos} />
            </Panel>

            <div className="flex flex-col gap-3.5">
              {activa ? (
                <Panel acento="var(--color-line-control)">
                  <PanelDetener
                    conteo={conteo}
                    confirmando={confirmando}
                    procesando={accion === "detener"}
                    onPedirDetener={() => setConfirmando(true)}
                    onCancelar={() => setConfirmando(false)}
                    onConfirmar={() => {
                      setConfirmando(false);
                      onDetener();
                    }}
                  />
                </Panel>
              ) : null}

              <Panel titulo="Muestra">
                <div className="flex flex-col gap-2.5">
                  <Nota>{textoMuestra(envio)}</Nota>
                  <Nota>
                    Frenado automático armado para <CodigoMeta codigo="368" />,{" "}
                    <CodigoMeta codigo="131031" /> y <CodigoMeta codigo="131048" />: si Meta
                    responde con uno de esos, la difusión se detiene y lo pendiente se cancela.
                  </Nota>
                </div>
              </Panel>
            </div>
          </div>

          <Panel titulo="Respuestas">
            <RespuestasEntrantes
              total={envio.respuestas.total}
              recientes={envio.respuestas.recientes}
            />
          </Panel>

          {envio.audienciaDinamica ? (
            <Panel titulo="Audiencia dinámica">
              <div className="flex flex-col gap-2">
                <p className="text-ink-secondary text-[12px] leading-relaxed text-pretty">
                  <Cifra
                    valor={formatearEntero(envio.audienciaDinamica.altas)}
                    tamano="md"
                    className="mr-1.5"
                  />
                  {envio.audienciaDinamica.altas === 1
                    ? "entró después de programar."
                    : "entraron después de programar."}
                </p>
                <Nota>
                  Antes de cada tanda se vuelve a mirar la audiencia: quien empezó a calificar se
                  suma a las tandas que siguen, con las mismas bajas y exclusiones que el resto.
                </Nota>
              </div>
            </Panel>
          ) : null}

          {envio.exclusionesPorMotivo.length > 0 ? (
            <Panel
              titulo={`${envio.audienciaDinamica ? "Excluidos" : "Excluidos al programar"} · ${formatearEntero(envio.excluidos)}`}
            >
              <div className="flex flex-col gap-3">
                <ul className="grid grid-cols-2 gap-x-5 gap-y-2">
                  {envio.exclusionesPorMotivo.map((x) => {
                    const d = EXCLUSION[x.motivo];
                    return (
                      <li key={x.motivo} className="flex items-center gap-2.5">
                        <Punto color={d.color} />
                        <Cifra
                          valor={formatearEntero(x.cantidad)}
                          tamano="md"
                          className="w-[52px]"
                        />
                        <span className="text-ink-dim min-w-0 flex-1 truncate text-[11.5px]">
                          {d.etiqueta}
                        </span>
                        {d.codigo ? <CodigoMeta codigo={d.codigo} color={d.color} /> : null}
                      </li>
                    );
                  })}
                </ul>
                <Nota>No recibieron la difusión y no cuentan en el total.</Nota>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Qué pasó con la muestra, con lo que se midió de ella. */
function textoMuestra(envio: EnvioDifusion): string {
  const m = envio.muestra;
  if (envio.canaryTamano === null) return "Se programó sin muestra: sale el plan entero.";
  if (m === null) {
    return `La muestra es de ${formatearEntero(envio.canaryTamano)}: sale esa parte y la difusión queda en revisión hasta que alguien la reanude.`;
  }
  const partes = [
    `${formatearEntero(m.llegaron)} llegaron`,
    `${formatearEntero(m.aceptados)} sin confirmar`,
    `${formatearEntero(m.fallidos)} fallidos`,
  ];
  const bajas =
    m.bajasMeta > 0
      ? ` ${formatearEntero(m.bajasMeta)} se dieron de baja de marketing en Meta (131050).`
      : " Ninguna baja de Meta en la muestra.";
  const siguio = m.continuadaA
    ? ` Se continuó el ${m.continuadaA}.`
    : envio.estado === "en_revision"
      ? " Espera que alguien la revise y reanude."
      : "";
  return `La muestra de ${formatearEntero(m.tamano)} salió el ${m.salioA}: ${partes.join(", ")}.${bajas}${siguio}`;
}
