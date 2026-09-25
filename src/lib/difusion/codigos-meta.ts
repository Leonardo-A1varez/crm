/**
 * Los códigos de error de la Cloud API que la política de envío conoce: qué
 * significan y si se reintentan.
 *
 * Es la tabla de `docs/prd-workflows-difusion.md` §4.4, que el PRD marca como
 * verificada contra la página de error codes de Meta y declara "la política
 * de reintento del planificador". Vive en `lib/` para que la pantalla y el
 * motor que drena la cola lean la misma tabla y no dos copias que se separan.
 *
 * Un código que no está acá vuelve `null`: se muestra el número tal cual, no
 * una descripción inventada.
 */

export interface DescripcionFallo {
  significado: string;
  reintentable: boolean;
  /** Como lo dice la tabla: "No. Nunca.", "Sí, tras el período". */
  reintento: string;
}

const TABLA: Readonly<Record<string, DescripcionFallo>> = {
  "130429": {
    significado: "Se alcanzó el throughput de la Cloud API",
    reintentable: true,
    reintento: "Sí",
  },
  "131056": {
    significado: "Demasiados mensajes al mismo destinatario",
    reintentable: true,
    reintento: "Sí, a otros destinatarios",
  },
  "131064": {
    significado: "Límite por violaciones de clasificación de plantilla",
    reintentable: true,
    reintento: "Sí, tras el período",
  },
  "131047": {
    significado: "Pasaron más de 24 h desde la última respuesta",
    reintentable: false,
    reintento: "No: hay que mandar plantilla",
  },
  "131049": {
    significado: "Cap de marketing por usuario",
    reintentable: false,
    reintento: "No dentro de la ventana",
  },
  "131050": {
    significado: "La persona se dio de baja de marketing",
    reintentable: false,
    reintento: "No. Nunca.",
  },
  "131048": {
    significado: "Calidad del emisor degradada por bloqueos previos",
    reintentable: false,
    reintento: "No: es una alerta",
  },
  // La tabla del PRD las junta en una fila; son dos estados distintos de la
  // plantilla, y la pantalla tiene que poder decir cuál.
  "132015": { significado: "Plantilla pausada", reintentable: false, reintento: "No" },
  "132016": {
    significado: "Plantilla deshabilitada permanentemente",
    reintentable: false,
    reintento: "No",
  },
  "368": {
    significado: "WABA restringida por política",
    reintentable: false,
    reintento: "No: frena todo el envío",
  },
  "131031": {
    significado: "WABA restringida por política",
    reintentable: false,
    reintento: "No: frena todo el envío",
  },
};

export function describirFallo(codigo: string): DescripcionFallo | null {
  // `hasOwn` y no `TABLA[codigo]` a secas: "constructor" o "toString" no son
  // códigos de Meta, pero sí claves del prototipo de cualquier objeto.
  return Object.hasOwn(TABLA, codigo) ? (TABLA[codigo] ?? null) : null;
}
