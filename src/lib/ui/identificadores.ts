import { IDENTIFICADOR_TIPO } from "@/types/domain";
import type { IdentificadorTipo } from "@/types/domain";
import type { LeadIdentificador } from "@/types/entities";

/**
 * Cómo se lee un identificador en pantalla: el rótulo del tipo, un ejemplo de
 * qué escribir, de dónde salió el dato y en qué orden se muestran.
 */

/**
 * El rótulo de cada tipo.
 *
 * `ruc` se muestra como "Documento fiscal" y no como "RUC": el enum de la base
 * usa el nombre peruano/ecuatoriano, pero el producto vende también en Brasil
 * (CNPJ), México (RFC), Argentina (CUIT), Chile (RUT) y Colombia (NIT). Un
 * campo rotulado "RUC" en São Paulo se lee como "no es para mí". Los nombres
 * locales van en el texto de ayuda, que es donde sirven.
 */
export const IDENTIFICADOR_LABEL: Record<IdentificadorTipo, string> = {
  telefono: "Teléfono",
  email: "Email",
  ruc: "Documento fiscal",
  placa: "Placa",
  vin: "VIN",
};

/** Qué escribir en cada tipo. Va de placeholder del input. */
export const IDENTIFICADOR_AYUDA: Record<IdentificadorTipo, string> = {
  telefono: "+54 9 11 5555-0002",
  email: "compras@taller.com",
  ruc: "RUC, CUIT, CNPJ, RFC, RUT o NIT",
  placa: "AB-123-CD",
  vin: "17 caracteres",
};

/**
 * De dónde salió el identificador, dicho para una persona.
 *
 * `origen` es `text` en la base y no un enum, así que un valor que este mapa no
 * conoce se muestra tal cual en vez de desaparecer: saber que hay un origen
 * raro es mejor que no ver nada.
 */
export const ORIGEN_LABEL: Record<string, string> = {
  meta: "llegó por el canal",
  manual: "cargado a mano",
  extractor: "lo dijo el cliente",
  merge: "vino de una fusión",
};

export function origenLabel(origen: string): string {
  return ORIGEN_LABEL[origen] ?? origen;
}

/**
 * El texto que se muestra: lo que escribió la persona, o el normalizado si la
 * fila no guardó original.
 *
 * Se muestra `valor_original` y se compara `valor` a propósito:
 * "+54 9 11 5555-0002" se lee de un vistazo y "5491155550002" no, pero el
 * detector necesita la segunda forma. Mostrar la normalizada sería castigar al
 * vendedor por una decisión que solo le importa al detector.
 */
export function valorVisible(identificador: LeadIdentificador): string {
  const original = identificador.valor_original?.trim() ?? "";
  return original === "" ? identificador.valor : original;
}

export interface GrupoIdentificadores {
  tipo: IdentificadorTipo;
  label: string;
  items: LeadIdentificador[];
}

/**
 * Los identificadores agrupados por tipo, en el orden en que se leen.
 *
 * Los grupos salen en el orden de `IDENTIFICADOR_TIPO` —de lo más frecuente a
 * lo más específico— y no en el orden de llegada: si dependiera de los datos,
 * la ficha se reordenaría sola cada vez que alguien agrega un dato y no habría
 * dónde apoyar la vista. Los tipos sin ninguna fila no aparecen.
 *
 * Dentro del grupo manda `principal`, después la antigüedad y por último el id.
 * El id es el desempate que hace determinístico el orden cuando dos filas
 * entraron en el mismo milisegundo (una fusión inserta varias de una vez).
 */
export function agruparIdentificadores(
  identificadores: readonly LeadIdentificador[],
): GrupoIdentificadores[] {
  return IDENTIFICADOR_TIPO.map((tipo) => ({
    tipo,
    label: IDENTIFICADOR_LABEL[tipo],
    items: identificadores
      .filter((i) => i.tipo === tipo)
      .sort((a, b) => {
        if (a.principal !== b.principal) return a.principal ? -1 : 1;
        const porFecha = a.created_at.getTime() - b.created_at.getTime();
        return porFecha !== 0 ? porFecha : a.id.localeCompare(b.id);
      }),
  })).filter((g) => g.items.length > 0);
}
