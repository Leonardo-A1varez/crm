import Link from "next/link";
import { SeccionAjuste } from "@/components/ajustes/SeccionAjuste";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface DatosDeEmpresa {
  /** La fila de `empresas`. `null` cuando la tabla está vacía. */
  registro: { nombre: string; identificacionFiscal: string | null } | null;
  /**
   * La zona del negocio. No vive en `empresas`: es la de la configuración del
   * agente, la única del sistema. `null` si no se pudo leer.
   */
  zonaHoraria: string | null;
}

/**
 * Los datos de la empresa. Instalación única por cliente: no hay selector de
 * organización ni va a haberlo, así que estos son los de LA empresa.
 *
 * Es de sólo lectura y se dibuja como lectura: una lista de datos, no un
 * formulario. Campos con cara de input que no guardan nada invitan a tipear, y
 * lo tipeado se pierde sin aviso. Cuando exista la acción de guardar, el
 * formulario vuelve con ella.
 *
 * Razón social y teléfono de contacto no aparecen como campos porque la tabla
 * no tiene dónde guardarlos, y la nota lo dice: un campo vacío se lee como
 * "no lo cargaron", no como "no existe".
 */
export function DatosEmpresa({
  datos,
  hrefZonaHoraria,
}: {
  datos: DatosDeEmpresa;
  /** Dónde se edita la zona horaria. Sin él, no hay link. */
  hrefZonaHoraria?: string;
}) {
  const { registro, zonaHoraria } = datos;

  return (
    <SeccionAjuste
      titulo="Empresa"
      nota="Razón social y teléfono de contacto no tienen dónde guardarse: la tabla empresas sólo tiene nombre e identificación fiscal."
    >
      {registro === null ? (
        <p className="border-line-control text-ink-secondary mb-4 max-w-[720px] rounded-[11px] border border-dashed px-3.5 py-3 text-[11.5px] leading-relaxed">
          No hay datos de la empresa cargados: la tabla empresas está vacía.
        </p>
      ) : null}

      <dl className="grid max-w-[720px] grid-cols-2 gap-x-6 gap-y-4">
        <Dato etiqueta="Nombre comercial" valor={registro?.nombre ?? null} />
        <Dato
          etiqueta="Identificación fiscal"
          valor={registro?.identificacionFiscal ?? null}
          mono
        />
        <Dato
          etiqueta="Zona horaria"
          valor={zonaHoraria}
          mono
          ayuda={
            <>
              La usan el horario de atención y los recordatorios de seguimiento.
              {hrefZonaHoraria ? (
                <>
                  {" "}
                  <Link
                    href={hrefZonaHoraria}
                    className="text-ink-secondary hover:text-ink-primary rounded-[4px] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                  >
                    Se cambia en Agente › Límites y costo
                  </Link>
                  .
                </>
              ) : null}
            </>
          }
        />
      </dl>
    </SeccionAjuste>
  );
}

function Dato({
  etiqueta,
  valor,
  mono = false,
  ayuda,
}: {
  etiqueta: string;
  valor: string | null;
  mono?: boolean;
  ayuda?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-ink-faint text-[11px] font-[650]">{etiqueta}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <span
          className={cn(
            "truncate text-[12.5px]",
            valor === null ? "text-ink-ghost" : "text-ink-primary",
            mono && valor !== null && "font-mono tabular-nums",
          )}
        >
          {valor ?? "sin cargar"}
        </span>
        {ayuda ? (
          <span className="text-ink-ghost text-[10.5px] leading-relaxed text-pretty">{ayuda}</span>
        ) : null}
      </dd>
    </div>
  );
}
