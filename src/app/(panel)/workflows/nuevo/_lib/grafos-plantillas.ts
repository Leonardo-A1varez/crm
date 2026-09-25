import type { Arista, Grafo, Nodo, NodoTipo, Puerto } from "@/types/workflows";

/**
 * Las seis plantillas de la galería, traducidas a un grafo que el editor abre
 * ya armado.
 *
 * La secuencia de bloques sale de `docs/prd-workflows.md` §5.1. Donde el PRD y
 * la tarjeta de la galería (`components/workflows/lista/plantillas.ts`) dicen
 * cosas distintas —las esperas y el cierre del seguimiento de cotización—,
 * manda la tarjeta: es lo que la persona acaba de leer antes de crear el flujo,
 * y un lienzo que no coincide con lo prometido es el defecto que esto corrige.
 *
 * ## Qué se precarga y qué no
 *
 * Se precarga lo que la plantilla sabe: el disparador, las esperas, la etapa a
 * la que se mueve una sesión, un saludo. Un flujo no mueve a `perdido` ni a
 * `requiere_humano` (el contrato de `cambiar_etapa` los rechaza): pasar a una
 * persona es el bloque de escalado, y cerrar una venta lo decide ella. Lo que depende del negocio —qué
 * etiqueta, qué texto, qué plantilla aprobada por Meta, qué decide una
 * condición— queda vacío, y `pendiente` lo dice con palabras en la pantalla de
 * antes de crear.
 *
 * Las claves de `config` son las que escriben los formularios de
 * `components/workflows/canvas/config/` (`etapaId`, `etapaDestino`, `campo`…):
 * lo precargado tiene que verse en el panel al abrir el bloque.
 *
 * ## El armado en el lienzo
 *
 * Una columna para el camino principal y otra a la derecha para la salida «No»
 * de cada condición, que siempre termina en un Detener. `posicionPuerto`
 * (`lib/ui/workflow-nodos`) reparte los puertos en franjas iguales en el orden
 * de `puertosDe` —`verdadero` a la izquierda, `falso` a la derecha—, así que
 * las líneas no se cruzan. Filas de 144 px y columnas de 288, múltiplos de la
 * grilla de 16 del lienzo (`snapGrid` en `LienzoEditor`): el primer arrastre no
 * hace saltar ningún nodo.
 */

export interface PlantillaArmada {
  grafo: Grafo;
  /**
   * Lo que falta elegir antes de publicar, para completar "antes de publicar
   * falta…". `null` cuando la plantilla ya trae todo lo obligatorio.
   */
  pendiente: string | null;
}

const FILA = 144;
const COLUMNA_SALIDA = 288;

/** Un paso del camino principal. */
function paso(
  id: string,
  tipo: NodoTipo,
  fila: number,
  config: Record<string, unknown> = {},
): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: fila * FILA } };
}

/** El Detener de la salida «No» de una condición, en la columna de la derecha. */
function salidaNo(id: string, fila: number): Nodo {
  return {
    id,
    tipo: "logica_detener",
    config: {},
    posicion: { x: COLUMNA_SALIDA, y: fila * FILA },
  };
}

function arista(desde: string, hasta: string, puerto: Puerto = "salida"): Arista {
  return { desde, hasta, puerto };
}

/** "No contestó": la condición de las dos vueltas del seguimiento de cotización. */
function noRespondio(): Record<string, unknown> {
  return { campo: "sesion.respondio", operador: "es_falso", valor: null };
}

/**
 * Una fábrica por plantilla, no un objeto: cada llamada arma un grafo nuevo y
 * nadie puede modificar el que va a recibir la próxima persona.
 *
 * Un `Map` y no un objeto literal: el id llega de la URL, y en un objeto
 * `"constructor"` o `"toString"` son claves heredadas que devolverían una
 * función en vez de "no existe".
 */
const PLANTILLAS_ARMADAS: ReadonlyMap<string, () => PlantillaArmada> = new Map<
  string,
  () => PlantillaArmada
>([
  [
    "responder-automatico",
    () => ({
      grafo: {
        nodos: [
          paso("n1", "trigger_mensaje", 0),
          paso("n2", "logica_condicion", 1),
          paso("n3", "msg_texto", 2),
          paso("n4", "logica_detener", 3),
          salidaNo("n5", 2),
        ],
        aristas: [
          arista("n1", "n2"),
          arista("n2", "n3", "verdadero"),
          arista("n3", "n4"),
          arista("n2", "n5", "falso"),
        ],
      },
      pendiente: "decidir en la condición cuándo contestar y escribir la respuesta",
    }),
  ],
  [
    "etiquetar-automatico",
    () => ({
      grafo: {
        nodos: [
          paso("n1", "trigger_mensaje", 0),
          paso("n2", "logica_condicion", 1),
          paso("n3", "crm_etiqueta_add", 2),
          paso("n4", "logica_detener", 3),
          salidaNo("n5", 2),
        ],
        aristas: [
          arista("n1", "n2"),
          arista("n2", "n3", "verdadero"),
          arista("n3", "n4"),
          arista("n2", "n5", "falso"),
        ],
      },
      pendiente: "decidir en la condición cuándo etiquetar y elegir la etiqueta",
    }),
  ],
  [
    "escalar-a-humano",
    () => ({
      grafo: {
        nodos: [
          paso("n1", "trigger_mensaje", 0),
          paso("n2", "logica_condicion", 1),
          // El bloque de escalado: marca la sesión y pausa al agente.
          paso("n3", "crm_escalar_humano", 2),
          paso("n4", "int_notif_vendedor", 3, {
            mensaje: "Hay un lead que necesita que lo atienda una persona.",
          }),
          paso("n5", "logica_detener", 4),
          salidaNo("n6", 2),
        ],
        aristas: [
          arista("n1", "n2"),
          arista("n2", "n3", "verdadero"),
          arista("n3", "n4"),
          arista("n4", "n5"),
          arista("n2", "n6", "falso"),
        ],
      },
      pendiente: "decidir en la condición cuándo escalar",
    }),
  ],
  [
    "reactivar-perdidos",
    () => ({
      grafo: {
        nodos: [
          // `dias` es el índice del selector de ConfigTrigger, que arranca en lunes.
          paso("n1", "trigger_cron", 0, { frecuencia: "semanal", hora: "09:00", dias: [0] }),
          paso("n2", "logica_condicion", 1, {
            campo: "lead.etapa",
            operador: "es",
            valor: "perdido",
          }),
          paso("n3", "msg_plantilla", 2),
          paso("n4", "crm_etiqueta_add", 3),
          paso("n5", "logica_detener", 4),
          salidaNo("n6", 2),
        ],
        aristas: [
          arista("n1", "n2"),
          arista("n2", "n3", "verdadero"),
          arista("n3", "n4"),
          arista("n4", "n5"),
          arista("n2", "n6", "falso"),
        ],
      },
      pendiente: "elegir la plantilla de Meta que se manda y la etiqueta que se pone",
    }),
  ],
  [
    "bienvenida-agente",
    () => ({
      grafo: {
        nodos: [
          paso("n1", "trigger_lead_creado", 0),
          paso("n2", "msg_texto", 1, {
            mensaje:
              "¡Hola! Gracias por escribirnos. ¿Qué repuesto estás buscando y para qué vehículo (marca, modelo y año)?",
          }),
          paso("n3", "logica_detener", 2),
        ],
        aristas: [arista("n1", "n2"), arista("n2", "n3")],
      },
      pendiente: null,
    }),
  ],
  [
    "seguimiento-cotizacion",
    () => ({
      grafo: {
        nodos: [
          paso("n1", "trigger_etapa", 0, { etapaDestino: "cotizado" }),
          paso("n2", "logica_esperar", 1, { duracion: 24, unidad: "horas" }),
          paso("n3", "logica_condicion", 2, noRespondio()),
          paso("n4", "msg_plantilla", 3),
          paso("n5", "logica_esperar", 4, { duracion: 48, unidad: "horas" }),
          paso("n6", "logica_condicion", 5, noRespondio()),
          // Tras 72 h sin respuesta no se la da por perdida: se le pasa a una
          // persona, que es quien decide cerrar la venta.
          paso("n7", "crm_escalar_humano", 6),
          paso("n8", "logica_detener", 7),
          salidaNo("n9", 3),
          salidaNo("n10", 6),
        ],
        aristas: [
          arista("n1", "n2"),
          arista("n2", "n3"),
          arista("n3", "n4", "verdadero"),
          arista("n4", "n5"),
          arista("n5", "n6"),
          arista("n6", "n7", "verdadero"),
          arista("n7", "n8"),
          arista("n3", "n9", "falso"),
          arista("n6", "n10", "falso"),
        ],
      },
      pendiente: "elegir la plantilla de Meta del recordatorio",
    }),
  ],
]);

/** El grafo inicial de una plantilla, o `null` si ese id no es una plantilla. */
export function armarPlantilla(id: string): PlantillaArmada | null {
  const armar = PLANTILLAS_ARMADAS.get(id);
  return armar ? armar() : null;
}
