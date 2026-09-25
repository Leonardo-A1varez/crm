import { colorDeFallo } from "./paleta";
import { formatearEntero } from "./formato";
import { Cifra, CodigoMeta, Nota } from "./primitivas";
import type { FalloPorMotivo } from "./tipos";

/**
 * Los fallos, agrupados por código de Meta.
 *
 * Un contador de "214 fallidos" no sirve para decidir nada: 131050 (se dio de
 * baja) y 130429 (throughput) son el mismo número en pantalla y problemas
 * opuestos. Por eso cada fila dice el código, qué significa y si Meta lo deja
 * reintentar, según la tabla de errores de la Cloud API (`lib/difusion/codigos-meta.ts`).
 * Qué hace el motor con cada uno no se dice acá: es otra pieza, y la pantalla
 * no puede verificarlo.
 */
export function FallidosPorMotivo({ fallos }: { fallos: readonly FalloPorMotivo[] }) {
  if (fallos.length === 0) {
    return <Nota>Ningún fallo hasta ahora.</Nota>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2.5">
        {fallos.map((f) => {
          const color = colorDeFallo(f.reintentable);
          return (
            <li key={f.codigo} className="grid grid-cols-[52px_74px_1fr] items-start gap-3">
              <Cifra
                valor={formatearEntero(f.cantidad)}
                tamano="md"
                color={color}
                className="w-full justify-end"
              />
              <span className="pt-[2px]">
                <CodigoMeta codigo={f.codigo} color={color} />
              </span>
              <span className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-ink-secondary text-[11.5px] leading-snug">
                  {f.significado ?? "Un código que la tabla de este CRM no describe."}
                </span>
                {f.reintento ? (
                  <span className="text-ink-ghost text-[10.5px]">
                    Reintento según Meta:{" "}
                    <span className="font-medium" style={{ color }}>
                      {f.reintento}
                    </span>
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <Nota>
        El significado y el reintento salen de la tabla de errores de la Cloud API de Meta. Un
        código que no está en la tabla se muestra tal cual.
      </Nota>
    </div>
  );
}
