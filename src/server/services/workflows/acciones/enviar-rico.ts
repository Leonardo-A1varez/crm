import { NotFoundError, ValidationError } from "@/lib/errors";
import { configDeAccion, type ConfigDeAccion } from "@/lib/workflows/config-nodos";
import {
  ESPERA_DE_OPCION_RESUELTA,
  esperaDeOpcionDe,
  marcarEsperaDeOpcion,
} from "@/lib/workflows/respuesta-interactiva";
import { consumirRespuestaDeTurno } from "@/lib/workflows/interceptar";
import { interpolarVariables, type DatosInterpolacion } from "@/lib/workflows/variables";
import type { ContenidoRico, MetaApiService } from "@/server/services/meta-api.service";
import {
  PUERTO_SIN_RESPUESTA,
  puertoDeOpcion,
  type Nodo,
  type ResultadoAccion,
} from "@/types/workflows";
import type { UUID } from "@/types/entities";
import { cargarDatosInterpolacion } from "./datos-interpolacion";
import type { AccionEnviarMensajeDeps } from "./enviar-mensaje";
import type { AccionHandler, EntornoAccion } from "./registro";
import { revisarTopesDeEnvio, ventanaAbierta } from "./topes-de-envio";

const MS_POR_UNIDAD = {
  minutos: 60_000,
  horas: 60 * 60_000,
  dias: 24 * 60 * 60_000,
} as const;

/**
 * De dónde sale la URL de una imagen subida desde el panel: el bucket es
 * privado, así que se firma al mandar. Meta la descarga en ese momento (y la
 * cachea 10 minutos), así que una firma corta alcanza.
 */
export interface ImagenesDeFlujo {
  urlFirmada(ruta: string): Promise<string>;
}

export type AccionesMensajeriaRicaDeps = Omit<
  AccionEnviarMensajeDeps,
  "metaApi" | "plantillasSinSesion"
> & {
  metaApi: Pick<MetaApiService, "sendRico">;
  plantillasSinSesion: AccionEnviarMensajeDeps["plantillasSinSesion"];
  imagenesDeFlujo: ImagenesDeFlujo;
};

type AccionRica = "enviar_botones" | "enviar_lista" | "enviar_imagen" | "enviar_ubicacion";

/** Lo que manda cada bloque, con los textos ya resueltos. */
type Armado = { contenido: ContenidoRico; archivo?: string };

function requireLeadSessionId(nodo: Nodo, accion: AccionRica, entorno: EntornoAccion): UUID {
  if (entorno.leadSessionId) return entorno.leadSessionId;
  throw new ValidationError(
    `el nodo "${nodo.id}" (${accion}) necesita una sesión activa y la corrida no tiene una`,
    "lead_session_id_ausente",
  );
}

/** Un texto con variables resuelto. Vacío después de resolver = `null`. */
function resolver(texto: string | undefined, datos: DatosInterpolacion): string | null {
  if (texto === undefined) return null;
  const { texto: resuelto } = interpolarVariables(texto, datos);
  return resuelto.trim() === "" ? null : resuelto;
}

/** Un texto obligatorio que una variable dejó vacío no se manda: Meta lo rechaza. */
function obligatorio(texto: string | null, nodo: Nodo, accion: AccionRica, campo: string): string {
  if (texto !== null) return texto;
  throw new ValidationError(
    `el nodo "${nodo.id}" (${accion}): ${campo} quedó vacío para este lead`,
    "texto_vacio",
  );
}

function armarBotones(
  c: ConfigDeAccion<"enviar_botones">,
  datos: DatosInterpolacion,
  nodo: Nodo,
): Armado {
  return {
    contenido: {
      tipo: "botones",
      cuerpo: obligatorio(resolver(c.mensaje, datos), nodo, "enviar_botones", "el mensaje"),
      botones: c.botones.map((b) => ({ id: b.id, titulo: b.texto })),
    },
  };
}

function armarLista(
  c: ConfigDeAccion<"enviar_lista">,
  datos: DatosInterpolacion,
  nodo: Nodo,
): Armado {
  return {
    contenido: {
      tipo: "lista",
      encabezado: resolver(c.header, datos),
      cuerpo: obligatorio(resolver(c.body, datos), nodo, "enviar_lista", "el mensaje"),
      pie: resolver(c.footer, datos),
      boton: c.botonTexto,
      secciones: c.secciones.map((s) => ({
        titulo: s.titulo.trim() === "" ? null : s.titulo,
        filas: s.items.map((i) => ({
          id: i.id,
          titulo: i.titulo,
          descripcion: i.descripcion.trim() === "" ? null : i.descripcion,
        })),
      })),
    },
  };
}

async function armarImagen(
  c: ConfigDeAccion<"enviar_imagen">,
  datos: DatosInterpolacion,
  imagenes: ImagenesDeFlujo,
): Promise<Armado> {
  const caption = resolver(c.caption, datos);
  if (c.tipoMedia === "archivo") {
    // El schema garantiza la ruta (`RUTA_IMAGEN_DE_FLUJO`).
    const archivo = c.archivo as string;
    return {
      contenido: { tipo: "imagen", url: await imagenes.urlFirmada(archivo), caption },
      archivo,
    };
  }
  return { contenido: { tipo: "imagen", url: c.url as string, caption } };
}

function armarUbicacion(c: ConfigDeAccion<"enviar_ubicacion">, datos: DatosInterpolacion): Armado {
  return {
    contenido: {
      tipo: "ubicacion",
      lat: c.lat,
      lon: c.lon,
      nombre: resolver(c.nombre, datos),
      direccion: resolver(c.direccion, datos),
    },
  };
}

/**
 * La segunda pasada de botones o lista: la espera ya terminó —el lead eligió o
 * venció el tiempo— y el nodo sale por la línea que corresponde. No manda
 * nada ni revisa topes: no hay nada que mandar.
 *
 * Una respuesta que no es ninguna opción del nodo no debería llegar (la
 * versión de la corrida está fijada); si llega, sale por «sin respuesta» y
 * queda anotada, en vez de fallar la corrida por algo que eligió el lead.
 */
function resolverEspera(
  nodo: Nodo,
  opciones: readonly string[],
  respuesta: { id: string; titulo: string } | undefined,
): ResultadoAccion {
  if (!respuesta) {
    return { puerto: PUERTO_SIN_RESPUESTA, contexto: ESPERA_DE_OPCION_RESUELTA, salida: {} };
  }
  if (!opciones.includes(respuesta.id)) {
    return {
      puerto: PUERTO_SIN_RESPUESTA,
      contexto: ESPERA_DE_OPCION_RESUELTA,
      salida: { respuesta_desconocida: respuesta.id },
    };
  }
  return {
    puerto: puertoDeOpcion(respuesta.id),
    contexto: ESPERA_DE_OPCION_RESUELTA,
    salida: { respuesta: respuesta.id, titulo: respuesta.titulo },
  };
}

/**
 * Botones, lista, imagen y ubicación por WhatsApp. El orden es el de "Enviar
 * mensaje" (`enviar-mensaje.ts`), sin reordenar:
 *
 *   1. Topes del lead, de frecuencia y horario (`topes-de-envio.ts`).
 *   2. Sólo WhatsApp: Instagram y Messenger no tienen estos mensajes.
 *   3. Ventana de 24 h: son mensajes de servicio, y fuera de la ventana Meta
 *      sólo deja pasar plantillas. Salta con `sin_ventana`, como el texto.
 *   4. Mandar, con la clave `wf:<runId>:<orden>`: un reintento del step no
 *      manda dos veces (`MetaApiService.sendRico` deduplica).
 *
 * Botones y lista no siguen enseguida: piden esperar (`esperarRespuesta`) y
 * reanudan en sí mismos. La segunda pasada no manda (`resolverEspera`).
 */
function crearAccionRica(accion: AccionRica, deps: AccionesMensajeriaRicaDeps): AccionHandler {
  return async (nodo, entorno) => {
    const ahora = entorno.ahora ?? new Date();

    if (accion === "enviar_botones" || accion === "enviar_lista") {
      const espera = esperaDeOpcionDe(entorno.contexto, nodo.id);
      if (espera) {
        const opciones =
          accion === "enviar_botones"
            ? configDeAccion("enviar_botones", nodo).botones.map((b) => b.id)
            : configDeAccion("enviar_lista", nodo).secciones.flatMap((s) =>
                s.items.map((i) => i.id),
              );
        return resolverEspera(nodo, opciones, espera.respuesta);
      }
    }

    // La config se valida antes de cualquier efecto: una mal armada falla sin
    // reintento y sin haber mirado topes.
    const config = configDeAccion(accion, nodo);
    const leadSessionId = requireLeadSessionId(nodo, accion, entorno);

    const topes = await revisarTopesDeEnvio(deps, entorno, ahora, accion);
    if (topes.tipo === "salto") return { puerto: "salida", salto: topes.salto };
    if (topes.tipo === "diferir") {
      return { puerto: "salida", diferirHasta: topes.hasta, salida: { diferido: true } };
    }
    const { lead } = topes;

    const conversacion = await deps.conversations.findActivaByLead(entorno.leadId);
    if (!conversacion) {
      throw new NotFoundError(
        `el lead ${entorno.leadId} no tiene conversación activa`,
        "conversacion",
        entorno.leadId,
      );
    }
    if (conversacion.canal !== "wa") {
      throw new ValidationError(
        `el nodo "${nodo.id}" (${accion}) sólo manda por WhatsApp y la conversación activa es de ${conversacion.canal}`,
        "mensaje_rico_fuera_de_whatsapp",
      );
    }
    if (!ventanaAbierta(conversacion.ultimo_entrante_at, ahora)) {
      return {
        puerto: "salida",
        salto: {
          motivo: "sin_ventana",
          detalle:
            "La ventana de 24 h de Meta está cerrada: fuera de ella sólo sale una plantilla aprobada.",
        },
      };
    }

    const datos = await cargarDatosInterpolacion(
      { leads: deps.leads, sessions: deps.sessions, users: deps.users },
      { leadId: entorno.leadId, leadSessionId, contexto: entorno.contexto },
    );
    const armado =
      accion === "enviar_botones"
        ? armarBotones(config as ConfigDeAccion<"enviar_botones">, datos, nodo)
        : accion === "enviar_lista"
          ? armarLista(config as ConfigDeAccion<"enviar_lista">, datos, nodo)
          : accion === "enviar_imagen"
            ? await armarImagen(
                config as ConfigDeAccion<"enviar_imagen">,
                datos,
                deps.imagenesDeFlujo,
              )
            : armarUbicacion(config as ConfigDeAccion<"enviar_ubicacion">, datos);

    const mensaje = await deps.metaApi.sendRico({
      conversacionId: conversacion.id,
      leadSessionId,
      to: lead.telefono,
      contenido: armado.contenido,
      ...(armado.archivo !== undefined ? { archivo: armado.archivo } : {}),
      sender: "sistema",
      idempotencyKey: `wf:${entorno.runId}:${entorno.orden}`,
    });

    // Salió: si era la respuesta de un turno interceptado, la marca se consume.
    const consumida = consumirRespuestaDeTurno(entorno.contexto) ?? {};
    if (accion === "enviar_botones" || accion === "enviar_lista") {
      const { timeout, unidadTimeout } = config as ConfigDeAccion<"enviar_botones">;
      const respondeA = mensaje.meta_message_id ?? null;
      return {
        puerto: PUERTO_SIN_RESPUESTA,
        esperarRespuesta: {
          hasta: new Date(ahora.getTime() + timeout * MS_POR_UNIDAD[unidadTimeout]),
          respondeA,
        },
        contexto: { ...marcarEsperaDeOpcion(nodo.id, respondeA), ...consumida },
        salida: { mensaje_id: mensaje.id },
      };
    }
    return {
      puerto: "salida",
      salida: { mensaje_id: mensaje.id },
      ...(Object.keys(consumida).length > 0 ? { contexto: consumida } : {}),
    };
  };
}

export function crearAccionesDeMensajeriaRica(
  deps: AccionesMensajeriaRicaDeps,
): Record<AccionRica, AccionHandler> {
  return {
    enviar_botones: crearAccionRica("enviar_botones", deps),
    enviar_lista: crearAccionRica("enviar_lista", deps),
    enviar_imagen: crearAccionRica("enviar_imagen", deps),
    enviar_ubicacion: crearAccionRica("enviar_ubicacion", deps),
  };
}
