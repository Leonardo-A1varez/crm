import type { EscalonSancion } from "@/components/ajustes";

/**
 * Lo que Meta publica sobre límites y sanciones y NO devuelve por API.
 *
 * Es la única parte de `/ajustes` escrita a mano, y por eso cada valor lleva
 * su fuente. Leído el 2026-09-13 con WebFetch (un resumen de la página oficial,
 * o sea de segunda mano), y contrastado con `docs/prd-workflows-difusion.md`
 * §4.1 y §4.6, que ya lo marcaban [VERIFICADO]:
 *
 *   - https://developers.facebook.com/docs/whatsapp/messaging-limits
 *   - https://developers.facebook.com/docs/whatsapp/overview/policy-enforcement
 *
 * Si Meta cambia algo de esto, la pantalla va a mentir hasta que alguien lo
 * edite acá: no hay endpoint del cual leerlo.
 */

/** Los escalones del límite de mensajería, de menor a mayor. */
export const ESCALERA_DE_LIMITES: readonly (number | "ilimitado")[] = [
  250,
  2000,
  10000,
  100000,
  "ilimitado",
];

/** "In the last 7 days, your business has utilized at least half of your current messaging limit." */
export const MINIMO_DE_USO_PCT = 50;
export const VENTANA_DE_USO_DIAS = 7;

/**
 * Del primer escalón al segundo Meta no sube por uso: alcanza con cualquiera
 * de estas tres vías.
 */
export const DESBLOQUEO_PRIMER_ESCALON: readonly string[] = [
  "Verificar el negocio en Meta.",
  "Que un partner de Meta verifique el negocio.",
  "Entregar 2.000 mensajes fuera de la ventana de servicio, a números distintos, en 30 días móviles y con plantillas de calidad alta.",
];

/**
 * La escalera de la página de policy enforcement, en su orden. Las duraciones
 * son las de la política; la apelación sólo se nombra donde la política la
 * nombra (el bloqueo de cuenta "requires appeal").
 */
export const ESCALERA_DE_SANCIONES: readonly EscalonSancion[] = [
  {
    id: "advertencia",
    nombre: "Advertencia",
    consecuencia: "Meta avisa qué política se infringió. Todavía no bloquea nada.",
    duracion: "sin bloqueo",
    apelacion: null,
  },
  {
    id: "bloqueo-plantillas",
    nombre: "Bloqueo de plantillas",
    consecuencia: "No salen plantillas de marketing, utility ni authentication.",
    duracion: "1 o 3 días",
    apelacion: null,
  },
  {
    id: "bloqueo-mensajes",
    nombre: "Bloqueo de mensajes",
    consecuencia: "No sale ningún mensaje, de ningún tipo.",
    duracion: "5, 7 o 30 días",
    apelacion: null,
  },
  {
    id: "cuenta-bloqueada",
    nombre: "Cuenta bloqueada",
    consecuencia: "La cuenta queda trabada hasta que Meta resuelva una apelación.",
    duracion: "indefinido",
    apelacion: "requiere apelación",
  },
  {
    id: "deshabilitada",
    nombre: "Deshabilitada",
    consecuencia: "Meta deshabilita la cuenta de forma permanente.",
    duracion: "permanente",
    apelacion: null,
  },
];

export const NOTA_SANCIONES =
  "Es la escalera de la política de Meta. Las infracciones graves —estafas, explotación infantil, terrorismo, drogas ilegales— no pasan por ella: la baja es inmediata.";
