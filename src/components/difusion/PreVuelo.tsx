"use client";

import { TaskAlt } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { BloqueCanary } from "./BloqueCanary";
import { CabeceraDifusion } from "./CabeceraDifusion";
import { CostoEstimado } from "./CostoEstimado";
import { evaluarEnvio } from "./cupo";
import { EXCLUSION } from "./exclusiones";
import { formatearEntero, formatearResta } from "./formato";
import { ListaDestinatarios } from "./ListaDestinatarios";
import { MedidorCupo } from "./MedidorCupo";
import { PlanDeReparto } from "./PlanDeReparto";
import { PruebaAMiNumero, type ResultadoPrueba } from "./PruebaAMiNumero";
import { CodigoMeta, Cifra, Nota, Panel, Punto } from "./primitivas";
import { SaludDelNumero } from "./SaludDelNumero";
import { VerdictoEnvio } from "./VerdictoEnvio";
import type {
  AlcanceAudiencia,
  Cupo,
  DiffContraAnterior,
  Destinatario,
  LineaCosto,
  SaludNumero,
  TandaReparto,
} from "./tipos";

/** Lo que devolvió el servidor para el pre-vuelo, ya en la forma de la pantalla. */
export interface CalculoPreVuelo {
  alcance: AlcanceAudiencia;
  cupo: Cupo;
  tandas: TandaReparto[];
  diff: DiffContraAnterior | null;
  calculado: string;
}

export type EstadoPreVuelo =
  | { estado: "calculando" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; calculo: CalculoPreVuelo };

/**
 * Pre-vuelo: lo último antes de programar.
 *
 * La pantalla está ordenada como la decisión, no como los datos:
 *
 *   1. el veredicto, arriba de todo y en una frase;
 *   2. a quién le llega, uno por uno, y a quién no y por qué;
 *   3. si entra en el cupo, y si no, en cuántas tandas;
 *   4. cuánto cuesta, separando lo gratis de lo pago;
 *   5. cómo está el número que se está arriesgando;
 *   6. la muestra y el botón, con el veredicto repetido al lado.
 *
 * Todo lo que está entre el 2 y el 5 es la evidencia del 1, y sale del
 * planificador: lo que se ve es lo que va a quedar en cola.
 */
export function PreVuelo({
  nombre,
  estado,
  destinatarios,
  onCargarMas,
  cargandoMas,
  lineasCosto,
  salud,
  plantilla,
  canary,
  onCambiarCanary,
  programando,
  error,
  onVolver,
  onReintentar,
  onSalir,
  onProgramar,
  onEnviarPrueba,
}: {
  nombre: string;
  estado: EstadoPreVuelo;
  /** Lo cargado de la lista hasta ahora, en el orden en que sale. */
  destinatarios: readonly Destinatario[];
  onCargarMas: (() => void) | null;
  cargandoMas: boolean;
  lineasCosto: readonly LineaCosto[];
  salud: SaludNumero;
  plantilla: { nombre: string; elegible: boolean } | null;
  canary: { activo: boolean; tamano: number };
  onCambiarCanary: (canary: { activo: boolean; tamano: number }) => void;
  programando: boolean;
  /** El error del último intento de programar. */
  error: string | null;
  onVolver: () => void;
  onReintentar: () => void;
  onSalir: () => void;
  onProgramar: () => void;
  /** "Enviar de prueba a mi número". Sin él, la prueba no se ofrece. */
  onEnviarPrueba?: (pedido: { telefono: string; leadId: string }) => Promise<ResultadoPrueba>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CabeceraDifusion
        nombre={nombre}
        paso="Pre-vuelo"
        etiquetaVolver="Mensaje"
        onVolver={onVolver}
      />

      <div className="bg-surface-root min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-3.5">
          {estado.estado === "calculando" ? (
            <p role="status" className="text-ink-dim text-[12.5px]">
              Calculando la lista exacta…
            </p>
          ) : estado.estado === "error" ? (
            <div
              role="alert"
              className="border-danger/40 bg-danger/[0.06] flex flex-col items-start gap-2 rounded-[11px] border px-3.5 py-3"
            >
              <p className="text-danger text-[12.5px] font-[650]">
                No se pudo calcular el pre-vuelo
              </p>
              <p className="text-ink-secondary text-[11.5px]">{estado.mensaje}</p>
              <Button variant="outline" size="sm" onClick={onReintentar}>
                Reintentar
              </Button>
            </div>
          ) : (
            <Contenido
              calculo={estado.calculo}
              destinatarios={destinatarios}
              onCargarMas={onCargarMas}
              cargandoMas={cargandoMas}
              lineasCosto={lineasCosto}
              salud={salud}
              plantilla={plantilla}
              canary={canary}
              onCambiarCanary={onCambiarCanary}
              programando={programando}
              error={error}
              onSalir={onSalir}
              onProgramar={onProgramar}
              onEnviarPrueba={onEnviarPrueba}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Contenido({
  calculo,
  destinatarios,
  onCargarMas,
  cargandoMas,
  lineasCosto,
  salud,
  plantilla,
  canary,
  onCambiarCanary,
  programando,
  error,
  onSalir,
  onProgramar,
  onEnviarPrueba,
}: {
  calculo: CalculoPreVuelo;
  destinatarios: readonly Destinatario[];
  onCargarMas: (() => void) | null;
  cargandoMas: boolean;
  lineasCosto: readonly LineaCosto[];
  salud: SaludNumero;
  plantilla: { nombre: string; elegible: boolean } | null;
  canary: { activo: boolean; tamano: number };
  onCambiarCanary: (canary: { activo: boolean; tamano: number }) => void;
  programando: boolean;
  error: string | null;
  onSalir: () => void;
  onProgramar: () => void;
  onEnviarPrueba?: (pedido: { telefono: string; leadId: string }) => Promise<ResultadoPrueba>;
}) {
  const { alcance, cupo, tandas, diff, calculado } = calculo;
  const n = alcance.destinatarios;
  const verdicto = evaluarEnvio({ destinatarios: n, cupo, tandas, salud, plantilla });
  const aplicadas = alcance.exclusiones.filter((e) => e.aplicada && e.cantidad > 0);
  const totalExcluidos = aplicadas.reduce((acc, e) => acc + e.cantidad, 0);
  const invarianteOk = n <= alcance.coinciden;
  const conMuestra = canary.activo && n >= 2;
  const muestraValida =
    !conMuestra ||
    (Number.isInteger(canary.tamano) && canary.tamano >= 1 && canary.tamano <= n - 1);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-ink-primary text-[20px] font-[680] tracking-[-0.02em]">
          Revisar antes de programar
        </h2>
        <p className="text-ink-faint text-[12.5px]">
          La lista exacta que va a quedar en cola, calculada el {calculado}.
        </p>
      </div>

      <VerdictoEnvio verdicto={verdicto} />

      <div className="grid grid-cols-[1.15fr_1fr] items-start gap-3.5">
        <div className="flex flex-col gap-3.5">
          <Panel>
            <ListaDestinatarios
              destinatarios={destinatarios}
              total={n}
              diff={diff}
              onCargarMas={onCargarMas}
              cargando={cargandoMas}
            />
          </Panel>

          <Panel titulo={`Excluidos · ${formatearEntero(totalExcluidos)}`}>
            <div className="flex flex-col gap-3">
              {aplicadas.length === 0 ? (
                <Nota>Nadie de la audiencia queda excluido.</Nota>
              ) : (
                <ul className="grid grid-cols-2 gap-x-5 gap-y-2">
                  {aplicadas.map((e) => {
                    const d = EXCLUSION[e.motivo];
                    return (
                      <li key={e.motivo} className="flex items-center gap-2.5">
                        <Punto color={d.color} />
                        <Cifra
                          valor={formatearResta(e.cantidad)}
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
              )}

              <div className="border-line-row flex items-start gap-2.5 border-t pt-3">
                <TaskAlt
                  size={13}
                  aria-hidden
                  className={invarianteOk ? "text-ok mt-[1px]" : "text-danger mt-[1px]"}
                />
                <Nota>
                  {invarianteOk ? "Invariante verificada: " : "Invariante rota: "}
                  <span className="text-ink-primary font-mono tabular-nums">
                    {formatearEntero(n)} ≤ {formatearEntero(alcance.coinciden)}
                  </span>
                  . Los destinatarios nunca superan la audiencia; si no se cumpliera, el
                  planificador y la base rechazan el plan antes de programarlo.
                </Nota>
              </div>
            </div>
          </Panel>

          <Panel titulo="Costo estimado">
            <CostoEstimado lineas={lineasCosto} />
          </Panel>
        </div>

        <div className="flex flex-col gap-3.5">
          <Panel>
            <MedidorCupo cupo={cupo} tandas={tandas} />
          </Panel>

          {cupo.estado === "ok" && tandas.length > 1 ? (
            <Panel>
              <PlanDeReparto tandas={tandas} porTanda={cupo.porTanda} />
            </Panel>
          ) : null}

          <Panel titulo="Salud del número">
            <SaludDelNumero salud={salud} />
          </Panel>

          <Panel acento="var(--color-line-control)">
            <div className="flex flex-col gap-4">
              <BloqueCanary
                activo={canary.activo}
                tamano={canary.tamano}
                totalDestinatarios={n}
                onCambiar={onCambiarCanary}
              />

              {onEnviarPrueba ? (
                <div className="border-line-row border-t pt-4">
                  <PruebaAMiNumero destinatarios={destinatarios} onEnviar={onEnviarPrueba} />
                </div>
              ) : null}

              <VerdictoEnvio verdicto={verdicto} compacto />

              {error ? (
                <p role="alert" className="text-danger text-[11.5px] leading-relaxed font-medium">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-2">
                <Button variant="outline" onClick={onSalir} disabled={programando}>
                  Salir sin programar
                </Button>
                <Button
                  className="flex-1"
                  onClick={onProgramar}
                  disabled={verdicto.nivel === "bloqueado" || !muestraValida || programando}
                  aria-busy={programando || undefined}
                >
                  {programando
                    ? "Programando…"
                    : conMuestra
                      ? `Programar con muestra de ${formatearEntero(canary.tamano)}`
                      : `Programar para ${formatearEntero(n)}`}
                </Button>
              </div>

              <Nota>
                Programar guarda la lista en cola, tanda por tanda. Los mensajes salen cuando el
                motor de envío toma la difusión. Salir deja el borrador guardado.
              </Nota>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
