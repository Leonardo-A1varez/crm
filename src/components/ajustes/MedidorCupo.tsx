import { Fragment } from "react";
import { Done, ErrorIcon, HelpIcon, Warning } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { formatearEntero } from "@/lib/ui/metricas";
import { cn } from "@/lib/utils";
import type { CondicionCalidad, EstadoCupo, UsoDelCupo } from "@/components/ajustes/tipos";
import type { ComponentType, ReactNode } from "react";

/** Tinte del propio color, para fondos. Igual que en `workflows/lista`. */
function tinte(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

const OK = "var(--color-ok)";
const FALTA = "var(--color-caution)";
const SIN_DATO = "var(--color-ink-faint)";

type EstadoCondicion = "cumplida" | "falta" | "sin-dato";

/**
 * El medidor de nivel de cupo (tier), con las dos condiciones que gobiernan el
 * ascenso.
 *
 * ================== POR QUÉ NO ES UNA BARRA DE PROGRESO ==================
 *
 * Todas las herramientas del rubro dibujan esto como "57% para el próximo
 * nivel", y esa barra miente de tres formas a la vez:
 *
 *   1. Sugiere UNA dimensión. Son dos condiciones independientes y hay que
 *      cumplir las dos: calidad alta en todos los números y plantillas Y haber
 *      usado al menos la mitad del cupo. Una barra sola no puede estar en "una
 *      sí y la otra no", que es justo el estado en el que uno vive.
 *   2. Sugiere que más siempre es mejor y que menos es neutro. Es falso al
 *      revés: mandar POCO también congela el ascenso.
 *   3. Sugiere que el progreso se acumula. No se acumula: el uso se mide sobre
 *      una ventana móvil.
 *
 * Lo que se dibuja en cambio: las dos condiciones como dos filas unidas por
 * una "y" que se ve, el uso como VENTANA (piso y techo, con la zona que
 * descalifica rayada) y un veredicto en una línea que nombra cuál frena.
 *
 * ====================== LO QUE LA API NO DICE ======================
 *
 * Meta expone el peldaño, no el uso. Cuando una condición no se puede leer,
 * se dibuja en gris con "sin dato" y el motivo: ni verde ni ámbar, porque
 * cualquiera de los dos afirmaría algo que nadie midió. Y en el primer peldaño
 * no hay condiciones sino vías de desbloqueo, así que se muestran esas.
 */
export function MedidorCupo({ estado }: { estado: EstadoCupo }) {
  const { peldanos, actual, calidad, uso, minimoPct, ventanaDias, desbloqueo } = estado;

  const peldanoActual = peldanos[actual];
  const siguiente = peldanos[actual + 1];

  return (
    <section className="border-line-card bg-surface-card flex flex-col gap-4 rounded-[14px] border p-5">
      <div className="flex items-center gap-2.5">
        <Eyebrow>Nivel del portfolio</Eyebrow>
        <span className="bg-surface-input text-ink-secondary rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-medium">
          compartido entre todos los números
        </span>
      </div>

      <div className="flex items-baseline gap-2.5">
        <span className="text-ink-primary font-mono text-[30px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
          {peldanoActual?.etiqueta ?? "—"}
        </span>
        <span className="text-ink-faint text-[12px] text-pretty">
          destinatarios distintos cada 24 h, fuera de la ventana de servicio · leído de la API de
          Meta
        </span>
      </div>

      <EscaleraCupo peldanos={peldanos} actual={actual} />

      {siguiente === undefined ? (
        <p className="text-ink-faint text-[11.5px] leading-relaxed">
          Es el peldaño más alto. No hay ascenso pendiente.
        </p>
      ) : desbloqueo !== null ? (
        <Desbloqueo siguiente={siguiente.etiqueta} vias={desbloqueo} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-ink-secondary text-[11.5px] leading-relaxed">
            Para subir a{" "}
            <span className="text-ink-primary font-mono font-semibold">{siguiente.etiqueta}</span>{" "}
            hacen falta las dos condiciones. Con una sola, el nivel no se mueve.
          </p>

          <Condicion
            numero={1}
            titulo="Calidad alta en todos los números y plantillas"
            estado={calidad.estado}
            detalle={detalleDeCalidad(calidad)}
          />

          {/*
            La "y" dibujada. Dos requisitos apilados se leen como una lista, y
            una lista no dice si hay que cumplir todos o alcanza con uno.
          */}
          <Conector letra="y" />

          <CondicionDeUso uso={uso} minimoPct={minimoPct} ventanaDias={ventanaDias} />

          <Veredicto
            calidad={calidad}
            uso={uso}
            minimoPct={minimoPct}
            ventanaDias={ventanaDias}
            siguiente={siguiente.etiqueta}
          />
        </div>
      )}

      <p className="text-ink-ghost text-[10.5px] leading-relaxed">
        Comprar más números no multiplica el cupo: el cupo es del portfolio, no de cada número.
      </p>
    </section>
  );
}

function detalleDeCalidad(calidad: CondicionCalidad): string {
  switch (calidad.estado) {
    case "cumplida":
      return "Ningún número ni plantilla está en calidad media o baja.";
    case "falta":
      return `Todavía no: ${calidad.pendientes.join(", ")}.`;
    case "sin-dato":
      return calidad.motivo;
  }
}

/**
 * Los peldaños del cupo. Segmentos y no una barra continua: el cupo salta de un
 * valor al siguiente, no crece de a poco.
 */
function EscaleraCupo({
  peldanos,
  actual,
}: {
  peldanos: readonly { etiqueta: string }[];
  actual: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-0.5">
        {peldanos.map((p, i) => (
          <span
            key={p.etiqueta}
            className={cn(
              "h-[6px] flex-1 rounded-full",
              i > actual && "bg-surface-input",
              i < actual && "opacity-45",
            )}
            style={i <= actual ? { backgroundColor: OK } : undefined}
          />
        ))}
      </div>
      <ol className="flex gap-0.5">
        {peldanos.map((p, i) => (
          <li
            key={p.etiqueta}
            aria-current={i === actual ? "true" : undefined}
            className={cn(
              "flex-1 truncate font-mono text-[10px] tabular-nums",
              i === actual
                ? "text-ink-primary font-semibold"
                : i < actual
                  ? "text-ink-faint"
                  : "text-ink-ghost",
            )}
          >
            {p.etiqueta}
            {i === actual ? <span className="sr-only"> (nivel actual)</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** La conjunción o la disyunción, dibujada: ocupa lugar en la página. */
function Conector({ letra }: { letra: string }) {
  return (
    <div aria-hidden className="flex items-center gap-2.5">
      <span className="border-line-control text-ink-secondary rounded-full border px-2.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.13em] uppercase">
        {letra}
      </span>
      <span className="bg-line-card h-px flex-1" />
    </div>
  );
}

/**
 * Del primer peldaño Meta no sube por uso: alcanza con UNA de varias vías.
 * Mismo dibujo que las condiciones pero unidas por una "o", porque la
 * diferencia entre "hacen falta todas" y "alcanza con una" es justo lo que hay
 * que leer acá.
 */
function Desbloqueo({ siguiente, vias }: { siguiente: string; vias: readonly string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-secondary text-[11.5px] leading-relaxed">
        Para subir a <span className="text-ink-primary font-mono font-semibold">{siguiente}</span>{" "}
        Meta no mira el uso: alcanza con una de estas vías.
      </p>
      <ul className="flex flex-col gap-2">
        {vias.map((via, i) => (
          <Fragment key={via}>
            {i > 0 ? (
              <li aria-hidden className="list-none">
                <Conector letra="o" />
              </li>
            ) : null}
            <li className="border-line-card text-ink-secondary rounded-[11px] border px-3.5 py-2.5 text-[11.5px] leading-relaxed text-pretty">
              {via}
            </li>
          </Fragment>
        ))}
      </ul>
      <p className="text-ink-faint text-[11px] leading-relaxed">
        Esta pantalla no lee si alguna ya se cumplió.
      </p>
    </div>
  );
}

function Condicion({
  numero,
  titulo,
  estado,
  detalle,
  children,
}: {
  numero: number;
  titulo: string;
  estado: EstadoCondicion;
  detalle: string;
  children?: ReactNode;
}) {
  const color = estado === "cumplida" ? OK : estado === "falta" ? FALTA : SIN_DATO;
  const Glifo = estado === "cumplida" ? Done : estado === "falta" ? Warning : HelpIcon;
  const etiqueta = estado === "cumplida" ? "cumplida" : estado === "falta" ? "falta" : "sin dato";
  const neutra = estado === "sin-dato";

  return (
    <div
      className={cn("flex flex-col gap-2.5 rounded-[11px] border p-3.5", neutra && "border-dashed")}
      style={
        neutra
          ? { borderColor: "var(--color-line-control)" }
          : { borderColor: tinte(color, 30), backgroundColor: tinte(color, 6) }
      }
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold"
          style={{ color, backgroundColor: tinte(color, 16) }}
        >
          {numero}
        </span>
        <h3 className="text-ink-primary min-w-0 flex-1 text-[12px] leading-snug font-[650] text-balance">
          {titulo}
        </h3>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10.5px] leading-none font-semibold"
          style={{ color, backgroundColor: tinte(color, 14) }}
        >
          <Glifo size={11} strokeWidth={2.5} aria-hidden />
          {etiqueta}
        </span>
      </div>
      {children}
      <p className="text-ink-faint text-[11px] leading-relaxed text-pretty">{detalle}</p>
    </div>
  );
}

function CondicionDeUso({
  uso,
  minimoPct,
  ventanaDias,
}: {
  uso: UsoDelCupo;
  minimoPct: number;
  ventanaDias: number;
}) {
  const titulo = `Usar al menos el ${formatearEntero(minimoPct)}% del cupo en los últimos ${formatearEntero(ventanaDias)} días`;

  if (!uso.disponible) {
    return <Condicion numero={2} titulo={titulo} estado="sin-dato" detalle={uso.motivo} />;
  }

  const alcanza = uso.pct >= minimoPct;
  const sostenido = uso.diasFaltantes === null || uso.diasFaltantes <= 0;
  const cumplida = alcanza && sostenido;
  const diasHechos =
    uso.diasFaltantes === null ? ventanaDias : Math.max(0, ventanaDias - uso.diasFaltantes);

  return (
    <Condicion
      numero={2}
      titulo={titulo}
      estado={cumplida ? "cumplida" : "falta"}
      detalle={
        cumplida
          ? "El uso viene alcanzando el mínimo en toda la ventana."
          : !alcanza
            ? `Mandando de menos. Con ${formatearEntero(uso.pct)}% del cupo el ascenso queda congelado, aunque la calidad esté impecable.`
            : `El uso de hoy alcanza. Faltan ${formatearEntero(uso.diasFaltantes ?? 0)} días sosteniéndolo.`
      }
    >
      <VentanaDeUso usoPct={uso.pct} minimoPct={minimoPct} />
      <DiasSostenidos hechos={diasHechos} total={ventanaDias} />
    </Condicion>
  );
}

/**
 * El uso como ventana y no como progreso. La zona rayada es la que
 * descalifica; se dibuja con rayas y no con un color más pálido porque las
 * rayas siguen estando cuando el color no: impresión en gris, daltonismo,
 * forced-colors.
 */
function VentanaDeUso({ usoPct, minimoPct }: { usoPct: number; minimoPct: number }) {
  const cortado = Math.max(0, Math.min(100, usoPct));
  const piso = Math.max(0, Math.min(100, minimoPct));
  const alcanza = usoPct >= minimoPct;
  const color = alcanza ? OK : FALTA;

  return (
    <div className="flex flex-col gap-1.5">
      {/*
        El orden de las capas es el mensaje: primero el relleno —cuánto se
        mandó— y ENCIMA el rayado de la zona que no califica. Al revés, el
        relleno tapa el rayado apenas se manda algo.
      */}
      <div className="bg-surface-input relative h-[22px] overflow-hidden rounded-[7px]">
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-r-[3px]"
          style={{ width: `${cortado}%`, backgroundColor: tinte(color, 55) }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{
            width: `${piso}%`,
            backgroundImage:
              "repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-ink-primary) 30%, transparent) 0 1.5px, transparent 1.5px 6px)",
          }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 w-[2px]"
          style={{ left: `${piso}%`, backgroundColor: "var(--color-ink-primary)" }}
        />
      </div>

      <div className="relative h-[13px]">
        <span
          className="text-ink-primary absolute top-0 -translate-x-1/2 font-mono text-[9.5px] whitespace-nowrap tabular-nums"
          style={{ left: `${piso}%` }}
        >
          {formatearEntero(minimoPct)}% mínimo
        </span>
        <span className="text-ink-ghost absolute top-0 right-0 font-mono text-[9.5px]">cupo</span>
      </div>

      <p className="text-[11px] leading-none">
        <span className="font-mono font-semibold tabular-nums" style={{ color }}>
          {formatearEntero(usoPct)}%
        </span>{" "}
        <span className="text-ink-faint">
          del cupo usado {alcanza ? "— arriba del mínimo" : "— debajo del mínimo"}
        </span>
      </p>
    </div>
  );
}

/** Los días de uso sostenido, uno por casilla: son pocos y discretos. */
function DiasSostenidos({ hechos, total }: { hechos: number; total: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex gap-0.5"
        role="img"
        aria-label={`${formatearEntero(hechos)} de ${formatearEntero(total)} días de uso sostenido`}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn("h-[10px] w-[10px] rounded-[3px]", i >= hechos && "bg-surface-input")}
            style={i < hechos ? { backgroundColor: tinte(OK, 70) } : undefined}
          />
        ))}
      </span>
      <span className="text-ink-faint font-mono text-[10.5px] tabular-nums">
        {formatearEntero(hechos)}/{formatearEntero(total)} días
      </span>
    </div>
  );
}

interface TonoVeredicto {
  texto: string;
  color: string;
  Glifo: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  neutro: boolean;
}

/**
 * Cuál de las dos condiciones está frenando, dicho en una línea. Si la calidad
 * bajó, subir el volumen no sirve de nada —y el reflejo es justamente mandar
 * más—: decir cuál manda evita la maniobra equivocada. Si lo que falta es un
 * dato, se dice que falta el dato, no se adivina el veredicto.
 */
function Veredicto({
  calidad,
  uso,
  minimoPct,
  ventanaDias,
  siguiente,
}: {
  calidad: CondicionCalidad;
  uso: UsoDelCupo;
  minimoPct: number;
  ventanaDias: number;
  siguiente: string;
}) {
  const { texto, color, Glifo, neutro } = ((): TonoVeredicto => {
    if (calidad.estado === "falta") {
      const uno = calidad.pendientes.length === 1;
      return {
        texto: `La calidad manda: mientras ${calidad.pendientes.join(" y ")} no ${uno ? "esté" : "estén"} en calidad alta, el ascenso está congelado aunque el volumen sobre.`,
        color: "var(--color-danger)",
        Glifo: ErrorIcon,
        neutro: false,
      };
    }

    const faltaSaber = [
      calidad.estado === "sin-dato" ? "la calidad" : null,
      uso.disponible ? null : `el uso de los últimos ${formatearEntero(ventanaDias)} días`,
    ].filter((x): x is string => x !== null);
    if (faltaSaber.length > 0) {
      return {
        texto: `Con lo que expone la API no alcanza para decir si el cupo puede subir: falta saber ${faltaSaber.join(" y ")}. Cuando se cumplen las dos condiciones, Meta sube el nivel por su cuenta.`,
        color: SIN_DATO,
        Glifo: HelpIcon,
        neutro: true,
      };
    }

    if (uso.disponible && uso.pct < minimoPct) {
      return {
        texto:
          "La calidad ya está. Falta volumen: el cupo se sube usándolo, y con este ritmo el nivel no se mueve.",
        color: FALTA,
        Glifo: Warning,
        neutro: false,
      };
    }
    if (uso.disponible && uso.diasFaltantes !== null && uso.diasFaltantes > 0) {
      return {
        texto: `Las dos condiciones van bien. Falta que el uso se sostenga ${formatearEntero(uso.diasFaltantes)} días más.`,
        color: FALTA,
        Glifo: Warning,
        neutro: false,
      };
    }
    return {
      texto: `Las dos condiciones están dadas. El ascenso a ${siguiente} lo aplica Meta por su cuenta, en hasta 6 horas; no hay nada que apretar acá.`,
      color: OK,
      Glifo: Done,
      neutro: false,
    };
  })();

  return (
    <p
      className={cn(
        "flex items-start gap-2.5 rounded-[11px] px-3.5 py-3 text-[11.5px] leading-relaxed text-pretty",
        neutro && "bg-surface-input text-ink-secondary",
      )}
      style={neutro ? undefined : { color, backgroundColor: tinte(color, 9) }}
    >
      <Glifo
        size={14}
        strokeWidth={2.25}
        className={cn("mt-px shrink-0", neutro && "text-ink-faint")}
        aria-hidden
      />
      <span>{texto}</span>
    </p>
  );
}
