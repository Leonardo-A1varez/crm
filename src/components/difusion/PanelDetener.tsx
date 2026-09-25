"use client";

import { Button } from "@/components/ui/button";
import { ESTADO_ENTREGA } from "./paleta";
import { formatearEntero } from "./formato";
import { Cifra, Nota } from "./primitivas";
import type { ConteoEntrega } from "./tipos";

/**
 * Qué pasa exactamente si se aprieta Detener.
 *
 * El panel está siempre visible —no aparece recién al confirmar— y separa las
 * tres cantidades que de verdad son distintas: lo que ya salió (irreversible),
 * lo aceptado (Meta ya lo tiene y puede entregarlo igual) y lo que está en
 * cola, que es lo único que detener frena.
 *
 * La confirmación es en línea y no en un modal: quien llega acá está apurado,
 * y un diálogo que tapa las cifras lo obliga a decidir de memoria.
 */
export function PanelDetener({
  conteo,
  confirmando,
  procesando,
  onPedirDetener,
  onCancelar,
  onConfirmar,
}: {
  conteo: ConteoEntrega;
  confirmando: boolean;
  /** Ya se pidió detener y el servidor no contestó. */
  procesando: boolean;
  onPedirDetener: () => void;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const yaSalieron = conteo.entregado + conteo.leido + conteo.fallido;

  const filas = [
    {
      clave: "salieron",
      cantidad: yaSalieron,
      color: "var(--color-danger)",
      texto: "ya salieron y llegaron o fallaron. No se pueden recuperar.",
    },
    {
      clave: "aceptado",
      cantidad: conteo.aceptado,
      color: ESTADO_ENTREGA.aceptado.color,
      texto: "están aceptados: Meta puede entregarlos igual después de detener.",
    },
    {
      clave: "en_cola",
      cantidad: conteo.en_cola,
      color: ESTADO_ENTREGA.entregado.color,
      texto: "están en cola y sí se frenan. Es lo único que detener frena.",
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <span className="text-ink-primary text-[12px] font-[650]">Si detenés ahora</span>

      <ul className="flex flex-col gap-2" id="consecuencias-detener">
        {filas.map((f) => (
          <li key={f.clave} className="flex items-baseline gap-3">
            <Cifra
              valor={formatearEntero(f.cantidad)}
              tamano="md"
              color={f.color}
              className="w-[62px]"
            />
            <span className="text-ink-secondary min-w-0 flex-1 text-[11.5px] leading-relaxed">
              {f.texto}
            </span>
          </li>
        ))}
      </ul>

      {confirmando ? (
        <div className="flex flex-col gap-2.5">
          <Nota>
            Detener no cancela los {formatearEntero(conteo.aceptado)} aceptados. Si aparecen
            respuestas después, es por eso.
          </Nota>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancelar} disabled={procesando} className="flex-1">
              Seguir enviando
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmar}
              disabled={procesando}
              aria-busy={procesando || undefined}
              className="flex-1"
            >
              {procesando ? "Deteniendo…" : "Detener igual"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="destructive"
          onClick={onPedirDetener}
          disabled={procesando}
          aria-describedby="consecuencias-detener"
        >
          Detener el envío
        </Button>
      )}
    </div>
  );
}
