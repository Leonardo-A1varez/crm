import { BadgeSalud } from "@/components/ajustes/BadgeSalud";
import { DESCRIPTOR_CALIDAD, DESCRIPTOR_ENVIO } from "@/components/ajustes/descriptores";
import { Eyebrow } from "@/components/shared/Eyebrow";
import type { EnvioSegunMeta, NumeroWhatsApp } from "@/components/ajustes/tipos";

const COLUMNAS = "grid-cols-[200px_1fr_120px_1.3fr]";

/**
 * Los números de la cuenta con su calidad y si pueden mandar.
 *
 * El número va en mono, y no por decoración: se compara contra el que está en
 * la consola de Meta y contra el que aparece en un mensaje de error, y con las
 * cifras del mismo ancho las diferencias saltan solas.
 *
 * La calidad lleva al lado el valor crudo de Meta (`GREEN`, `NA`…). La
 * traducción a alta/media/baja no está verificada contra un documento de Meta
 * (ver `vistas.ts`), y el crudo deja cotejarla sin tener que creerle a esta
 * pantalla.
 */
export function TablaNumeros({
  numeros,
  nota,
}: {
  numeros: readonly NumeroWhatsApp[];
  /** Por qué la lista está incompleta, si lo está. */
  nota: string | null;
}) {
  return (
    <section className="border-line-card bg-surface-card overflow-hidden rounded-[14px] border">
      <div className="border-line-row border-b px-5 py-3.5">
        <Eyebrow>Números</Eyebrow>
      </div>

      <div
        className={`bg-surface-input text-ink-faint border-line-row grid ${COLUMNAS} gap-3.5 border-b px-5 py-2.5 font-mono text-[9px] font-semibold tracking-[0.08em] uppercase`}
      >
        <span>número</span>
        <span>nombre en whatsapp</span>
        <span>calidad</span>
        <span>envío</span>
      </div>

      {numeros.length === 0 ? (
        <p className="text-ink-faint px-5 py-3 text-[11.5px]">
          Meta no devolvió ningún número de la cuenta.
        </p>
      ) : (
        <ul>
          {numeros.map((n) => (
            <li
              key={n.id}
              className={`border-line-row grid ${COLUMNAS} items-start gap-3.5 border-b px-5 py-3 last:border-b-0`}
            >
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="text-ink-primary max-w-full truncate font-mono text-[12px] font-medium tabular-nums">
                  {n.numero}
                </span>
                {n.esElConfigurado ? (
                  <span className="bg-surface-input text-ink-secondary rounded-[6px] px-1.5 py-0.5 text-[10px] leading-none font-semibold">
                    este CRM
                  </span>
                ) : null}
              </span>
              <span
                className={
                  n.nombre === null
                    ? "text-ink-ghost truncate text-[11.5px]"
                    : "text-ink-secondary truncate text-[11.5px]"
                }
              >
                {n.nombre ?? "sin nombre verificado"}
              </span>
              <span className="flex flex-col items-start gap-1">
                <BadgeSalud descriptor={DESCRIPTOR_CALIDAD[n.calidad]} />
                {n.calidadCruda !== null ? (
                  <span className="text-ink-ghost font-mono text-[10px]">{n.calidadCruda}</span>
                ) : null}
              </span>
              <Envio envio={n.envio} />
            </li>
          ))}
        </ul>
      )}

      {nota !== null ? (
        <p className="text-ink-ghost border-line-row border-t px-5 py-3 text-[10.5px] leading-relaxed text-pretty">
          {nota}
        </p>
      ) : null}
    </section>
  );
}

function Envio({ envio }: { envio: EnvioSegunMeta }) {
  const texto =
    envio.estado === "limitado" || envio.estado === "bloqueado"
      ? envio.detalle
      : envio.estado === "sin-dato"
        ? envio.motivo
        : null;

  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <BadgeSalud descriptor={DESCRIPTOR_ENVIO[envio.estado]} />
      {texto !== null ? (
        <span className="text-ink-faint text-[11px] leading-snug text-pretty">{texto}</span>
      ) : null}
    </span>
  );
}
