import { normalizarRangos } from "@/lib/agente/horario";
import { formatearEntero } from "@/lib/ui/metricas";
import { MOTIVO_SALTO } from "@/lib/workflows/motivos-salto";
import { ciudadDeZona, fechaLegibleEnZona } from "@/lib/zona-horaria";
import { DIAS_SEMANA } from "@/types/agente";
import {
  DESBLOQUEO_PRIMER_ESCALON,
  ESCALERA_DE_LIMITES,
  ESCALERA_DE_SANCIONES,
  MINIMO_DE_USO_PCT,
  VENTANA_DE_USO_DIAS,
} from "./politica-meta";
import type {
  Calidad,
  CondicionCalidad,
  DatosDeEmpresa,
  EnvioSegunMeta,
  EscalonSancion,
  EstadoCupo,
  EstadoPlantilla,
  FranjaDelDia,
  Lectura,
  NumeroWhatsApp,
  PeldanoCupo,
  PlantillaMeta,
  PosicionEnEscalera,
  SaltosDeLaSemana,
  UsuarioDelPanel,
} from "@/components/ajustes";
import type { SaltosRecientes } from "@/server/services/workflows/workflows-admin.service";
import type { MotivoSalto } from "@/types/workflows";
import type { Empresa } from "@/server/services/empresa/empresa.service";
import type {
  EntidadDeEnvio,
  EstadoDeEnvio,
  LecturaMeta,
  NumeroLeido,
  NumerosLeidos,
  PlantillaLeida,
  PlantillasLeidas,
  SaludWhatsApp,
} from "@/server/services/meta/salud-whatsapp.service";
import type { DiaSemana, Horario } from "@/types/agente";
import type { Usuario } from "@/types/entities";

/**
 * De lo que devuelven los servicios a lo que dibujan los componentes de
 * `/ajustes`. Funciones puras: todo lo que decide qué dice la pantalla está
 * acá y tiene test (`tests/unit/ajustes-vistas.test.ts`); la página sólo
 * compone.
 */

type NoOk = { estado: "error"; mensaje: string } | { estado: "no-expuesto"; motivo: string };

function motivoDe(lectura: NoOk): string {
  return lectura.estado === "error" ? lectura.mensaje : lectura.motivo;
}

function lecturaNoOk(lectura: NoOk): Exclude<Lectura<never>, { estado: "ok" }> {
  return lectura.estado === "error"
    ? { estado: "error", mensaje: lectura.mensaje }
    : { estado: "no-disponible", motivo: lectura.motivo };
}

function lecturaDe<T, U>(lectura: LecturaMeta<T>, siOk: (valor: T) => U): Lectura<U> {
  return lectura.estado === "ok"
    ? { estado: "ok", datos: siOk(lectura.valor) }
    : lecturaNoOk(lectura);
}

// ---------------------------------------------------------------------------
// Calidad
// ---------------------------------------------------------------------------

/**
 * GREEN, YELLOW, RED, NA y UNKNOWN son los valores que muestran los ejemplos de
 * la doc de números de Meta. Que GREEN sea "alta" y RED "baja" no está en esa
 * página: lo explica un artículo de ayuda que el 2026-09-13 no se pudo leer
 * (y `docs/prd-workflows-difusion.md` §4.10 deja la enumeración completa sin
 * verificar). Por eso la tabla muestra también el valor crudo al lado.
 */
function calidadDe(crudo: string | null): Calidad {
  switch (crudo) {
    case "GREEN":
      return "alta";
    case "YELLOW":
      return "media";
    case "RED":
      return "baja";
    default:
      return "sin-datos";
  }
}

function esCalidadFloja(crudo: string | null): boolean {
  return crudo === "YELLOW" || crudo === "RED";
}

function nombreDeNumero(n: NumeroLeido): string {
  return n.numero ?? `id ${n.id}`;
}

/**
 * La primera condición del ascenso: "high-quality messages across all of your
 * business phone numbers and templates". Lo definitivo va primero: un número o
 * una plantilla floja la deja en falta aunque falte leer el resto.
 */
function condicionDeCalidad(salud: SaludWhatsApp): CondicionCalidad {
  const numeros = salud.numeros.estado === "ok" ? salud.numeros.valor.numeros : [];
  const plantillas = salud.plantillas.estado === "ok" ? salud.plantillas.valor.plantillas : [];

  const pendientes = [
    ...numeros
      .filter((n) => esCalidadFloja(n.calidad))
      .map((n) => `${nombreDeNumero(n)} (${calidadDe(n.calidad)})`),
    ...plantillas
      .filter((p) => esCalidadFloja(p.calidad))
      .map((p) => `plantilla ${p.nombre} (${calidadDe(p.calidad)})`),
  ];
  if (pendientes.length > 0) return { estado: "falta", pendientes };

  if (salud.numeros.estado !== "ok") {
    return {
      estado: "sin-dato",
      motivo: `No se pudo leer la calidad de los números: ${motivoDe(salud.numeros)}`,
    };
  }
  if (salud.plantillas.estado !== "ok") {
    return {
      estado: "sin-dato",
      motivo: `No se pudo leer la calidad de las plantillas: ${motivoDe(salud.plantillas)}`,
    };
  }
  if (numeros.length === 0) {
    return { estado: "sin-dato", motivo: "Meta no devolvió ningún número de la cuenta." };
  }

  const sinCalificar = numeros.filter((n) => calidadDe(n.calidad) === "sin-datos");
  if (sinCalificar.length > 0) {
    return {
      estado: "sin-dato",
      motivo: `Meta todavía no calificó ${sinCalificar.map(nombreDeNumero).join(", ")}: sin calificación no se puede decir si la condición se cumple.`,
    };
  }
  return { estado: "cumplida" };
}

// ---------------------------------------------------------------------------
// Estado de envío (health_status)
// ---------------------------------------------------------------------------

function detalleBloqueado(descripciones: readonly (string | null)[]): string {
  const textos = descripciones.filter((d): d is string => d !== null && d.length > 0);
  return textos.length > 0 ? textos.join(" · ") : "Meta lo marca como bloqueado sin dar el motivo.";
}

function detalleLimitado(info: readonly string[]): string {
  const textos = info.filter((t) => t.length > 0);
  return textos.length > 0 ? textos.join(" · ") : "Meta lo marca como limitado sin dar el detalle.";
}

function envioDeEntidad(entidad: EntidadDeEnvio): EnvioSegunMeta {
  switch (entidad.puedeEnviar) {
    case "AVAILABLE":
      return { estado: "disponible" };
    case "LIMITED":
      return { estado: "limitado", detalle: detalleLimitado(entidad.infoAdicional) };
    case "BLOCKED":
      return {
        estado: "bloqueado",
        detalle: detalleBloqueado(entidad.errores.map((e) => e.descripcion)),
      };
    default:
      return {
        estado: "sin-dato",
        motivo: `Meta devolvió un estado de envío que esta pantalla no conoce: ${entidad.puedeEnviar ?? "vacío"}.`,
      };
  }
}

/** El agregado de `health_status`: bloqueado si algo lo está, limitado si algo lo está. */
function envioDeLaCuenta(estado: LecturaMeta<EstadoDeEnvio>): EnvioSegunMeta {
  if (estado.estado !== "ok") return { estado: "sin-dato", motivo: motivoDe(estado) };

  const { puedeEnviar, entidades } = estado.valor;
  switch (puedeEnviar) {
    case "AVAILABLE":
      return { estado: "disponible" };
    case "BLOCKED":
      return {
        estado: "bloqueado",
        detalle: detalleBloqueado(
          entidades
            .filter((e) => e.puedeEnviar === "BLOCKED")
            .flatMap((e) => e.errores.map((x) => x.descripcion)),
        ),
      };
    case "LIMITED":
      return {
        estado: "limitado",
        detalle: detalleLimitado(
          entidades.filter((e) => e.puedeEnviar === "LIMITED").flatMap((e) => e.infoAdicional),
        ),
      };
    default:
      return {
        estado: "sin-dato",
        motivo: `Meta devolvió un estado de envío que esta pantalla no conoce: ${puedeEnviar ?? "vacío"}.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Cupo
// ---------------------------------------------------------------------------

function peldano(valor: number | "ilimitado"): PeldanoCupo {
  return valor === "ilimitado"
    ? { destinatariosPorDia: null, etiqueta: "ilimitado" }
    : { destinatariosPorDia: valor, etiqueta: formatearEntero(valor) };
}

function vistaCupo(salud: SaludWhatsApp): Lectura<EstadoCupo> {
  if (salud.limite.estado !== "ok") return lecturaNoOk(salud.limite);

  const { crudo, destinatarios } = salud.limite.valor;
  const actual = destinatarios === null ? -1 : ESCALERA_DE_LIMITES.indexOf(destinatarios);
  if (actual < 0) {
    const escalera = ESCALERA_DE_LIMITES.map((v) => peldano(v).etiqueta).join(" → ");
    return {
      estado: "no-disponible",
      motivo: `Meta devolvió ${crudo}, que no está en la escalera documentada (${escalera}).`,
    };
  }

  return {
    estado: "ok",
    datos: {
      peldanos: ESCALERA_DE_LIMITES.map(peldano),
      actual,
      calidad: condicionDeCalidad(salud),
      uso: { disponible: false, motivo: salud.usoDelLimite.motivo },
      minimoPct: MINIMO_DE_USO_PCT,
      ventanaDias: VENTANA_DE_USO_DIAS,
      desbloqueo: actual === 0 ? DESBLOQUEO_PRIMER_ESCALON : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

function notaDeNumeros(v: NumerosLeidos): string | null {
  const partes: string[] = [];
  if (v.motivoParcial !== null) {
    partes.push(
      `Sólo se leyó el número por el que manda este CRM, no la lista de la cuenta: ${v.motivoParcial}`,
    );
  }
  if (v.hayMas)
    partes.push("Meta tiene más números en la cuenta que los que devolvió esta lectura.");
  return partes.length > 0 ? partes.join(" ") : null;
}

function vistaNumeros(
  salud: SaludWhatsApp,
): Lectura<{ numeros: NumeroWhatsApp[]; nota: string | null }> {
  const entidades = salud.estadoDeEnvio.estado === "ok" ? salud.estadoDeEnvio.valor.entidades : [];
  const sinSaludDelConfigurado =
    salud.estadoDeEnvio.estado === "ok"
      ? "health_status no nombró este número."
      : `No se pudo leer health_status: ${motivoDe(salud.estadoDeEnvio)}`;

  return lecturaDe(salud.numeros, (v) => ({
    numeros: v.numeros.map((n): NumeroWhatsApp => {
      const entidad = entidades.find((e) => e.tipo === "PHONE_NUMBER" && e.id === n.id);
      return {
        id: n.id,
        numero: nombreDeNumero(n),
        nombre: n.nombreVerificado,
        calidad: calidadDe(n.calidad),
        calidadCruda: n.calidad,
        envio: entidad
          ? envioDeEntidad(entidad)
          : {
              estado: "sin-dato",
              motivo: n.esElConfigurado
                ? sinSaludDelConfigurado
                : "Esta pantalla consulta health_status sólo del número por el que manda el CRM.",
            },
        esElConfigurado: n.esElConfigurado,
      };
    }),
    nota: notaDeNumeros(v),
  }));
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

const ESTADO_DE_PLANTILLA: Readonly<Record<string, EstadoPlantilla>> = {
  APPROVED: "aprobada",
  PENDING: "en-revision",
  IN_APPEAL: "en-revision",
  REJECTED: "rechazada",
  PAUSED: "pausada",
  DISABLED: "deshabilitada",
};

/** Traducción literal del enum `rejected_reason`; el valor crudo va siempre al lado. */
const MOTIVO_DE_RECHAZO: Readonly<Record<string, string>> = {
  ABUSIVE_CONTENT: "contenido abusivo",
  INVALID_FORMAT: "formato inválido",
  PROMOTIONAL: "contenido promocional",
  SCAM: "posible estafa",
  TAG_CONTENT_MISMATCH: "etiqueta y contenido no coinciden",
  INCORRECT_CATEGORY: "categoría incorrecta",
};

function notaDeRechazo(motivo: string | null): string {
  if (motivo === null || motivo === "NONE") return "Rechazada. Meta no informó el motivo.";
  const traducido = MOTIVO_DE_RECHAZO[motivo];
  return traducido
    ? `Rechazada por ${traducido} (${motivo}).`
    : `Rechazada. Motivo que informa Meta: ${motivo}.`;
}

function notaDePlantilla(p: PlantillaLeida): string {
  switch (p.estado) {
    case "APPROVED":
      return p.calidad === null ? "Aprobada." : `Aprobada. Calidad que informa Meta: ${p.calidad}.`;
    case "PENDING":
      return "Enviada a revisión; Meta todavía no respondió.";
    case "IN_APPEAL":
      return "En apelación: Meta está revisando el reclamo.";
    case "REJECTED":
      return notaDeRechazo(p.motivoRechazo);
    case "PAUSED":
      // La doc de template pausing: por calidad, 3 h la primera vez y 6 h la
      // segunda, y vuelve sola; por pacing hay que despausarla a mano. Ningún
      // campo de lectura dice cuál de las dos es (verificado 2026-09-13).
      return "Pausada. La API no dice si es por calidad —vuelve sola a las 3 h o a las 6 h— o por pacing, que hay que levantar a mano desde el administrador de WhatsApp.";
    case "DISABLED":
      return "Deshabilitada por Meta.";
    default:
      return `Meta la informa como ${p.estado ?? "sin estado"}.`;
  }
}

function categoriaLegible(categoria: string | null): string {
  if (categoria === null || categoria.length === 0) return "—";
  return `${categoria.charAt(0)}${categoria.slice(1).toLowerCase()}`;
}

function vistaPlantillas(
  salud: SaludWhatsApp,
): Lectura<{ plantillas: PlantillaMeta[]; nota: string | null }> {
  return lecturaDe(salud.plantillas, (v: PlantillasLeidas) => ({
    plantillas: v.plantillas.map(
      (p): PlantillaMeta => ({
        id: p.id,
        nombre: p.nombre,
        idioma: p.idioma,
        categoria: categoriaLegible(p.categoria),
        estado: (p.estado === null ? undefined : ESTADO_DE_PLANTILLA[p.estado]) ?? "otro",
        nota: notaDePlantilla(p),
        // Ninguna lectura de Meta distingue la pausa por pacing de la pausa por
        // calidad, ni cuenta en qué escalón está: afirmar cualquiera de las dos
        // cosas sería inventarla.
        requiereDespausadoManual: false,
        escalonPausado: null,
      }),
    ),
    nota: v.hayMas
      ? `Meta tiene más plantillas: se muestran las primeras ${formatearEntero(v.limite)}.`
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Salud: todo junto
// ---------------------------------------------------------------------------

export interface VistaSalud {
  cupo: Lectura<EstadoCupo>;
  escalones: readonly EscalonSancion[];
  posicion: PosicionEnEscalera;
  envio: EnvioSegunMeta;
  numeros: Lectura<{ numeros: NumeroWhatsApp[]; nota: string | null }>;
  plantillas: Lectura<{ plantillas: PlantillaMeta[]; nota: string | null }>;
  /** De qué versión de la API y cuándo, en la hora del negocio. */
  fuente: string;
  /** El número del badge de la pestaña. */
  pendientes: number;
}

/**
 * Cuántas cosas del panel piden una mano. Cuenta sólo lo que alguien puede
 * resolver: plantillas pausadas, números en calidad media o baja, y un envío
 * que Meta marca como limitado o bloqueado. No cuenta rechazadas ni
 * deshabilitadas (ya pasaron) ni números sin calificar (no hay qué hacer):
 * un contador que no se puede bajar deja de mirarse.
 */
function contarPendientes(salud: SaludWhatsApp, envio: EnvioSegunMeta): number {
  const pausadas =
    salud.plantillas.estado === "ok"
      ? salud.plantillas.valor.plantillas.filter((p) => p.estado === "PAUSED").length
      : 0;
  const numerosFlojos =
    salud.numeros.estado === "ok"
      ? salud.numeros.valor.numeros.filter((n) => esCalidadFloja(n.calidad)).length
      : 0;
  const envioFrenado = envio.estado === "limitado" || envio.estado === "bloqueado" ? 1 : 0;
  return pausadas + numerosFlojos + envioFrenado;
}

export function vistaSalud(salud: SaludWhatsApp, zonaHoraria: string): VistaSalud {
  const envio = envioDeLaCuenta(salud.estadoDeEnvio);
  return {
    cupo: vistaCupo(salud),
    escalones: ESCALERA_DE_SANCIONES,
    posicion: { tipo: "no-disponible", motivo: salud.sancion.motivo },
    envio,
    numeros: vistaNumeros(salud),
    plantillas: vistaPlantillas(salud),
    fuente: `Leído de la Graph API de Meta (${salud.versionApi}) el ${fechaLegibleEnZona(zonaHoraria, salud.consultadoAt)}, hora de ${ciudadDeZona(zonaHoraria)}.`,
    pendientes: contarPendientes(salud, envio),
  };
}

// ---------------------------------------------------------------------------
// Empresa, usuarios, horario
// ---------------------------------------------------------------------------

/**
 * La zona horaria no vive en `empresas`: es `agente_config.horario_timezone`,
 * la única del sistema (`lib/zona-horaria.ts`). Llega aparte por eso.
 */
export function vistaEmpresa(empresa: Empresa | null, zonaHoraria: string | null): DatosDeEmpresa {
  return {
    registro:
      empresa === null ? null : { nombre: empresa.nombre, identificacionFiscal: empresa.ruc_nit },
    zonaHoraria,
  };
}

/**
 * Activos primero, admins antes que vendedores, y por nombre. El repositorio
 * no ordena y un orden que cambia entre recargas hace buscar dos veces.
 *
 * El último acceso es `auth.users.last_sign_in_at`, que no está en la tabla
 * `usuarios` ni en su repositorio: queda `sin-dato`, no "nunca entró".
 */
export function vistaUsuarios(usuarios: readonly Usuario[]): UsuarioDelPanel[] {
  return [...usuarios]
    .sort(
      (a, b) =>
        Number(b.activo) - Number(a.activo) ||
        Number(b.rol === "admin") - Number(a.rol === "admin") ||
        a.nombre.localeCompare(b.nombre, "es"),
    )
    .map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      ultimoAcceso: { estado: "sin-dato" },
    }));
}

const DIA: Readonly<Record<DiaSemana, { dia: string; abreviatura: string }>> = {
  lun: { dia: "Lunes", abreviatura: "LU" },
  mar: { dia: "Martes", abreviatura: "MA" },
  mie: { dia: "Miércoles", abreviatura: "MI" },
  jue: { dia: "Jueves", abreviatura: "JU" },
  vie: { dia: "Viernes", abreviatura: "VI" },
  sab: { dia: "Sábado", abreviatura: "SA" },
  dom: { dia: "Domingo", abreviatura: "DO" },
};

/**
 * Pasa por `normalizarRangos`, la misma función que aplica el editor de
 * `/agente` al guardar: un rango inválido que `estaAbierto` nunca usa no se
 * muestra como si estuviera vigente.
 */
export function vistaHorario(horario: Horario): FranjaDelDia[] {
  return DIAS_SEMANA.map((d) => ({
    ...DIA[d],
    rangos: normalizarRangos(horario[d] ?? []).map((r) => ({ desde: r.desde, hasta: r.hasta })),
  }));
}

/**
 * Qué pasa fuera de horario, según `on-message-received.ts`: no corre ningún
 * LLM; con `plantilla_fuera_horario` no vacía se manda ese texto y, vacía, no
 * se contesta nada. La comparación es la misma que la del pipeline (`!== ""`,
 * sin recortar espacios) para que la pantalla no pueda discrepar de él.
 */
export function textoFueraDeHorario(plantilla: string): string {
  return plantilla === ""
    ? "No corre el agente y no se contesta nada: el mensaje queda en la Bandeja para que lo tome una persona."
    : `No corre el agente: se contesta con la respuesta fija «${plantilla}».`;
}

/**
 * Los topes que hoy pueden saltar un mensaje de un flujo, en el orden del PRD
 * §6.6. `conversacion_activa` no está: el PRD la nombra pero no define qué es
 * una conversación activa para un flujo, y ninguna acción la aplica. Listarla
 * con un 0 fijo diría que se chequea y que nunca pasó.
 */
const MOTIVOS_EN_AJUSTES: readonly MotivoSalto[] = [
  "tope_frecuencia",
  "dado_de_baja",
  "sin_ventana",
  "requiere_humano",
];

export function vistaSaltos(saltos: SaltosRecientes): SaltosDeLaSemana {
  const filas = MOTIVOS_EN_AJUSTES.map((motivo) => ({
    motivo,
    label: MOTIVO_SALTO[motivo].label,
    explicacion: MOTIVO_SALTO[motivo].explicacion,
    cantidad: saltos.porMotivo[motivo],
  }));
  return { filas, total: filas.reduce((n, f) => n + f.cantidad, 0) };
}
