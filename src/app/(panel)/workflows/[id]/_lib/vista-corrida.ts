import { campoHoraEnZona } from "@/lib/zona-horaria";
import { duracionLegible } from "../../_lib/historial";
import { nombreDeTipo } from "./presentacion-nodos";

import type {
  EnvioRepetido,
  PasoCorrida,
  PreviaReanudar,
  PreviaRepetir,
} from "@/components/workflows/editor";
import type { MotivoSinReanudar, VistaCorrida } from "@/server/services/workflows/corridas.service";
import type { WorkflowRunEstado, WorkflowRunPaso } from "@/types/entities";

/**
 * La corrida como la dibuja `CorridaEnVivo`, a partir de lo que devuelve
 * `obtenerCorridaAction`.
 *
 * Toda decisión viene del servidor —qué estado tiene cada nodo, qué se reusa
 * al reanudar, qué mensajes se repetirían—; acá sólo se le pone nombre, hora y
 * duración. Las horas van en la zona del negocio (`lib/zona-horaria.ts`),
 * nunca en la del navegador: el vendedor que mira desde otro país tiene que ver
 * la misma hora que figura en el WhatsApp.
 */

export interface PantallaCorrida {
  pasos: PasoCorrida[];
  reanudar: PreviaReanudar;
  repetir: PreviaRepetir;
  identificacion: string;
  enVivo: boolean;
  /** En qué quedó la corrida: el cartel de la suscripción lo dice en vez de "en vivo". */
  estado: WorkflowRunEstado;
  esPrueba: boolean;
  topePasos: number;
  /** Lo que mandó la corrida (o habría mandado, si es de Probar), en orden. */
  mensajes: MensajeEnPantalla[];
  /** Por dónde pasaron las corridas de esta versión en 30 días. */
  porNodo: {
    corridas: number;
    vivas: number;
    nodos: {
      nodoId: string;
      nombre: string;
      corridas: number;
      fallaron: number;
      esperando: number;
    }[];
  };
}

export interface MensajeEnPantalla {
  clave: string;
  /** `null`: ya no se puede leer (purga de sesiones). */
  texto: string | null;
  hora: string;
  estado: string | null;
  simulado: boolean;
}

const MOTIVO: Record<MotivoSinReanudar, string> = {
  corrida_no_fallada: "La corrida no falló: no hay nada que reanudar.",
  corrida_de_prueba:
    "Es una corrida de Probar: corrió sin mandar nada de verdad, y no se reanuda ni se ejecuta de nuevo con el motor real. Para repetirla, probá el flujo otra vez desde el editor.",
  sin_paso_fallado: "Falló antes de ejecutar un paso: no hay desde dónde reanudarla.",
  tope_pasos:
    "Llegó al tope de pasos de su versión: reanudarla volvería a cortarse en el mismo lugar.",
};

/** Un `Date` de la vista. Llega como `Date` por la Server Action; se acepta texto por las dudas. */
function instante(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Un valor de entrada o salida como texto de una línea. Sin llaves: esto lo lee una persona. */
function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function comoPares(
  valor: Record<string, unknown> | null,
  extra?: Record<string, string>,
): Record<string, string> | undefined {
  const pares: Record<string, string> = {};
  for (const [k, v] of Object.entries(valor ?? {})) pares[k] = comoTexto(v);
  Object.assign(pares, extra);
  return Object.keys(pares).length > 0 ? pares : undefined;
}

export function pantallaDeCorrida(vista: VistaCorrida, zona: string): PantallaCorrida {
  const pasosPorOrden = new Map<number, WorkflowRunPaso>(vista.pasos.map((p) => [p.orden, p]));
  const hora = (at: Date | string) => campoHoraEnZona(zona, instante(at));
  const tipoDe = new Map(vista.version.grafo.nodos.map((n) => [n.id, n.tipo]));

  const pasos = vista.nodos.map((n): PasoCorrida => {
    const ultima = n.ultima;
    const paso = ultima ? pasosPorOrden.get(ultima.orden) : undefined;
    // Cuánto tardó: desde que terminó el paso anterior —o desde el arranque de
    // la corrida, si es el primero— hasta que terminó éste. Es la misma cuenta
    // que la línea de tiempo del historial.
    const desde = ultima
      ? (pasosPorOrden.get(ultima.orden - 1)?.created_at ?? vista.run.started_at)
      : undefined;
    return {
      nodoId: n.nodoId,
      nombre: nombreDeTipo(n.tipo),
      tipo: n.tipo,
      estado: n.estado,
      hora: ultima ? hora(ultima.at) : undefined,
      duracion:
        ultima && desde
          ? duracionLegible(instante(ultima.at).getTime() - instante(desde).getTime())
          : undefined,
      entrada: paso ? comoPares(paso.entrada) : undefined,
      salida: ultima
        ? comoPares(ultima.salida, ultima.error !== null ? { error: ultima.error } : undefined)
        : undefined,
    };
  });

  const r = vista.reanudar;
  const reanudar: PreviaReanudar = r.posible
    ? {
        posible: true,
        desdeNodo: r.desdeNodo,
        reusados: r.reusados.map((u) => ({ nodoId: u.nodoId, hora: hora(u.at) })),
      }
    : { posible: false, motivo: MOTIVO[r.motivo] };

  const e = vista.ejecutarDeNuevo;
  const repetir: PreviaRepetir = e.posible
    ? {
        posible: true,
        destinatario: e.destinatario.nombre ?? undefined,
        envios: e.envios.map(
          (envio): EnvioRepetido => ({
            nodoId: envio.nodoId,
            nombre: (() => {
              const tipo = tipoDe.get(envio.nodoId);
              return tipo ? nombreDeTipo(tipo) : envio.nodoId;
            })(),
            hora: hora(envio.enviadoAt),
            texto: envio.texto,
          }),
        ),
      }
    : { posible: false, motivo: MOTIVO[e.motivo] };

  return {
    pasos,
    reanudar,
    repetir,
    identificacion: [
      `#${vista.run.id.slice(0, 4)}`,
      vista.lead.nombre ?? "Lead sin nombre",
      ...(vista.lead.vehiculo ? [vista.lead.vehiculo] : []),
      `v${vista.version.numero}`,
    ].join(" · "),
    mensajes: vista.mensajes.map((m) => ({
      clave: `${m.nodoId}-${m.orden}`,
      texto: m.texto,
      hora: hora(m.at),
      estado: m.estado,
      simulado: m.simulado,
    })),
    porNodo: {
      corridas: vista.porNodo.corridas,
      vivas: vista.porNodo.vivas,
      nodos: vista.porNodo.nodos.map((n) => {
        const tipo = tipoDe.get(n.nodoId);
        // Un nodo que ya no está en el grafo de esta versión no puede pasar:
        // la versión es inmutable. Si pasa, se nombra por su id.
        return { ...n, nombre: tipo ? nombreDeTipo(tipo) : n.nodoId };
      }),
    },
    enVivo: vista.run.estado === "corriendo" || vista.run.estado === "esperando",
    estado: vista.run.estado,
    esPrueba: vista.esPrueba,
    topePasos: vista.version.maxPasos,
  };
}
