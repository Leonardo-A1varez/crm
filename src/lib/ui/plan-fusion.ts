import type { Lead } from "@/types/entities";

/**
 * Qué le va a pasar a cada campo cuando se fusionen dos leads.
 *
 * Existe para que quien aprueba una fusión vea **antes** qué sobrevive y qué se
 * descarta, en vez de descubrirlo después sobre un lead que ya se borró. Es la
 * diferencia entre "estos dos se parecen" y "esto es lo que voy a perder".
 *
 * Espeja las reglas de `approve_lead_merge` (migración `20260814120000`), que
 * es la autoridad en producción. Si esa función cambia, este módulo miente: los
 * tests de acá son lo que obliga a tocar los dos juntos.
 */

/** Los campos que el merge copia del perdedor cuando el ganador los tiene vacíos. */
const CAMPOS_QUE_SE_RELLENAN = [
  "email",
  "direccion",
  "vehiculo_motor",
  "vehiculo_marca",
  "vehiculo_modelo",
  "vehiculo_anio",
  "nombre_perfil",
] as const;

export type DestinoCampo =
  /** Los dos tienen el mismo valor: la fusión no cambia nada. */
  | "iguales"
  /** Ninguno tiene valor. */
  | "vacios"
  /** Solo el ganador tiene valor: queda como está. */
  | "solo_ganador"
  /** El ganador está vacío y el perdedor tiene: se copia al ganador. */
  | "se_copia"
  /** Los dos tienen valor distinto: gana el ganador y el del perdedor se pierde. */
  | "se_descarta";

export interface FilaComparacion {
  /** Rótulo legible, en castellano. */
  campo: string;
  ganador: string;
  perdedor: string;
  destino: DestinoCampo;
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") return valor === 0 ? "" : String(valor);
  return String(valor).trim();
}

/**
 * Las claves de un jsonb, ordenadas. Es lo comparable de `meta_user_ids` y
 * `datos_extra`: los valores son ids opacos y mostrarlos no ayuda a decidir,
 * pero saber qué canales aporta cada lead sí.
 *
 * `object` y no `Record<string, unknown>`: `MetaUserIds` es un tipo con claves
 * fijas (`wa`/`ig`/`fb`) y no tiene index signature.
 */
function claves(valor: object | null | undefined): string {
  if (!valor) return "";
  return Object.keys(valor).sort().join(", ");
}

function destino(g: string, p: string, seRellena: boolean): DestinoCampo {
  if (g === "" && p === "") return "vacios";
  if (g === p) return "iguales";
  if (g === "") return seRellena ? "se_copia" : "solo_ganador";
  if (p === "") return "solo_ganador";
  // Los dos tienen valor y difieren: el ganador manda, sin importar si el campo
  // se rellena o no — `coalesce(g.campo, ...)` solo actúa sobre el nulo.
  return "se_descarta";
}

function fila(campo: string, g: unknown, p: unknown, seRellena: boolean): FilaComparacion {
  const ganador = texto(g);
  const perdedor = texto(p);
  return { campo, ganador, perdedor, destino: destino(ganador, perdedor, seRellena) };
}

/**
 * La comparación campo por campo, en el orden en que se lee una ficha.
 *
 * `nombre`, `telefono` y `canal_origen` **no** están entre los que se rellenan:
 * el merge nunca los toca, así que un valor distinto del perdedor se pierde. Se
 * muestran igual —son los que identifican a la persona— justamente para que esa
 * pérdida se vea antes de confirmar.
 */
export function planDeFusion(ganador: Lead, perdedor: Lead): FilaComparacion[] {
  const rellena = (campo: string) => (CAMPOS_QUE_SE_RELLENAN as readonly string[]).includes(campo);

  return [
    fila("Nombre", ganador.nombre, perdedor.nombre, rellena("nombre")),
    fila(
      "Nombre de perfil",
      ganador.nombre_perfil,
      perdedor.nombre_perfil,
      rellena("nombre_perfil"),
    ),
    fila("Teléfono", ganador.telefono, perdedor.telefono, rellena("telefono")),
    fila("Email", ganador.email, perdedor.email, rellena("email")),
    fila("Dirección", ganador.direccion, perdedor.direccion, rellena("direccion")),
    fila("Marca", ganador.vehiculo_marca, perdedor.vehiculo_marca, rellena("vehiculo_marca")),
    fila("Modelo", ganador.vehiculo_modelo, perdedor.vehiculo_modelo, rellena("vehiculo_modelo")),
    fila("Año", ganador.vehiculo_anio, perdedor.vehiculo_anio, rellena("vehiculo_anio")),
    fila("Motor", ganador.vehiculo_motor, perdedor.vehiculo_motor, rellena("vehiculo_motor")),
    fila("Canal de origen", ganador.canal_origen, perdedor.canal_origen, rellena("canal_origen")),
    // Las identidades de Meta se unen (el ganador prima por canal), así que
    // nunca se descarta ninguna: se listan las claves para que se vea qué gana
    // el ganador.
    {
      campo: "Identidades Meta",
      ganador: claves(ganador.meta_user_ids),
      perdedor: claves(perdedor.meta_user_ids),
      destino: unionDestino(claves(ganador.meta_user_ids), claves(perdedor.meta_user_ids)),
    },
    {
      campo: "Campos libres",
      ganador: claves(ganador.datos_extra),
      perdedor: claves(perdedor.datos_extra),
      destino: unionDestino(claves(ganador.datos_extra), claves(perdedor.datos_extra)),
    },
  ];
}

/**
 * `meta_user_ids` y `datos_extra` se unen en vez de pisarse, así que lo del
 * perdedor nunca se pierde entero: o ya estaba, o se suma.
 */
function unionDestino(g: string, p: string): DestinoCampo {
  if (g === "" && p === "") return "vacios";
  if (g === p) return "iguales";
  if (p === "") return "solo_ganador";
  return "se_copia";
}

/** Solo las filas donde la fusión cambia algo. Es lo que hay que mirar. */
export function filasQueCambian(filas: FilaComparacion[]): FilaComparacion[] {
  return filas.filter((f) => f.destino === "se_copia" || f.destino === "se_descarta");
}

/** Cuántos valores del perdedor se van a perder. Cero significa fusión limpia. */
export function contarDescartes(filas: FilaComparacion[]): number {
  return filas.filter((f) => f.destino === "se_descarta").length;
}
