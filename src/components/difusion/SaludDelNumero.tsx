import { BadgeSalud } from "@/components/ajustes/BadgeSalud";
import { DESCRIPTOR_CALIDAD, DESCRIPTOR_ENVIO } from "@/components/ajustes/descriptores";
import { Warning } from "@/components/icons";
import { tinte } from "./paleta";
import { formatearEscalon } from "./formato";
import { FilaDato, Nota } from "./primitivas";
import type { SaludNumero } from "./tipos";

/**
 * El estado del activo que se está arriesgando: calidad, escalón, si Meta deja
 * enviar y qué plantillas están pausadas. Mandar de más no cuesta plata,
 * cuesta el número; por eso está en el pre-vuelo y no escondido en Ajustes.
 *
 * Todo sale de la lectura de Meta que usa Ajustes, con la misma traducción y
 * los mismos badges. Lo que no se pudo leer se dice con su motivo, y una
 * pausada no trae botón de despausar: la API no dice si vuelve sola o hay que
 * levantarla a mano, y desde acá no se puede hacer ninguna de las dos.
 */
export function SaludDelNumero({ salud }: { salud: SaludNumero }) {
  const { calidad, escalon, envio, plantillasPausadas } = salud;
  const avisos = [
    calidad.estado === "sin-dato" ? calidad.motivo : null,
    escalon.estado === "sin-dato" ? escalon.motivo : null,
    envio.estado === "limitado" || envio.estado === "bloqueado" ? envio.detalle : null,
    envio.estado === "sin-dato" ? envio.motivo : null,
  ].filter((a): a is string => a !== null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <FilaDato etiqueta="Calidad">
          <span className="flex items-center gap-2">
            {calidad.estado === "ok" && calidad.valor.cruda ? (
              <span className="text-ink-ghost font-mono text-[10px]">{calidad.valor.cruda}</span>
            ) : null}
            <BadgeSalud
              descriptor={
                DESCRIPTOR_CALIDAD[calidad.estado === "ok" ? calidad.valor.calidad : "sin-datos"]
              }
            />
          </span>
        </FilaDato>

        <FilaDato etiqueta="Escalón">
          <span className="text-ink-secondary font-mono text-[11.5px] font-medium tabular-nums">
            {escalon.estado === "ok" ? formatearEscalon(escalon.valor) : "sin dato"}
          </span>
        </FilaDato>

        <FilaDato etiqueta="Envío">
          <BadgeSalud descriptor={DESCRIPTOR_ENVIO[envio.estado]} />
        </FilaDato>
      </div>

      {avisos.map((a) => (
        <Nota key={a}>{a}</Nota>
      ))}

      {plantillasPausadas.estado === "sin-dato" ? (
        <Nota>{plantillasPausadas.motivo}</Nota>
      ) : plantillasPausadas.valor.length === 0 ? (
        <Nota>Ninguna plantilla pausada.</Nota>
      ) : (
        <ul className="flex flex-col gap-2">
          {plantillasPausadas.valor.map((p) => {
            const color = p.laUsaEstaDifusion ? "var(--color-danger)" : "var(--color-caution)";
            return (
              <li
                key={p.nombre}
                className="flex items-start gap-2.5 rounded-[9px] border px-3 py-2.5"
                style={{ borderColor: tinte(color, 34), backgroundColor: tinte(color, 8) }}
              >
                <Warning size={14} style={{ color }} aria-hidden className="mt-[1px] shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-mono text-[11.5px] font-medium" style={{ color }}>
                    {p.nombre}
                  </span>
                  <span className="text-ink-secondary text-[11px] leading-relaxed text-pretty">
                    {p.laUsaEstaDifusion
                      ? "Esta difusión la usa: mientras siga pausada, Meta rechaza cada envío (132015)."
                      : "Pausada por Meta. Esta difusión no la usa."}{" "}
                    La API no dice si vuelve sola o hay que despausarla a mano.
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Nota>{salud.fuente}</Nota>
    </div>
  );
}
