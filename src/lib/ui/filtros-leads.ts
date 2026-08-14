import { UUIDSchema } from "@/lib/validation/schemas";
import { CANAL, CURRENT_STAGE, ETAPAS_EMBUDO, MOTIVO_PERDIDA, RESULTADO } from "@/types/domain";
import type { Canal, CurrentStage, MotivoPerdida, Resultado } from "@/types/domain";
import type { UUID } from "@/types/entities";

/**
 * Los filtros de `/leads` viven en la URL y nada más.
 *
 * No hay estado de filtro en cliente: la pantalla es un server component y
 * `searchParams` es su única entrada, así que un filtro puesto se comparte por
 * link y sobrevive al refresh. Este módulo es el único traductor entre esa URL
 * y la forma que espera `LeadsService.listLeads`, para que la pantalla y los
 * chips no puedan discrepar sobre qué significa `?motivo=precio`.
 *
 * `actividad` y `sesion` salieron de acá cuando salieron de la barra: el
 * service los sigue soportando (`LeadsListInput.actividad` y
 * `conSesionActiva`), pero ya nadie los produce.
 */

/** Nombre de cada filtro en la URL. Fuente única: los chips y la página leen de acá. */
export const PARAM = {
  q: "q",
  duplicados: "duplicados",
  canal: "canal",
  etapa: "etapa",
  etiqueta: "etiqueta",
  resultado: "resultado",
  motivo: "motivo",
  sinResponder: "sin_responder",
  marca: "marca",
  modelo: "modelo",
  anio: "anio",
} as const;

/**
 * Los tres params que describen un vehículo. Se ponen y se sacan juntos: la
 * mini-pantalla ofrece "Toyota Corolla 2018" como una sola opción, así que
 * dejar la marca puesta al quitar el modelo sería un filtro que nadie eligió.
 */
export const PARAMS_VEHICULO = [PARAM.marca, PARAM.modelo, PARAM.anio] as const;

/**
 * Las etapas que se ofrecen como chip: el embudo sin `cerrado`.
 *
 * Cómo terminó una sesión lo dice el grupo Cierre —Ganado, o Perdido con su
 * motivo—, así que ofrecer también `cerrado` y `perdido` acá eran dos caminos
 * para el mismo recorte. `requiere_humano` tampoco está: no es una etapa del
 * embudo sino un aviso, y se filtra desde Etiquetas.
 *
 * Se deriva de `ETAPAS_EMBUDO` para que una etapa nueva del embudo aparezca
 * sola; `cerrado` es la única exclusión deliberada.
 *
 * El parser NO se recorta: sigue aceptando los tres contra `CURRENT_STAGE`,
 * porque un link viejo con `?etapa=cerrado` tiene que seguir abriendo la
 * pantalla.
 */
export const ETAPAS_FILTRO: readonly CurrentStage[] = ETAPAS_EMBUDO.filter(
  (etapa) => etapa !== "cerrado",
);

/**
 * El valor de `etapa` con el que se filtran los escalados.
 *
 * Vive en el grupo Etiquetas y no en Etapa porque para quien lo usa es una
 * marca sobre el lead, no un paso del embudo. Sigue siendo `current_stage` en
 * la base: no hay fila en `lead_tags` que pueda quedar desincronizada.
 */
export const ETAPA_REQUIERE_HUMANO = "requiere_humano" as const satisfies CurrentStage;

/** Lo que Next entrega en `searchParams`: repetido llega como array. */
export type ValorParam = string | string[] | undefined;

/**
 * Estructuralmente compatible con `LeadsListInput` (menos `ahora`, que lo pone
 * el servicio). No importa el tipo del service porque `lib/` no puede depender
 * de `server/services/`; el compilador igual verifica la compatibilidad en el
 * punto donde la página llama a `listLeads`.
 */
export interface FiltrosLeads {
  q?: string;
  soloDuplicados?: boolean;
  canal?: Canal;
  etapa?: CurrentStage;
  etiquetaId?: UUID;
  resultado?: Resultado;
  motivoPerdida?: MotivoPerdida;
  sinResponder?: boolean;
  vehiculoMarca?: string;
  vehiculoModelo?: string;
  vehiculoAnio?: number;
}

/** Tope del texto libre de marca/modelo: la URL no es un campo de datos. */
const TEXTO_MAX = 80;

function texto(valor: ValorParam): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpio = valor.trim().slice(0, TEXTO_MAX);
  return limpio === "" ? undefined : limpio;
}

/**
 * Un valor de la lista o nada. Un param repetido, viejo o corrupto equivale a
 * "sin filtro" y nunca a un error: una URL compartida que envejeció tiene que
 * seguir abriendo la pantalla (mismo criterio que `parseCanalFilter`).
 */
function opcion<T extends string>(valor: ValorParam, validos: readonly T[]): T | undefined {
  const s = texto(valor);
  return s !== undefined && (validos as readonly string[]).includes(s) ? (s as T) : undefined;
}

function bandera(valor: ValorParam): true | undefined {
  return texto(valor) === "1" ? true : undefined;
}

/** Año del vehículo: cuatro dígitos o nada. `vehiculo_anio` es un `int`. */
function anio(valor: ValorParam): number | undefined {
  const s = texto(valor);
  return s !== undefined && /^\d{4}$/.test(s) ? Number(s) : undefined;
}

export function parseFiltrosLeads(params: Record<string, ValorParam>): FiltrosLeads {
  const etiqueta = texto(params[PARAM.etiqueta]);

  return {
    q: texto(params[PARAM.q]),
    soloDuplicados: bandera(params[PARAM.duplicados]),
    canal: opcion(params[PARAM.canal], CANAL),
    etapa: opcion(params[PARAM.etapa], CURRENT_STAGE),
    // Un id que no es UUID no se manda a la consulta: PostgREST lo rechaza con
    // un 400 que la pantalla leería como caída, y es un valor que cualquiera
    // puede escribir a mano en la barra de direcciones.
    etiquetaId:
      etiqueta !== undefined && UUIDSchema.safeParse(etiqueta).success ? etiqueta : undefined,
    resultado: opcion(params[PARAM.resultado], RESULTADO),
    motivoPerdida: opcion(params[PARAM.motivo], MOTIVO_PERDIDA),
    sinResponder: bandera(params[PARAM.sinResponder]),
    vehiculoMarca: texto(params[PARAM.marca]),
    vehiculoModelo: texto(params[PARAM.modelo]),
    vehiculoAnio: anio(params[PARAM.anio]),
  };
}

/**
 * Cuántos filtros hay puestos. `q` no cuenta: tiene su propia caja en el
 * encabezado y su propio estado vacío, y sumarlo haría que el contador de los
 * chips mintiera sobre cuántos chips hay encendidos.
 *
 * El vehículo cuenta uno aunque ocupe tres params: quien eligió "Toyota Corolla
 * 2018" hizo un solo gesto y ve un solo control encendido. El cierre cuenta uno
 * por lo mismo: "Perdido: Precio" escribe `resultado` y `motivo`, pero es un
 * chip encendido y un motivo elegido adentro, no dos filtros.
 */
export function contarFiltrosActivos(filtros: FiltrosLeads): number {
  const {
    q: _q,
    vehiculoMarca,
    vehiculoModelo,
    vehiculoAnio,
    resultado,
    motivoPerdida,
    ...chips
  } = filtros;
  const hayVehiculo =
    vehiculoMarca !== undefined || vehiculoModelo !== undefined || vehiculoAnio !== undefined;
  const hayCierre = resultado !== undefined || motivoPerdida !== undefined;
  return (
    Object.values(chips).filter((v) => v !== undefined).length +
    (hayVehiculo ? 1 : 0) +
    (hayCierre ? 1 : 0)
  );
}

/**
 * "Toyota Corolla 2018" con lo que haya en la URL, o nada si no hay vehículo.
 *
 * Se arma de los params y no de la lista de opciones para que un link viejo
 * —con la marca sola, de cuando eran dos `<select>`— siga diciendo qué filtra.
 */
export function vehiculoLabel(filtros: FiltrosLeads): string | undefined {
  const partes = [filtros.vehiculoMarca, filtros.vehiculoModelo, filtros.vehiculoAnio]
    .filter((p) => p !== undefined)
    .map(String);
  return partes.length > 0 ? partes.join(" ") : undefined;
}

const LABEL_RESULTADO: Record<Resultado, string> = {
  exito: "Ganado",
  perdido: "Perdido",
};

export function resultadoLabel(resultado: Resultado): string {
  return LABEL_RESULTADO[resultado];
}

// `motivoPerdidaLabel` vivía acá con su propia copia de los rótulos, que ya
// había derivado ("Tiempo de entrega" contra "Tiempos de entrega" del diálogo
// de cierre). Ahora está en `lib/ui/motivo-perdida`, junto al resto de lo que
// significa un motivo de pérdida, y los filtros lo importan de ahí.
