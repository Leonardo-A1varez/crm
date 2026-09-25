/**
 * Tipos de las pantallas de Difusión.
 *
 * Los enums son los del dominio (`@/lib/difusion/modelo`), re-exportados: la
 * pantalla habla el vocabulario del backend y no uno propio. Dos vocabularios
 * para el mismo hecho terminan diciendo cosas distintas —la UI tenía
 * `saturado` donde el planificador dice `saturado_meta`, y siete motivos donde
 * el planificador tiene diez—.
 *
 * Las formas que cruzan desde el servidor (`Alcance`, `CupoVista`,
 * `ExclusionVista`…) tienen acá su espejo con los mismos nombres de campo,
 * porque `components/` no puede importar de `server/` (boundaries). Al ser la
 * misma forma, la página las pasa sin traducir, y si el servicio cambia una,
 * la página deja de compilar en vez de dibujar un campo vacío.
 */

import type { Calidad, EnvioSegunMeta, EstadoPlantillaLeida } from "@/components/ajustes/tipos";
import type {
  CategoriaPlantilla,
  EstadoDifusion,
  EstadoEnvio,
  MotivoExclusion,
  RutaEnvio,
} from "@/lib/difusion/modelo";

export type {
  CategoriaPlantilla,
  EstadoDifusion,
  ModoAudiencia,
  MotivoExclusion,
  RutaEnvio,
} from "@/lib/difusion/modelo";
export type { CampoAudiencia } from "@/lib/difusion/audiencia";

/** Un dato que puede no haber llegado, con el porqué. */
export type Dato<T> = { estado: "ok"; valor: T } | { estado: "sin-dato"; motivo: string };

// --- entrega -----------------------------------------------------------------

/**
 * Los estados de un envío que salió o iba a salir: todos menos `excluido`,
 * que es alguien que nunca estuvo en la lista.
 *
 * `aceptado` NO es `entregado`: es el 200 de la Cloud API con un `wamid`, y
 * nada más. Meta todavía puede no entregarlo nunca, y por eso nunca se cuenta
 * en la misma cifra que un `entregado`.
 */
export type EstadoEntrega = Exclude<EstadoEnvio, "excluido">;

/**
 * Los estados se leen en grupos, y esa división es la idea entera: lo que
 * todavía no llegó a ningún teléfono, lo que ya se resolvió y lo que se frenó.
 * El separador entre grupos es lo que impide sumar `aceptado` con `entregado`.
 */
export type GrupoEstado = "en_vuelo" | "resuelto" | "frenado";

export type ConteoEntrega = Record<EstadoEntrega, number>;

/** Los fallidos de un código de Meta, con lo que dice la tabla de §4.4. */
export interface FalloPorMotivo {
  codigo: string;
  cantidad: number;
  /** `null` = el código no está en la tabla: se muestra el número y nada más. */
  significado: string | null;
  reintento: string | null;
  reintentable: boolean | null;
}

// --- audiencia ---------------------------------------------------------------

/**
 * El árbol de la audiencia **es** el árbol de condiciones compartido: el mismo
 * tipo, re-exportado con el nombre que usa esta pantalla. `Conector` es alias
 * de `Operador` porque el resto de Difusión ya lo nombra así.
 */
export type {
  CampoCondicion,
  Comparador,
  Grupo as GrupoAudiencia,
  NodoCondicion as NodoAudiencia,
  OpcionCampo,
  Operador as Conector,
  Regla as CondicionAudiencia,
  ValorCondicion,
} from "@/lib/ui/condiciones";

export interface Exclusion {
  motivo: MotivoExclusion;
  /** Si está aplicada, cuántos excluye; si está eximida, a cuántos excluiría. */
  cantidad: number;
  aplicada: boolean;
  /**
   * La deja desmarcar el backend: sólo en negociación y tope de frecuencia
   * (`esMotivoEximible`). Las demás protegen al número o a una conversación
   * en curso y no se levantan.
   */
  eximible: boolean;
}

export interface Destinatario {
  leadId: string;
  nombre: string;
  /** Enmascarado en el servidor: el número entero no llega a la pantalla. */
  telefono: string;
  vehiculo: string | null;
  ruta: RutaEnvio;
  /** 0 = la primera tanda. */
  tanda: number;
  /** Contra el envío anterior; `null` si no se pidió o no hay con qué comparar. */
  diff: "nuevo" | "repite" | null;
}

export interface DiffContraAnterior {
  /** La difusión con la que se compara. */
  referencia: { id: string; nombre: string };
  nuevos: number;
  repiten: number;
  yaNoCalifican: number;
}

export interface AlcanceAudiencia {
  /** Los que coinciden con las condiciones, antes de excluir. */
  coinciden: number;
  /** Los que quedan, según el planificador. No se recalcula restando. */
  destinatarios: number;
  /** Los diez motivos, en el orden de precedencia del planificador. */
  exclusiones: Exclusion[];
  porVentanaAbierta: number;
  porPlantilla: number;
  /** Una página de la lista, en el orden en que salen. */
  muestra: Destinatario[];
  /** Se calculó como marketing porque todavía no hay plantilla elegida. */
  categoriaSupuesta: boolean;
}

/**
 * En qué está el cálculo del alcance. Con una fila a medias o sin condiciones
 * no se le pregunta nada al servidor: no hay un número honesto que mostrar.
 * `previo` es el último cálculo que salió, para no dejar el panel en blanco
 * mientras se recalcula o si el recálculo falla.
 */
export type EstadoAlcance =
  | { estado: "incompleta"; faltan: number }
  | { estado: "sin-condiciones" }
  | { estado: "calculando"; previo: AlcanceAudiencia | null }
  | { estado: "listo"; alcance: AlcanceAudiencia; calculado: string }
  | { estado: "error"; mensaje: string; previo: AlcanceAudiencia | null };

// --- cupo y salud ------------------------------------------------------------

/** El cupo de la ventana móvil de 24 h, tal como lo devuelve el servicio. */
export type Cupo =
  | {
      estado: "ok";
      /** El escalón de Meta: destinatarios únicos por 24 h. */
      tope: number | "ilimitado";
      /** Contado con los envíos de este CRM: Meta no expone el uso. */
      usado24h: number;
      /** Apartado para conversaciones vivas. La difusión no lo toca. */
      reserva: number;
      /** tope − usado. */
      restante: number;
      /** Plantillas por tanda de 24 h, según el planificador. */
      porTanda: number;
      /** Plantillas que pide esta difusión. Las de ventana abierta no consumen cupo. */
      solicitado: number;
      /** `false` = lo pedido por plantilla no entra en ninguna tanda. */
      alcanza: boolean;
    }
  | { estado: "sin-dato"; motivo: string; solicitado: number };

/** Una tanda del planificador, con la fecha ya escrita en la hora del negocio. */
export interface TandaReparto {
  /** 0 = la primera. */
  tanda: number;
  desde: string;
  porPlantilla: number;
  porVentanaAbierta: number;
}

export interface PlantillaPausada {
  nombre: string;
  /** La usa esta difusión: bloquea el envío en vez de sólo avisar. */
  laUsaEstaDifusion: boolean;
}

/** El número por el que manda el CRM, leído de Meta. */
export interface SaludNumero {
  calidad: Dato<{ calidad: Calidad; cruda: string | null }>;
  escalon: Dato<number | "ilimitado">;
  /** El agregado de `health_status`. */
  envio: EnvioSegunMeta;
  plantillasPausadas: Dato<PlantillaPausada[]>;
  /** De qué versión de la API y cuándo se leyó. */
  fuente: string;
}

// --- costo -------------------------------------------------------------------

export interface LineaCosto {
  cantidad: number;
  concepto: string;
  /** `null` = no hay tarifa de dónde sacar el precio. */
  usd: number | null;
}

export interface TarifaPlantilla {
  usdPorMensaje: number;
  /** De dónde sale la tarifa. Va a la vista: una cifra sin fuente se lee como dato. */
  fuente: string;
}

// --- listado y envío -----------------------------------------------------------

export interface Difusion {
  id: string;
  nombre: string;
  plantilla: string | null;
  estado: EstadoDifusion;
  /** Las filas que nacieron en cola: el plan, no lo que salió. */
  destinatarios: number;
  /** Entregados más leídos: los que llegaron a un teléfono. */
  entregados: number;
  leidos: number;
  /** `null` = todavía nada registra las respuestas a una difusión. */
  respondieron: number | null;
  /** `null` = todavía nada registra lo que cobró Meta. */
  costoUsd: number | null;
  /** Fecha legible, ya en la hora del negocio. */
  cuando: string;
}

/** Lo que pinta el listado, del servicio (`DifusionService.listar`). */
export interface ListadoVista {
  difusiones: Difusion[];
  /** Hay más difusiones de las que se muestran. */
  hayMas: boolean;
  /** Números en la lista de supresión propia. */
  suprimidos: number;
  destinatarios30d: number;
  /** `false` = hubo más difusiones en 30 días de las que se leyeron: la suma es un piso. */
  destinatarios30dCompleto: boolean;
}

/** Una tanda del plan ya guardado. */
export interface TandaEnvio {
  tanda: number;
  desde: string;
  total: number;
  enCola: number;
  porPlantilla: number;
}

/** Lo que muestra la pantalla de una difusión que ya se programó. */
export interface EnvioDifusion {
  id: string;
  nombre: string;
  estado: EstadoDifusion;
  plantilla: string | null;
  conteo: ConteoEntrega;
  /** Destinatarios: el plan sin los excluidos. */
  total: number;
  excluidos: number;
  tandas: TandaEnvio[];
  fallos: FalloPorMotivo[];
  /** Tamaño de la muestra que sale primero. `null` = sin muestra. */
  canaryTamano: number | null;
  programadaPara: string | null;
  finalizadaAt: string | null;
  motivoDetencion: string | null;
  /** La frenó una persona; `false` en una detenida = la frenó el sistema. */
  detenidaPorPersona: boolean;
}

// --- mensaje -----------------------------------------------------------------

/** Un botón de respuesta rápida: texto fijo, aprobado junto con la plantilla. */
export interface BotonRespuestaRapida {
  id: string;
  texto: string;
}

/**
 * Una plantilla de WhatsApp tal como la necesita el paso «Mensaje».
 *
 * El estado usa el vocabulario de la tabla de plantillas de Ajustes, con
 * `otro` para lo que Meta informa y este CRM no traduce.
 *
 * **Cuerpo, encabezado, pie y botones llegan en `null`/vacío**: la lectura de
 * plantillas de Meta que usa el CRM trae nombre, idioma, categoría y estado,
 * pero no los componentes. La pantalla lo dice en vez de inventar un texto.
 */
export interface Plantilla {
  /** El id de Meta: una misma plantilla tiene uno por idioma. */
  id: string;
  /** Como figura en el administrador de Meta: `promo_frenos_v3`. */
  nombre: string;
  idioma: string | null;
  categoria: CategoriaPlantilla;
  estado: EstadoPlantillaLeida;
  /** Por qué está como está, cuando Meta dio un motivo. */
  nota: string | null;
  /** Pausada por ritmo de envío: Meta no la despausa sola. Hoy ninguna lectura lo distingue. */
  requiereDespausadoManual: boolean;
  /** 1 y 2 son pausas con reloj (3 h y 6 h); 3 es la deshabilitación. */
  escalonPausado: 1 | 2 | 3 | null;
  encabezado: string | null;
  /** Con las variables posicionales de Meta tal cual: `{{1}}`. `null` = no se leyó. */
  cuerpo: string | null;
  pie: string | null;
  /** Solo los de respuesta rápida, que son los que este paso configura. */
  botones: BotonRespuestaRapida[];
}

/** Las plantillas que se pueden ofrecer, tal como se leyeron de Meta. */
export interface LecturaPlantillas {
  /** Sólo marketing y utility. */
  plantillas: Plantilla[];
  /** Las de otra categoría, que no se ofrecen. */
  ocultas: number;
  /** Algo de la lectura que hay que decir (Meta tiene más de las que se leyeron). */
  nota: string | null;
}

/**
 * Los datos del lead que puede llevar una variable. Cada uno sale de una
 * columna que existe hoy (ver `campos-mensaje.ts`).
 */
export type CampoVariable =
  | "nombre"
  | "nombre_perfil"
  | "vehiculo_marca"
  | "vehiculo_modelo"
  | "vehiculo_anio"
  | "consulta";

/** Lo que se sabe de un lead. Clave ausente o vacía = ese dato no está. */
export type ValoresLead = Partial<Record<CampoVariable, string>>;

export interface AsignacionVariable {
  /** De qué dato del lead sale. `null` = todavía no se eligió. */
  campo: CampoVariable | null;
  /** Texto literal para quien no tenga el dato. No interpola ni acepta `{{ }}`. */
  respaldo: string;
}

/** Qué pasa cuando alguien toca un botón. */
export type AccionBoton =
  | { tipo: "agente" }
  | { tipo: "humano" }
  | { tipo: "etiquetar"; etiqueta: string | null }
  | { tipo: "baja" };

export type TipoAccionBoton = AccionBoton["tipo"];

export interface ConfigMensaje {
  plantillaId: string;
  /** Por número de variable: la clave `1` es `{{1}}`. */
  variables: Readonly<Record<number, AsignacionVariable>>;
  /** Por id de botón. */
  botones: Readonly<Record<string, AccionBoton>>;
}
