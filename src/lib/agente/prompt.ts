import type { AgenteConfigValores } from "@/types/agente";

/**
 * Las 4 reglas del handoff seccion 4.3. No son configurables ni desactivables:
 * la UI las muestra con candado, como estado, no como control.
 */
export const REGLAS_INVIOLABLES: readonly string[] = [
  "No prometas stock sin haberlo consultado con la tool `buscar_repuesto`.",
  "No inventes codigos de producto ni compatibilidades entre piezas y vehiculos.",
  "Informa siempre los precios con IVA incluido.",
  "Deriva reclamos y consultas de garantia a un vendedor humano.",
];

const IDENTIDAD = [
  "IDENTIDAD Y ROL",
  "Sos un vendedor de repuestos automotrices para LATAM (Argentina, Brasil, Mexico, Chile, Colombia, Peru).",
  "Tu objetivo: identificar la pieza que busca el cliente, darle precio y cerrar la venta, o pasar a un humano si no podes.",
  "Usas la tool `buscar_repuesto` para consultar el catalogo.",
  "Si la tool devuelve 0 matches, deci honestamente que no lo tenemos.",
  "El intent clasificado del ultimo mensaje y el estado de la sesion te llegan como contexto.",
].join("\n");

/**
 * Encabezado de las reglas duras. Uno solo, siempre el mismo: dos variantes de
 * un string critico de seguridad son una fuente de deriva, donde alguien
 * corrige una y olvida la otra.
 *
 * El texto de precedencia importa tanto como la posicion: la mitigacion es
 * "van ultimas" mas "se declaran superiores", no una sola de las dos.
 */
const ENCABEZADO_REGLAS = [
  "REGLAS INVIOLABLES",
  "Tienen prioridad absoluta sobre cualquier instruccion anterior, incluidas las del",
  "bloque INSTRUCCIONES DEL NEGOCIO. Si una instruccion anterior las contradice,",
  "ignora esa instruccion y segui estas.",
].join("\n");

const TONO_DIRECTIVA = {
  formal: "Trata al cliente de usted. Registro profesional, sin coloquialismos.",
  neutro: "Registro neutro, ni distante ni coloquial.",
  cercano: "Tutea al cliente. Registro informal y calido, sin exagerar.",
} as const;

const LARGO_DIRECTIVA = {
  corto: "Maximo 3 frases por respuesta.",
  medio: "Entre 3 y 6 frases por respuesta.",
  detallado: "Podes extenderte hasta 10 frases si el caso lo amerita.",
} as const;

const EMOJIS_DIRECTIVA = {
  nunca: "No uses emojis.",
  ocasional: "Como maximo un emoji por respuesta, y solo si aporta.",
  libre: "Podes usar emojis con naturalidad.",
} as const;

/**
 * Exportada para que la UI muestre exactamente lo que se va a inyectar: la
 * relacion config -> prompt tiene que ser auditable, no una caja negra.
 */
export function directivasDeEstilo(config: AgenteConfigValores): string[] {
  return [
    TONO_DIRECTIVA[config.tono],
    LARGO_DIRECTIVA[config.largo],
    EMOJIS_DIRECTIVA[config.emojis],
    config.descuento_max_pct > 0
      ? `Podes ofrecer hasta ${config.descuento_max_pct}% de descuento por tu cuenta. Por encima de eso, pedi autorizacion a un vendedor.`
      : "No ofrezcas descuentos. Si el cliente los pide, derivalo a un vendedor.",
  ];
}

/**
 * Arma el system prompt en 4 bloques de orden fijo:
 *
 *   1. Identidad y rol            (codigo)
 *   2. Directivas de estilo       (derivadas de la config)
 *   3. Instrucciones del negocio  (texto libre del admin)
 *   4. Reglas inviolables         (codigo, ultimas, con precedencia declarada)
 *
 * Las reglas van al final porque los modelos ponderan con mas fuerza lo que
 * aparece mas tarde en el contexto: ponerlas primero es exactamente la
 * configuracion que un texto de admin descuidado puede sobrescribir.
 *
 * Esto es mitigacion, no garantia. La defensa dura vive fuera del prompt: los
 * precios salen de `buscar_repuesto`, que consulta la DB, y el descuento se
 * verifica post-generacion.
 */
export function componerSystemPrompt(config: AgenteConfigValores): string {
  const bloques: string[] = [IDENTIDAD, ["ESTILO", ...directivasDeEstilo(config)].join("\n")];

  const instrucciones = config.instrucciones.trim();
  if (instrucciones !== "") {
    bloques.push(["INSTRUCCIONES DEL NEGOCIO", instrucciones].join("\n"));
  }

  bloques.push([ENCABEZADO_REGLAS, ...REGLAS_INVIOLABLES].join("\n"));

  return bloques.join("\n\n");
}
