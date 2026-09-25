"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DuplicateIcon, PlayIcon } from "@/components/icons";
import { FOCO, PRESION_TACTIL, TRANSICION_CONTROL } from "./tokens-editor";
import {
  PLAN_NOMBRE,
  contarReusados,
  enviosQueSeRepiten,
  type EnvioRepetido,
  type PlanReanudacion,
  type PreviaReanudar,
  type PreviaRepetir,
} from "./corrida";

export interface PreviaReanudacionProps {
  reanudar: PreviaReanudar;
  repetir: PreviaRepetir;
  /**
   * El plan que se está previsualizando en el lienzo, o `null`. Lo maneja la
   * pantalla, no este componente: el lienzo también lo necesita.
   */
  planPrevisualizado: PlanReanudacion | null;
  onPrevisualizar: (plan: PlanReanudacion | null) => void;
  onReanudar: () => void;
  onEjecutarDeNuevo: () => void;
  /** Cuál de las dos acciones está en vuelo. Apaga los dos botones mientras tanto. */
  enCurso?: PlanReanudacion | null;
  className?: string;
}

/**
 * Los dos botones para volver a lanzar una corrida fallada, y la previa que
 * los distingue.
 *
 * ## El antipatrón que esto evita
 *
 * Zapier llama "Replay" a las dos acciones y las dibuja igual. Se aprieta la
 * que parece obvia y salen otra vez los WhatsApp que ya se mandaron. Acá:
 *
 *  - **Nombres distintos**: "Reanudar desde el fallo" y "Ejecutar de nuevo
 *    desde el principio". Ninguno de los dos es "Replay".
 *  - **Íconos distintos**: reanudar lleva el triángulo de continuar; ejecutar
 *    de nuevo lleva el de duplicar, que es literalmente lo que le pasa a los
 *    mensajes.
 *  - **Peso distinto**: reanudar es la acción normal; ejecutar de nuevo va en
 *    tono de peligro, porque repite efectos.
 *  - **Previa en el lienzo**: apuntar cualquiera de los dos —con el mouse o con
 *    el tabulador— pinta el plan sobre el flujo dibujado.
 *  - **Confirmación que enumera**: ejecutar de nuevo abre un diálogo con cada
 *    mensaje que se va a repetir, con lo que decía. "Se re-ejecutan 6 pasos"
 *    no dice nada; "a Juan le vuelve a llegar «Hola Juan, gracias…»" sí.
 *
 * Reanudar **no** pide confirmación, y es deliberado: no repite ningún efecto,
 * y ponerle un diálogo enseñaría que los dos son igual de peligrosos.
 *
 * Una acción que el servidor dice que no se puede queda visible y apagada con
 * su motivo al lado, en vez de desaparecer: que falte un botón que ayer estaba
 * se lee como un error de la pantalla.
 */
export function PreviaReanudacion({
  reanudar,
  repetir,
  planPrevisualizado,
  onPrevisualizar,
  onReanudar,
  onEjecutarDeNuevo,
  enCurso = null,
  className,
}: PreviaReanudacionProps) {
  const [confirmando, setConfirmando] = useState(false);
  const idReanudar = useId();
  const idRepetir = useId();

  const reusados = contarReusados("reanudar", reanudar);
  const repetidos = enviosQueSeRepiten("desde_cero", repetir);
  const ocupado = enCurso !== null;

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReanudar}
          disabled={!reanudar.posible || ocupado}
          aria-busy={enCurso === "reanudar" || undefined}
          onMouseEnter={() => reanudar.posible && onPrevisualizar("reanudar")}
          onMouseLeave={() => onPrevisualizar(null)}
          onFocus={() => reanudar.posible && onPrevisualizar("reanudar")}
          onBlur={() => onPrevisualizar(null)}
          aria-describedby={idReanudar}
          className={cn(
            "gap-2",
            planPrevisualizado === "reanudar" && "border-ok",
            TRANSICION_CONTROL,
            PRESION_TACTIL,
          )}
        >
          <PlayIcon aria-hidden className="text-ok size-3.5" />
          {enCurso === "reanudar" ? "Reanudando…" : PLAN_NOMBRE.reanudar}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmando(true)}
          disabled={!repetir.posible || ocupado}
          aria-busy={enCurso === "desde_cero" || undefined}
          onMouseEnter={() => repetir.posible && onPrevisualizar("desde_cero")}
          onMouseLeave={() => onPrevisualizar(null)}
          onFocus={() => repetir.posible && onPrevisualizar("desde_cero")}
          onBlur={() => onPrevisualizar(null)}
          aria-describedby={idRepetir}
          className={cn(
            "text-danger border-danger/40 hover:border-danger gap-2",
            planPrevisualizado === "desde_cero" && "border-danger",
            TRANSICION_CONTROL,
            PRESION_TACTIL,
          )}
        >
          <DuplicateIcon aria-hidden className="size-3.5" />
          {enCurso === "desde_cero" ? "Arrancando…" : PLAN_NOMBRE.desde_cero}
        </Button>
      </div>

      {/* Lo que la previa del lienzo dice, en texto. Quien navega con lector de
          pantalla no ve el lienzo cambiar de color: el `aria-describedby` de
          cada botón le lee exactamente el mismo plan, o por qué no se puede. */}
      <p id={idReanudar} className="sr-only">
        {reanudar.posible
          ? `Reusa el resultado de ${reusados} ${reusados === 1 ? "paso ya ejecutado" : "pasos ya ejecutados"} y vuelve a correr sólo desde el que falló. No se repite ningún mensaje.`
          : reanudar.motivo}
      </p>
      <p id={idRepetir} className="sr-only">
        {repetir.posible
          ? `No reusa nada. Vuelve a correr el flujo entero${repetidos.length > 0 ? `, y se repiten ${repetidos.length} ${repetidos.length === 1 ? "envío" : "envíos"}.` : "."}`
          : repetir.motivo}
      </p>

      {repetir.posible ? (
        <DialogoRehacer
          abierto={confirmando}
          onCerrar={() => setConfirmando(false)}
          repetidos={repetidos}
          destinatario={repetir.destinatario}
          onConfirmar={() => {
            setConfirmando(false);
            onPrevisualizar(null);
            onEjecutarDeNuevo();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * La confirmación de "ejecutar de nuevo desde el principio".
 *
 * **Enumera, no cuenta.** La pregunta real de quien está por apretar no es
 * "¿cuántos pasos se repiten?" sino "¿le va a llegar de nuevo el mensaje de
 * bienvenida a Juan?". Por eso cada fila trae lo que decía el mensaje.
 *
 * Si no se repite ningún envío el diálogo lo dice y se vuelve trámite. Es
 * importante que el mismo diálogo cubra los dos casos: si sólo apareciera
 * cuando hay riesgo, su ausencia sería una señal que nadie sabría leer.
 */
function DialogoRehacer({
  abierto,
  onCerrar,
  repetidos,
  destinatario,
  onConfirmar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  repetidos: readonly EnvioRepetido[];
  destinatario?: string;
  onConfirmar: () => void;
}) {
  const hayRiesgo = repetidos.length > 0;

  return (
    <Dialog open={abierto} onOpenChange={(o) => (o ? undefined : onCerrar())}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Ejecutar de nuevo desde el principio</DialogTitle>
          <DialogDescription>
            {hayRiesgo
              ? `El flujo arranca de cero con una corrida nueva. Estos mensajes vuelven a salir${destinatario ? `, y le llegan de nuevo a ${destinatario}` : ""}:`
              : "El flujo arranca de cero con una corrida nueva. Esta corrida no llegó a mandar ningún mensaje, así que no se repite ningún envío."}
          </DialogDescription>
        </DialogHeader>

        {hayRiesgo ? (
          <ul className="border-danger/30 bg-danger/10 flex max-h-56 flex-col gap-2.5 overflow-auto rounded-lg border p-3">
            {repetidos.map((p) => (
              <li key={`${p.nodoId}-${p.hora ?? ""}`} className="flex items-baseline gap-2">
                {/* `mt-1.5`: alineación óptica del punto contra la primera línea del texto. */}
                <span aria-hidden className="bg-danger mt-1.5 size-1.5 shrink-0 rounded-full" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-ink-body text-[12px] leading-snug font-medium">
                    {p.nombre}
                  </span>
                  <span className="text-ink-dim line-clamp-2 text-[11px] leading-snug text-pretty">
                    {p.texto === null ? "El texto ya no se puede leer." : `«${p.texto}»`}
                  </span>
                </span>
                {p.hora ? (
                  <span className="text-ink-ghost shrink-0 font-mono text-[10px] tabular-nums">
                    salió {p.hora}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-ink-dim text-[11px] leading-relaxed text-pretty">
          Si lo que querés es aplicar un arreglo sin repetir nada,{" "}
          <span className="text-ink-body font-medium">Reanudar desde el fallo</span> retoma en el
          paso que falló y reusa todo lo anterior.
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCerrar}
            className={cn(TRANSICION_CONTROL, PRESION_TACTIL, FOCO)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onConfirmar}
            className={cn(TRANSICION_CONTROL, PRESION_TACTIL, FOCO)}
          >
            {hayRiesgo
              ? `Sí, repetir ${repetidos.length} ${repetidos.length === 1 ? "envío" : "envíos"}`
              : "Ejecutar de nuevo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * El cartel que explica el plan, anclado al lienzo.
 *
 * Acompaña a la previa: mientras el lienzo está pintado con un plan, esto dice
 * en una línea qué se está mirando. El lienzo muestra, el cartel nombra.
 */
export function CartelPlan({
  plan,
  reanudar,
  repetir,
  className,
}: {
  plan: PlanReanudacion;
  reanudar: PreviaReanudar;
  repetir: PreviaRepetir;
  className?: string;
}) {
  const reusados = contarReusados(plan, reanudar);
  const repetidos = enviosQueSeRepiten(plan, repetir);

  return (
    <div
      role="status"
      className={cn(
        "border-line-card bg-surface-elevated flex items-center gap-3 rounded-lg border px-3.5 py-2.5 shadow-lg",
        "animate-in fade-in slide-in-from-top-1 duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "motion-reduce:animate-none",
        className,
      )}
    >
      <span className="text-ink-primary text-[12px] leading-snug font-semibold">
        {PLAN_NOMBRE[plan]}
      </span>
      <span aria-hidden className="bg-line-card h-4 w-px" />
      <span className="text-ink-dim text-[11.5px] leading-snug text-pretty">
        {plan === "reanudar" ? (
          <>
            se reusan <span className="text-ink-body font-mono tabular-nums">{reusados}</span>{" "}
            {reusados === 1 ? "paso" : "pasos"} y no se repite ningún envío
          </>
        ) : repetidos.length > 0 ? (
          <>
            no se reusa nada y se repiten{" "}
            <span className="text-danger font-mono tabular-nums">{repetidos.length}</span>{" "}
            {repetidos.length === 1 ? "envío" : "envíos"}
          </>
        ) : (
          <>no se reusa nada, pero esta corrida no llegó a mandar mensajes</>
        )}
      </span>
    </div>
  );
}
