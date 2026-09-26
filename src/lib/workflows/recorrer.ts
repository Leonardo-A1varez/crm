import { esTrigger } from "@/types/workflows";
import type { Canal, TipoMensaje } from "@/types/domain";
import type { DatosDisparo, Grafo, Nodo, NodoTipoTrigger, Puerto } from "@/types/workflows";
import { DISPARADOR_DE_TIPO, type DisparadorWorkflow } from "./catalogo";
import {
  ESPEC_CONFIG_POR_TIPO,
  normalizarConfig,
  type ConfigDeTipo,
  type EspecConfig,
} from "./config-nodos";

export function nodoPorId(grafo: Grafo, id: string): Nodo | undefined {
  return grafo.nodos.find((n) => n.id === id);
}

/**
 * El nodo por el que arranca una corrida. **Es la única búsqueda del
 * disparador del proyecto**: el motor, el despacho, el simulador y la lectura
 * del grafo pasan por acá.
 *
 * Reconoce el `disparador` legacy y los `trigger_*` de la paleta. Comparar
 * contra el literal legacy (`tipo === "disparador"`) era el Corte 2 de la
 * Fase 0: todo grafo armado en el canvas moría con `grafo_sin_disparador`.
 */
export function disparadorDe(grafo: Grafo): Nodo | undefined {
  return grafo.nodos.find((n) => esTrigger(n.tipo));
}

/**
 * Los únicos eventos que puede escuchar el `disparador` legacy: los que
 * existían cuando se armaron esos grafos. Los que llegaron después (lead creado,
 * manual, programado…) son de los `trigger_*` del canvas. Un legacy con
 * `"manual"` en la config arrancaría con cualquier disparo manual sin que nadie
 * lo haya elegido, y uno con `"programado"` no tiene dónde decir a qué hora.
 */
const DISPARADORES_LEGACY: ReadonlySet<string> = new Set<DisparadorWorkflow>([
  "mensaje_recibido",
  "etiqueta_asignada",
  "etapa_cambiada",
]);

/**
 * Qué evento de dominio escucha el nodo disparador. El legacy lo lleva en
 * `config.disparador`; los del canvas, en el tipo (`DISPARADOR_DE_TIPO`).
 * `undefined` = no escucha ninguno que tenga emisor.
 */
function eventoQueEscucha(nodo: Nodo): string | undefined {
  if (nodo.tipo === "disparador") {
    const disparador = configDeDisparador("disparador", nodo.config)?.disparador;
    return disparador !== undefined && DISPARADORES_LEGACY.has(disparador) ? disparador : undefined;
  }
  return DISPARADOR_DE_TIPO[nodo.tipo as NodoTipoTrigger];
}

/**
 * ¿El grafo escucha este tipo de evento? Chequeo **grueso**: sólo el nombre,
 * sin mirar la configuración del trigger.
 *
 * Es lo que usa `listarPublicadasPorDisparador` en las dos impls del repo para
 * no traer versiones que nunca podrían arrancar. **No alcanza para despachar**:
 * "cuando se le pone la etiqueta X" escucha `etiqueta_asignada` con cualquier
 * etiqueta. El despacho usa `disparoCoincide`, que además aplica los filtros.
 */
export function disparadorMatch(grafo: Grafo, disparador: string): boolean {
  const nodo = disparadorDe(grafo);
  return nodo !== undefined && eventoQueEscucha(nodo) === disparador;
}

/**
 * La config de un disparador —los `trigger_*` y el `disparador` legacy— leída
 * con su schema (`config-nodos.ts`, el contrato que comparten el panel, el
 * validador y el motor): las claves viejas pasadas a su nombre de hoy y el
 * default del panel donde no hay nada escrito.
 *
 * `null` = la config no pasa el schema, y quien la lee **falla cerrado**. Un
 * filtro mal leído que deja pasar todo le escribe a leads que nadie eligió; uno
 * que no deja pasar nada se ve en el historial vacío y se corrige.
 */
export function configDeDisparador<T extends NodoTipoTrigger | "disparador">(
  tipo: T,
  config: Record<string, unknown>,
): ConfigDeTipo<T> | null {
  const espec: EspecConfig = ESPEC_CONFIG_POR_TIPO[tipo];
  const resultado = espec.schema.safeParse(normalizarConfig(tipo, config));
  return resultado.success ? (resultado.data as ConfigDeTipo<T>) : null;
}

/**
 * ¿Este evento arranca una corrida de este grafo? El chequeo grueso más los
 * filtros que el panel del canvas escribe en el trigger, leídos con
 * `configDeDisparador`.
 *
 * La ausencia de un campo vale lo que el panel muestra por defecto ("todos",
 * "cualquiera"): el panel dibuja ese valor pero no lo guarda hasta que alguien
 * lo toca, así que un nodo recién soltado tiene la config vacía. Eso lo
 * resuelven los defaults del schema, no este archivo.
 */
export function disparoCoincide(grafo: Grafo, disparador: string, datos: DatosDisparo): boolean {
  const nodo = disparadorDe(grafo);
  if (!nodo || eventoQueEscucha(nodo) !== disparador) return false;

  switch (nodo.tipo) {
    case "trigger_mensaje": {
      const config = configDeDisparador("trigger_mensaje", nodo.config);
      return config !== null && mensajeCoincide(config, datos);
    }
    case "trigger_etiqueta": {
      // Sin etiqueta elegida el schema no pasa: no hay "la etiqueta X".
      const config = configDeDisparador("trigger_etiqueta", nodo.config);
      return config !== null && datos.tagId === config.tagId;
    }
    case "trigger_etiqueta_removida": {
      const config = configDeDisparador("trigger_etiqueta_removida", nodo.config);
      return config !== null && datos.tagId === config.tagId;
    }
    case "trigger_etapa": {
      const config = configDeDisparador("trigger_etapa", nodo.config);
      return config !== null && etapaCoincide(config, datos);
    }
    case "trigger_difusion_respondida": {
      const config = configDeDisparador("trigger_difusion_respondida", nodo.config);
      if (config === null) return false;
      // Vacío = cualquier difusión. Con una elegida, sin el dato de a cuál
      // respondió no se arranca: falla cerrado.
      return config.difusionId === "" || datos.difusionId === config.difusionId;
    }
    default:
      // Sin filtros: el `disparador` legacy matchea por nombre, "Lead creado"
      // no tiene configuración, y los dirigidos (programado, inactividad,
      // manual) ya los eligió quien los emitió — `workflow-disparar` filtra por
      // el `workflowId` que trae el disparo.
      return true;
  }
}

/** Lo que muestra el selector de canal del panel, traducido al canal del dominio. */
const CANAL_DEL_PANEL: Readonly<Record<ConfigDeTipo<"trigger_mensaje">["canal"], Canal | "todos">> =
  {
    todos: "todos",
    whatsapp: "wa",
    instagram: "ig",
    messenger: "fb",
  };

/** "Solo media" del panel. `location` no es media y `template` sólo sale, nunca entra. */
const TIPOS_MEDIA: ReadonlySet<TipoMensaje> = new Set(["image", "audio", "video", "doc"]);

function mensajeCoincide(config: ConfigDeTipo<"trigger_mensaje">, datos: DatosDisparo): boolean {
  const canal = CANAL_DEL_PANEL[config.canal];
  if (canal !== "todos" && datos.canal !== canal) return false;

  switch (config.filtro) {
    case "todos":
      return true;
    case "solo_texto":
      return datos.tipoMensaje === "text";
    case "solo_media":
      return datos.tipoMensaje !== undefined && TIPOS_MEDIA.has(datos.tipoMensaje);
    case "contiene": {
      const palabra = (config.palabra ?? "").trim();
      // Vacía, "contiene" es verdadero para todo mensaje: falla cerrado.
      if (palabra === "") return false;
      return (datos.texto ?? "").toLowerCase().includes(palabra.toLowerCase());
    }
  }
}

function etapaCoincide(config: ConfigDeTipo<"trigger_etapa">, datos: DatosDisparo): boolean {
  if (datos.etapaNueva !== config.etapaDestino) return false;
  return config.etapaOrigen === "cualquiera" || datos.etapaAnterior === config.etapaOrigen;
}

/**
 * Cuál nodo sigue al salir de `nodoId` por `puerto`.
 *
 * `undefined` significa que el puerto no tiene arista. En un grafo que pasó el
 * validador eso sólo puede pasar en un `fin`, que no tiene puertos: el resto
 * los tiene todos conectados por la regla `salida_sin_conectar`.
 */
export function siguienteNodo(grafo: Grafo, nodoId: string, puerto: Puerto): string | undefined {
  return grafo.aristas.find((a) => a.desde === nodoId && a.puerto === puerto)?.hasta;
}
