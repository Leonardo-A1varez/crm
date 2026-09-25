import { vistaSalud, type VistaSalud } from "@/app/(panel)/ajustes/_lib/vistas";
import { describirFallo } from "@/lib/difusion/codigos-meta";
import { fechaLegibleEnZona } from "@/lib/zona-horaria";
import { topeDesdeLimite } from "@/server/services/difusion/tope";
import type {
  CategoriaPlantilla,
  Dato,
  Difusion,
  EnvioDifusion,
  FalloPorMotivo,
  Plantilla,
  PlantillaPausada,
  SaludNumero,
} from "@/components/difusion";
import type { DetalleDifusion, DifusionResumen } from "@/server/services/difusion/difusion.service";
import type { SaludWhatsApp } from "@/server/services/meta/salud-whatsapp.service";

/**
 * De lo que devuelven los servicios a lo que dibujan los componentes de
 * `/difusion`. Funciones puras, con test (`tests/unit/difusion/pantalla-vistas.test.ts`):
 * la página sólo compone.
 *
 * Nada acá calcula una cifra del envío —cuántos, a quién, en qué tanda—: eso
 * llega hecho del servicio y del planificador. Lo que se hace es escribir
 * fechas en la hora del negocio, traducir lo que manda Meta y decir qué dato
 * no existe todavía.
 */

function fecha(tz: string, iso: string): string {
  return fechaLegibleEnZona(tz, new Date(iso));
}

function motivoDe(
  lectura: { estado: "error"; mensaje: string } | { estado: "no-disponible"; motivo: string },
): string {
  return lectura.estado === "error" ? lectura.mensaje : lectura.motivo;
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

export function filasDelListado(difusiones: readonly DifusionResumen[], tz: string): Difusion[] {
  return difusiones.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    plantilla: d.plantilla,
    estado: d.estado,
    destinatarios: d.destinatarios,
    entregados: d.entregados,
    leidos: d.leidos,
    // Nada registra todavía qué respuesta vino de qué difusión ni lo que cobró
    // Meta por ella: la columna existe y dice que no hay dato.
    respondieron: null,
    costoUsd: null,
    cuando:
      d.estado === "borrador" || d.programadaPara === null
        ? `creada ${fecha(tz, d.creadaAt)}`
        : fecha(tz, d.programadaPara),
  }));
}

// ---------------------------------------------------------------------------
// Salud del número
// ---------------------------------------------------------------------------

function calidadDelConfigurado(numeros: VistaSalud["numeros"]): SaludNumero["calidad"] {
  if (numeros.estado !== "ok") {
    return { estado: "sin-dato", motivo: `No se pudo leer el número: ${motivoDe(numeros)}` };
  }
  const configurado = numeros.datos.numeros.find((n) => n.esElConfigurado);
  if (!configurado) {
    return {
      estado: "sin-dato",
      motivo: "Meta no devolvió el número por el que manda este CRM.",
    };
  }
  return {
    estado: "ok",
    valor: { calidad: configurado.calidad, cruda: configurado.calidadCruda },
  };
}

function pausadasDe(plantillas: VistaSalud["plantillas"]): Dato<PlantillaPausada[]> {
  if (plantillas.estado !== "ok") {
    return {
      estado: "sin-dato",
      motivo: `No se pudo leer la lista de plantillas: ${motivoDe(plantillas)}`,
    };
  }
  // Una plantilla existe en varios idiomas con el mismo nombre: la pausa se
  // informa una vez por nombre, que es lo que guarda la difusión.
  const nombres = new Set(
    plantillas.datos.plantillas.filter((p) => p.estado === "pausada").map((p) => p.nombre),
  );
  return {
    estado: "ok",
    valor: [...nombres].map((nombre) => ({ nombre, laUsaEstaDifusion: false })),
  };
}

/**
 * La calidad, el escalón, el estado de envío y las plantillas pausadas del
 * número por el que manda el CRM. Reusa la traducción de Ajustes
 * (`vistaSalud`): es la misma lectura de Meta vista desde otra pantalla, y dos
 * traducciones del mismo `GREEN` terminan diciendo cosas distintas.
 */
export function saludDelNumero(salud: SaludWhatsApp, tz: string): SaludNumero {
  const vista = vistaSalud(salud, tz);
  const tope = topeDesdeLimite(salud.limite);
  return {
    calidad: calidadDelConfigurado(vista.numeros),
    escalon:
      tope.estado === "ok"
        ? { estado: "ok", valor: tope.tope }
        : { estado: "sin-dato", motivo: tope.motivo },
    envio: vista.envio,
    plantillasPausadas: pausadasDe(vista.plantillas),
    fuente: vista.fuente,
  };
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

/** Las dos categorías con que puede salir una difusión. Las demás no se ofrecen. */
function categoriaDe(crudo: string | null): CategoriaPlantilla | null {
  switch (crudo) {
    case "MARKETING":
      return "marketing";
    case "UTILITY":
      return "utility";
    default:
      return null;
  }
}

/**
 * Las plantillas de la cuenta que sirven para una difusión.
 *
 * Sólo marketing y utility: authentication es para códigos de un solo uso, y
 * una categoría que no se conoce no se ofrece a ciegas. Las que se dejan
 * afuera se cuentan para que la pantalla lo diga.
 *
 * El texto sale de los `components` que devuelve Meta: encabezado (sólo si es
 * de texto), cuerpo con sus `{{n}}`, pie y los botones de respuesta rápida.
 * Lo que Meta no manda queda en `null`: no se inventa un texto. El estado y la
 * nota salen de la misma traducción que la tabla de Ajustes.
 */
export function plantillasParaDifusion(
  salud: SaludWhatsApp,
): Dato<{ plantillas: Plantilla[]; ocultas: number; nota: string | null }> {
  if (salud.plantillas.estado !== "ok") {
    const lectura = salud.plantillas;
    return {
      estado: "sin-dato",
      motivo: `No se pudo leer la lista de plantillas de Meta: ${lectura.estado === "error" ? lectura.mensaje : lectura.motivo}`,
    };
  }

  // La zona sólo cambia la línea de "fuente", que acá no se usa.
  const vista = vistaSalud(salud, "UTC").plantillas;
  const traducidas = new Map(
    vista.estado === "ok" ? vista.datos.plantillas.map((p) => [p.id, p]) : [],
  );

  let ocultas = 0;
  const plantillas: Plantilla[] = [];
  for (const p of salud.plantillas.valor.plantillas) {
    const categoria = categoriaDe(p.categoria);
    if (categoria === null) {
      ocultas += 1;
      continue;
    }
    const traducida = traducidas.get(p.id);
    plantillas.push({
      id: p.id,
      nombre: p.nombre,
      idioma: p.idioma,
      categoria,
      estado: traducida?.estado ?? "otro",
      nota: traducida?.nota ?? null,
      requiereDespausadoManual: false,
      escalonPausado: null,
      encabezado: p.encabezado,
      cuerpo: p.cuerpo,
      pie: p.pie,
      // Las respuestas rápidas se leen (`respuestasRapidas`) pero no se ofrecen
      // todavía: la acción de cada botón no se guarda ni la ejecuta nadie, y
      // mostrar el selector prometería algo que no pasa.
      botones: [],
    });
  }
  plantillas.sort(
    (a, b) =>
      a.nombre.localeCompare(b.nombre, "es") ||
      (a.idioma ?? "").localeCompare(b.idioma ?? "", "es"),
  );

  return {
    estado: "ok",
    valor: { plantillas, ocultas, nota: vista.estado === "ok" ? vista.datos.nota : null },
  };
}

// ---------------------------------------------------------------------------
// Envío de una difusión programada
// ---------------------------------------------------------------------------

function fallo(f: DetalleDifusion["fallos"][number]): FalloPorMotivo {
  const descripcion = describirFallo(f.codigo);
  return {
    codigo: f.codigo,
    cantidad: f.cantidad,
    significado: descripcion?.significado ?? null,
    reintento: descripcion?.reintento ?? null,
    reintentable: descripcion?.reintentable ?? null,
  };
}

export function vistaEnvio(detalle: DetalleDifusion, tz: string): EnvioDifusion {
  const { difusion: d, conteo } = detalle;
  const e = conteo.porEstado;
  return {
    id: d.id,
    nombre: d.nombre,
    estado: d.estado,
    plantilla: d.plantillaNombre,
    conteo: {
      en_cola: e.en_cola,
      aceptado: e.aceptado,
      entregado: e.entregado,
      leido: e.leido,
      fallido: e.fallido,
      cancelado: e.cancelado,
    },
    total: conteo.total - e.excluido,
    excluidos: e.excluido,
    tandas: detalle.tandas.map((t) => ({
      tanda: t.tanda,
      desde: fecha(tz, t.desde),
      total: t.total,
      enCola: t.enCola,
      porPlantilla: t.porPlantilla,
    })),
    fallos: detalle.fallos.map(fallo),
    canaryTamano: d.canaryTamano,
    programadaPara: d.programadaPara === null ? null : fecha(tz, d.programadaPara),
    finalizadaAt: d.finalizadaAt === null ? null : fecha(tz, d.finalizadaAt),
    motivoDetencion: d.motivoDetencion,
    motivoRevision: d.motivoRevision,
    detenidaPorPersona: d.detenidaPorPersona,
  };
}
