import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { NotFoundError } from "@/lib/errors";
import { elegirVendedorRoundRobin } from "@/lib/round-robin";
import type { AccionWorkflow } from "@/lib/workflows/catalogo";
import { disparadorDe, nodoPorId } from "@/lib/workflows/recorrer";
import { NoopSessionLock } from "@/server/lock/session-lock";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { LeadSessionUpdate } from "@/server/repositories/lead-session.repo";
import type { PauseHandoffInput } from "@/server/services/handoff.service";
import { contenidoDePlantilla, type SendOutboundInput } from "@/server/services/meta-api.service";
import type { Lead, LeadSession, LeadTag, Mensaje, UUID } from "@/types/entities";
import type { ContextoRun, Grafo, MotivoFallo, MotivoSalto } from "@/types/workflows";
import {
  accionDeNodo,
  crearRegistroDeAcciones,
  type PuertosAcciones,
  type RegistroDeAcciones,
} from "./acciones/registro";
import { ejecutarSegmento, type CamposVivosDeps, type PasoEjecutado } from "./ejecutor.service";

/**
 * Modo prueba del motor: el MISMO `ejecutarSegmento` y el MISMO registro que
 * producción (`crearRegistroDeAcciones`), con los efectos interceptados y un
 * reloj virtual que saltea las esperas. Lo usan "Probar" (con un lead real) y
 * el simulador (sin lead).
 *
 * Reemplaza al simulador anterior, que armaba su propio registro y aceptaba
 * cualquier acción: probaba contra un catálogo que producción no tenía.
 */

/** Ids de lo que la prueba simula. No son uuids a propósito: nunca se persisten. */
export const LEAD_SIMULADO_ID = "lead-simulado";
export const SESION_SIMULADA_ID = "sesion-simulada";
export const CONVERSACION_SIMULADA_ID = "conversacion-simulada";

/** Algo que la acción habría hecho y la prueba no hizo. */
export interface EfectoSimulado {
  accion: AccionWorkflow;
  /** Qué se habría hecho: el texto que se habría mandado, la etiqueta, la etapa. */
  detalle: Record<string, unknown>;
  /** Hora del reloj virtual, en ISO: viaja a `workflow_run_pasos.salida` (jsonb). */
  en: string;
}

export interface SandboxDePrueba {
  puertos: PuertosAcciones;
  /** Devuelve y vacía los efectos interceptados desde la última llamada. */
  tomarEfectos(): EfectoSimulado[];
  /** Cuántos mensajes se habrían mandado en toda la prueba. */
  salientes(): number;
}

export interface EntradaSandbox {
  lead: Lead;
  sesion: LeadSession;
  reloj: () => Date;
  /** Cuándo llegó el disparo. Abre la ventana de 24 h de Meta. */
  inicio: Date;
  /**
   * La lista de bajas real, sólo lectura. Sin ella la prueba asume que el lead
   * no se dio de baja: lo dice `crearSandboxDePrueba`.
   */
  supresiones?: Pick<DifusionSupresionesRepository, "activasPorTelefonos">;
}

/**
 * Los puertos de las acciones, cerrados para una prueba.
 *
 * **Efectos — interceptados:** mandar el WhatsApp, colgar la etiqueta, mover la
 * etapa y escalar no tocan Meta ni la base. Quedan anotados y se devuelven con
 * el paso que los produjo.
 *
 * **Lecturas — lo que la prueba sabe, y lo que asume:**
 * - el lead y su sesión son los que se le pasan (en "Probar", los reales);
 * - las bajas son las de `supresiones` si se pasa (en "Probar", la lista
 *   real); sin ella, se asume que el lead no se dio de baja;
 * - la config del agente es la de fábrica: horario abierto siempre y tope de
 *   3 salientes en 24 h (`CONFIG_DE_FABRICA`);
 * - el tope cuenta sólo los mensajes de esta prueba, no el historial del lead;
 * - la conversación es del canal del lead y el disparo abre su ventana de 24 h;
 *   se asume que el lead no vuelve a escribir durante la prueba, así que un
 *   texto libre más de 24 h después falla igual que en producción;
 * - el round robin no ve el historial ni quién está activo: asume a todos los
 *   candidatos disponibles y sin sesiones, así que elige al primero de la
 *   lista (en producción, al que hace más tiempo que no recibe);
 * - asignar un vendedor no avisa a nadie: una prueba no arranca otros flujos.
 */
export function crearSandboxDePrueba(entrada: EntradaSandbox): SandboxDePrueba {
  const efectos: EfectoSimulado[] = [];
  const enviados: Date[] = [];
  let sesion: LeadSession = { ...entrada.sesion };

  const anotar = (accion: AccionWorkflow, detalle: Record<string, unknown>): void => {
    efectos.push({ accion, detalle, en: entrada.reloj().toISOString() });
  };

  const puertos: PuertosAcciones = {
    leads: {
      findById: async (id) => (id === entrada.lead.id ? { ...entrada.lead } : null),
    },
    users: { findById: async () => null },
    configProvider: { activa: async () => CONFIG_DE_FABRICA },
    messages: {
      contarSalientesAutomaticos: async (_leadId, desde) =>
        enviados.filter((t) => t.getTime() >= desde.getTime()).length,
    },
    conversations: {
      findActivaByLead: async (leadId) =>
        leadId === entrada.lead.id
          ? {
              id: CONVERSACION_SIMULADA_ID,
              canal: entrada.lead.canal_origen,
              ultimo_entrante_at: entrada.inicio,
            }
          : null,
    },
    sessions: {
      findById: async (id) => (id === sesion.id ? { ...sesion } : null),
      // La sesión de la prueba es la activa del lead: si un paso anterior la
      // escaló, el tope "requiere humano" de `enviar_mensaje` la ve escalada,
      // igual que en producción.
      findActiveByLeadId: async (leadId) => (leadId === entrada.lead.id ? { ...sesion } : null),
      aplicarExtraccion: async (id: UUID, patch: LeadSessionUpdate) => {
        if (id !== sesion.id) {
          throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
        }
        sesion = { ...sesion, ...patch };
        // Por esta puerta escriben «Cambiar etapa» (la etapa) y «Actualizar
        // campo del Twin» (un campo editable): el patch dice cuál fue. Del
        // campo se anota sólo el nombre, como en la salida del paso.
        if (patch.current_stage !== undefined) {
          anotar("cambiar_etapa", { current_stage: patch.current_stage });
        } else {
          for (const campo of Object.keys(patch)) anotar("actualizar_campo_twin", { campo });
        }
        return { ...sesion };
      },
    },
    tags: {
      assignToLead: async (leadId, tagId, source, assignedBy): Promise<LeadTag> => {
        anotar("poner_etiqueta", { tag_id: tagId });
        return {
          lead_id: leadId,
          tag_id: tagId,
          source,
          assigned_by: assignedBy ?? null,
          assigned_at: entrada.reloj(),
          quitada_at: null,
          quitada_por: null,
        };
      },
    },
    handoff: {
      pause: async (pedido: PauseHandoffInput | UUID) => {
        anotar("escalar_a_humano", {
          motivo: typeof pedido === "string" ? "manual_pause" : pedido.reasonCode,
        });
        sesion = { ...sesion, ia_pausada: true, current_stage: "requiere_humano" };
        return { ...sesion };
      },
    },
    supresiones: entrada.supresiones ?? { activasPorTelefonos: async () => [] },
    asignacion: {
      asignar: async (sessionId, vendedorId) => {
        if (sessionId !== sesion.id) {
          throw new NotFoundError(
            `lead_session no encontrada: ${sessionId}`,
            "lead_session",
            sessionId,
          );
        }
        const cambio = (sesion.vendedor_asignado_id ?? null) !== vendedorId;
        if (cambio) {
          sesion = { ...sesion, vendedor_asignado_id: vendedorId, asignado_at: entrada.reloj() };
          anotar("asignar_vendedor", { vendedor_id: vendedorId });
        }
        return { session: { ...sesion }, cambio };
      },
      asignarPorRoundRobin: async (sessionId, config) => {
        if (sessionId !== sesion.id) {
          throw new NotFoundError(
            `lead_session no encontrada: ${sessionId}`,
            "lead_session",
            sessionId,
          );
        }
        const actual = sesion.vendedor_asignado_id ?? null;
        if (actual !== null)
          return { tipo: "ya_asignada", session: { ...sesion }, vendedorId: actual };
        const eleccion = elegirVendedorRoundRobin(
          config.candidatos.map((id) => ({ id, disponible: true })),
          [],
          { tope: config.tope },
        );
        if (eleccion.tipo === "sin_vendedor") {
          return { tipo: "sin_vendedor", session: { ...sesion }, motivo: eleccion.motivo };
        }
        sesion = {
          ...sesion,
          vendedor_asignado_id: eleccion.vendedorId,
          asignado_at: entrada.reloj(),
        };
        anotar("repartir_round_robin", { vendedor_id: eleccion.vendedorId });
        return { tipo: "asignada", session: { ...sesion }, vendedorId: eleccion.vendedorId };
      },
    },
    avisos: { vendedorAsignado: async () => {} },
    // La prueba no firma nada en Storage: la imagen no sale.
    imagenesDeFlujo: { urlFirmada: async (ruta) => `simulado://mensajes_media/${ruta}` },
    candadoReparto: new NoopSessionLock(),
    // La plantilla a un lead sin sesión: mismo efecto anotado que con sesión.
    // `enviados` ya cuenta todo lo de la prueba, así que acá no suma aparte.
    plantillasSinSesion: {
      contarNoAnotadasDesde: async () => 0,
      enviar: async (pedido) => {
        enviados.push(entrada.reloj());
        anotar("enviar_plantilla", {
          plantilla: pedido.plantilla.nombre,
          idioma: pedido.plantilla.idioma,
          parametros: [...pedido.plantilla.parametrosCuerpo],
          sin_sesion: true,
        });
        return { id: `simulado:${pedido.idempotencyKey}`, meta_message_id: null };
      },
    },
    metaApi: {
      sendOutbound: async (pedido) => {
        const ahora = entrada.reloj();
        enviados.push(ahora);
        anotar("enviar_mensaje", { texto: pedido.contenido, canal: pedido.canal });
        return mensajeSimulado(pedido, ahora);
      },
      // Botones, lista, imagen y ubicación: el efecto anotado con lo que
      // saldría. Sin wamid: en la prueba nadie responde, y la espera de un
      // nodo con opciones vence y sale por «sin respuesta».
      sendRico: async (pedido) => {
        const ahora = entrada.reloj();
        enviados.push(ahora);
        const { contenido } = pedido;
        const accion: AccionWorkflow =
          contenido.tipo === "botones"
            ? "enviar_botones"
            : contenido.tipo === "lista"
              ? "enviar_lista"
              : contenido.tipo === "imagen"
                ? "enviar_imagen"
                : "enviar_ubicacion";
        anotar(accion, {
          ...(contenido.tipo === "imagen"
            ? { imagen: pedido.archivo ?? contenido.url, caption: contenido.caption }
            : contenido),
        });
        return mensajeSimulado(
          {
            conversacionId: pedido.conversacionId,
            leadSessionId: pedido.leadSessionId,
            canal: "wa",
            to: pedido.to,
            contenido: "",
            sender: pedido.sender,
            senderUserId: pedido.senderUserId,
            idempotencyKey: pedido.idempotencyKey,
          },
          ahora,
        );
      },
      sendTemplate: async (pedido) => {
        const ahora = entrada.reloj();
        enviados.push(ahora);
        anotar("enviar_plantilla", {
          plantilla: pedido.plantilla.nombre,
          idioma: pedido.plantilla.idioma,
          parametros: [...pedido.plantilla.parametrosCuerpo],
        });
        return mensajeSimulado(
          {
            conversacionId: pedido.conversacionId,
            leadSessionId: pedido.leadSessionId,
            canal: "wa",
            to: pedido.to,
            contenido: contenidoDePlantilla(pedido.plantilla),
            sender: pedido.sender,
            senderUserId: pedido.senderUserId,
            idempotencyKey: pedido.idempotencyKey,
          },
          ahora,
        );
      },
    },
  };

  return {
    puertos,
    tomarEfectos: () => efectos.splice(0),
    salientes: () => enviados.length,
  };
}

function mensajeSimulado(pedido: SendOutboundInput, ahora: Date): Mensaje {
  return {
    id: `simulado:${pedido.idempotencyKey ?? ahora.toISOString()}`,
    conversacion_id: pedido.conversacionId,
    lead_session_id: pedido.leadSessionId,
    direction: "out",
    sender: pedido.sender,
    sender_user_id: pedido.senderUserId ?? null,
    tipo: "text",
    contenido: pedido.contenido,
    media_url: null,
    meta_message_id: null,
    idempotency_key: pedido.idempotencyKey ?? null,
    metadata: {},
    created_at: ahora,
    platform_created_at: null,
    estado_entrega: null,
    estado_entrega_at: null,
    error_entrega: null,
  };
}

/**
 * La sesión que abriría el pipeline para un lead que escribe sin conversación
 * abierta: etapa `nuevo`, sin nada cotizado. Es la misma que arma
 * `resolveActiveSession` en `on-message-received.ts`.
 */
export function sesionSimulada(leadId: UUID, ahora: Date): LeadSession {
  return {
    id: SESION_SIMULADA_ID,
    lead_id: leadId,
    current_stage: "nuevo",
    etapa_alcanzada: "nuevo",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
    stage_before_handoff: null,
    extras: {},
    context_summary: null,
    procedencia: {},
    started_at: ahora,
    updated_at: ahora,
    closed_at: null,
  };
}

/** El simulador corre antes de que exista un lead: uno vacío, sin nombre inventado. */
function leadSimulado(ahora: Date): Lead {
  return {
    id: LEAD_SIMULADO_ID,
    nombre: "",
    nombre_perfil: null,
    telefono: "",
    email: null,
    direccion: null,
    datos_extra: {},
    vehiculo_marca: null,
    vehiculo_modelo: null,
    vehiculo_anio: null,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: {},
    created_at: ahora,
    updated_at: ahora,
  };
}

export interface PasoDePrueba extends PasoEjecutado {
  /** Hora del reloj virtual cuando corrió el paso. */
  reloj: Date;
  /** Lo que el paso habría hecho afuera y no hizo. */
  efectos: EfectoSimulado[];
}

/**
 * `saltado`: un tope de seguridad saltó un mensaje y el lead salió del flujo
 * (PRD §6.6). Terminó, no falló: por eso no es `fallado`.
 */
export type DesenlacePrueba =
  | "fin"
  | "saltado"
  | "fallado"
  | "tope"
  | "sin_disparador"
  /** Frenó antes de `detenerEn` ("Ejecutar hasta acá"). `nodoId` es ese nodo. */
  | "detenido"
  /** La corrida dejó de estar viva a mitad de la prueba (la cancelaron). */
  | "cancelada";

export interface ResultadoPrueba {
  pasos: PasoDePrueba[];
  /**
   * `sin_disparador`: el grafo no tiene nodo disparador -- el estado más común
   * de un borrador a medio armar. Sin este miembro, un borrador sin disparador
   * y un flujo sano que terminó bien serían indistinguibles.
   */
  desenlace: DesenlacePrueba;
  error?: string;
  /** El nodo donde falló, o antes del que frenó. */
  nodoId?: string;
  motivo?: MotivoFallo;
  /** Sólo en `saltado`: qué nodo saltó el tope y por qué. */
  salto?: { nodoId: string; motivo: MotivoSalto; detalle: string };
  /** Cuántos mensajes le habría mandado al lead. El número que importa. */
  salientes: number;
}

export interface EntradaPrueba {
  grafo: Grafo;
  maxPasos: number;
  desde: Date;
  contexto: ContextoRun;
  lead: Lead;
  sesion: LeadSession;
  runId: UUID;
  /** "Ejecutar hasta acá": frena al llegar a este nodo, sin correrlo. */
  detenerEn?: string;
  /** Los campos vivos de las condiciones, leídos de la base real (sólo lectura). */
  camposVivos?: CamposVivosDeps;
  /** ¿La corrida de prueba sigue viva? Ver `EjecutorDeps.seguir`. */
  seguir?: () => Promise<boolean>;
  /**
   * Sólo tests del motor: reemplaza el registro de producción por uno con
   * acciones falsas. Todo caller de `src/` corre con el de producción.
   */
  registro?: RegistroDeAcciones;
  /** Cada paso, a medida que corre. "Probar" lo usa para persistirlo. */
  onPaso?: (paso: PasoDePrueba) => Promise<void>;
  /** La lista de bajas real. Ver `EntradaSandbox.supresiones`. */
  supresiones?: Pick<DifusionSupresionesRepository, "activasPorTelefonos">;
}

/**
 * Corre el grafo entero en la sandbox: siempre termina, en `fin`, `fallado`
 * o `max_pasos`. Cada espera adelanta el reloj virtual en vez de dormir, y el
 * segmento siguiente arranca con el contexto que dejó el anterior — lo mismo
 * que persiste `runs.esperar()` en producción.
 */
export async function correrPrueba(entrada: EntradaPrueba): Promise<ResultadoPrueba> {
  let reloj = new Date(entrada.desde);
  const sandbox = crearSandboxDePrueba({
    lead: entrada.lead,
    sesion: entrada.sesion,
    reloj: () => reloj,
    inicio: entrada.desde,
    supresiones: entrada.supresiones,
  });
  const registro = entrada.registro ?? crearRegistroDeAcciones(sandbox.puertos);
  const pasos: PasoDePrueba[] = [];

  const disparador = disparadorDe(entrada.grafo);
  if (!disparador) {
    return {
      pasos,
      desenlace: "sin_disparador",
      error: "el grafo no tiene nodo disparador",
      salientes: 0,
    };
  }

  let nodoActual: string = disparador.id;
  let pasosPrevios = 0;
  let contexto: ContextoRun = entrada.contexto;

  const onPaso = async (paso: PasoEjecutado): Promise<void> => {
    const conReloj: PasoDePrueba = {
      ...paso,
      reloj: new Date(reloj),
      efectos: sandbox.tomarEfectos(),
    };
    pasos.push(conReloj);
    pasosPrevios = paso.orden;
    await entrada.onPaso?.(conReloj);
  };

  // Cada vuelta es un segmento: el arranque, o reanudar tras una espera. El
  // reloj no duerme, salta. Termina siempre: cada segmento consume al menos
  // un paso y `ejecutarSegmento` corta en `maxPasos`.
  for (;;) {
    const resultado = await ejecutarSegmento(
      {
        grafo: entrada.grafo,
        desdeNodo: nodoActual,
        contexto,
        leadId: entrada.lead.id,
        leadSessionId: entrada.sesion.id,
        runId: entrada.runId,
        pasosPrevios,
        maxPasos: entrada.maxPasos,
        detenerEn: entrada.detenerEn,
      },
      {
        registro,
        ahora: () => reloj,
        onPaso,
        camposVivos: entrada.camposVivos,
        seguir: entrada.seguir,
      },
    );

    if (resultado.tipo === "detenido") {
      return {
        pasos,
        desenlace: resultado.causa === "hasta_aca" ? "detenido" : "cancelada",
        nodoId: resultado.nodoId,
        salientes: sandbox.salientes(),
      };
    }

    if (resultado.tipo === "fin") {
      if (resultado.salto) {
        return {
          pasos,
          desenlace: "saltado",
          salto: resultado.salto,
          salientes: sandbox.salientes(),
        };
      }
      return { pasos, desenlace: "fin", salientes: sandbox.salientes() };
    }
    if (resultado.tipo === "fallado") {
      // Comparar contra el enum, no contra el texto de `error`: un reword del
      // mensaje no puede romper esta rama en silencio.
      return {
        pasos,
        desenlace: resultado.motivo === "tope_pasos" ? "tope" : "fallado",
        error: resultado.error,
        nodoId: resultado.nodoId,
        motivo: resultado.motivo,
        salientes: sandbox.salientes(),
      };
    }
    reloj = resultado.hasta;
    // `resultado.contexto`, no el de entrada: una condición después de una
    // espera tiene que ver lo que escribieron las acciones de antes.
    contexto = resultado.contexto;
    // `reanudarEn` y no el siguiente: una acción diferida reanuda en sí misma.
    nodoActual = resultado.reanudarEn;
  }
}

export interface PasoSimulado {
  nodoId: string;
  orden: number;
  reloj: Date;
  accion: string | null;
  salida: Record<string, unknown> | null;
  efectos: EfectoSimulado[];
}

export interface ResultadoSimulacion {
  pasos: PasoSimulado[];
  desenlace: DesenlacePrueba;
  error?: string;
  salto?: ResultadoPrueba["salto"];
  /** Cuántos mensajes le habría mandado al lead. El número que importa. */
  salientes: number;
}

export interface OpcionesSimulacion {
  maxPasos: number;
  desde: Date;
  contexto?: Record<string, unknown>;
  /** Sólo tests del motor. Ver `EntradaPrueba.registro`. */
  registro?: RegistroDeAcciones;
}

/**
 * Simula un grafo antes de que exista un lead (`scripts/simular-workflow.mjs`).
 * Es `correrPrueba` con un lead vacío y la sesión que abriría un primer
 * mensaje, sin persistir nada.
 */
export async function simular(
  grafo: Grafo,
  opciones: OpcionesSimulacion,
): Promise<ResultadoSimulacion> {
  const lead = leadSimulado(opciones.desde);
  const r = await correrPrueba({
    grafo,
    maxPasos: opciones.maxPasos,
    desde: opciones.desde,
    contexto: opciones.contexto ?? {},
    lead,
    sesion: sesionSimulada(lead.id, opciones.desde),
    runId: "simulacion",
    registro: opciones.registro,
  });

  return {
    pasos: r.pasos.map((p) => {
      const nodo = nodoPorId(grafo, p.nodoId);
      return {
        nodoId: p.nodoId,
        orden: p.orden,
        reloj: p.reloj,
        accion: nodo ? (accionDeNodo(nodo) ?? null) : null,
        salida: p.salida,
        efectos: p.efectos,
      };
    }),
    desenlace: r.desenlace,
    error: r.error,
    salto: r.salto,
    salientes: r.salientes,
  };
}
