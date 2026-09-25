import {
  Done,
  ErrorIcon,
  HelpIcon,
  PauseIcon,
  Remove,
  Schedule,
  Warning,
} from "@/components/icons";
import type {
  Calidad,
  EnvioSegunMeta,
  EstadoPlantilla,
  EstadoPlantillaLeida,
} from "@/components/ajustes/tipos";
import type { ComponentType } from "react";

export interface Descriptor {
  label: string;
  glifo: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  color: string;
}

/**
 * Calidad de un número, tal como la reporta Meta.
 *
 * Cada valor trae su glifo porque el color no alcanza. Antes del
 * re-escalonado de tokens del 2026-09-03, ámbar (media) y rojo (baja) se
 * separaban ΔE 9.9 en visión normal —piso duro 15— y 2.8 en deuteranopía: un
 * semáforo de tres puntitos de color, que es lo que dibuja todo el mundo,
 * dejaba "media" y "baja" indistinguibles justo cuando la diferencia entre las
 * dos es seguir vendiendo o no.
 *
 * Hoy ese par da 15.2 normal / 6.0 en deuteranopía
 * (`node scripts/verificar-paleta-clara.mjs`). Pasó el piso duro, pero 6.0
 * sigue estando en la banda 6-8 que el validador admite SÓLO con codificación
 * secundaria — y en claro no hay hex que lo saque de ahí, porque el arco
 * cálido no da para `warn`, `caution` y `danger` a la vez. El glifo se queda.
 */
export const DESCRIPTOR_CALIDAD: Record<Calidad, Descriptor> = {
  alta: { label: "Alta", glifo: Done, color: "var(--color-ok)" },
  media: { label: "Media", glifo: Warning, color: "var(--color-caution)" },
  baja: { label: "Baja", glifo: ErrorIcon, color: "var(--color-danger)" },
  "sin-datos": { label: "Sin datos", glifo: HelpIcon, color: "var(--color-ink-faint)" },
};

/** Estado de una plantilla en el administrador de Meta. */
export const DESCRIPTOR_PLANTILLA: Record<EstadoPlantilla, Descriptor> = {
  aprobada: { label: "Aprobada", glifo: Done, color: "var(--color-ok)" },
  "en-revision": { label: "En revisión", glifo: Schedule, color: "var(--color-info)" },
  pausada: { label: "Pausada", glifo: PauseIcon, color: "var(--color-caution)" },
  rechazada: { label: "Rechazada", glifo: ErrorIcon, color: "var(--color-danger)" },
  deshabilitada: { label: "Deshabilitada", glifo: Remove, color: "var(--color-ink-faint)" },
};

/**
 * Un estado de Meta sin traducción. Gris y con signo de pregunta: no es bueno
 * ni malo, es "Meta dice otra cosa", y la nota de la fila dice cuál.
 */
export const DESCRIPTOR_PLANTILLA_OTRA: Descriptor = {
  label: "Otro",
  glifo: HelpIcon,
  color: "var(--color-ink-faint)",
};

export function descriptorDePlantilla(estado: EstadoPlantillaLeida): Descriptor {
  return estado === "otro" ? DESCRIPTOR_PLANTILLA_OTRA : DESCRIPTOR_PLANTILLA[estado];
}

/**
 * Si se puede mandar, según `health_status`. Mismo orden que los demás: glifo,
 * palabra y recién después color. El rojo queda para `bloqueado`, que es lo
 * único de esta escala que ya dejó de vender.
 */
export const DESCRIPTOR_ENVIO: Record<EnvioSegunMeta["estado"], Descriptor> = {
  disponible: { label: "Puede enviar", glifo: Done, color: "var(--color-ok)" },
  limitado: { label: "Envío limitado", glifo: Warning, color: "var(--color-caution)" },
  bloqueado: { label: "Envío bloqueado", glifo: ErrorIcon, color: "var(--color-danger)" },
  "sin-dato": { label: "Sin dato", glifo: HelpIcon, color: "var(--color-ink-faint)" },
};
