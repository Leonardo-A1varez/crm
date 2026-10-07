import { plegar } from "@/lib/ui/busqueda-hilo";
import {
  analizarConsulta,
  INDICE_VACIO,
  terminoAcierta,
  terminosDe,
  tokensDeFila,
  valeEn,
  type IndiceAbreviaturas,
} from "@/lib/catalogo/abreviaturas";
import { plegarCodigo } from "@/lib/catalogo/normalizar-codigo";
import { plegarTexto } from "@/lib/catalogo/plegar-texto";

/**
 * Cuánto se parece un producto a lo que preguntó el cliente.
 *
 * **Este módulo es el espejo TypeScript de `public.buscar_productos`.** Uno
 * corre en Postgres contra el catálogo entero y el otro en memoria — en los
 * tests y en el repo in-memory. Si divergen, la suite queda en verde y el
 * agente ordena distinto contra la base real, que es la peor forma de fallar:
 * en silencio. Cualquier cambio de peso o de prioridad va en los dos, o en
 * ninguno.
 *
 * Vivía dentro de `catalog-matcher.service.ts`. Se mudó acá para que el repo
 * in-memory pueda usar la misma regla sin copiarla: tres copias de la misma
 * fórmula era garantía de que dos se desincronizaran.
 */

/**
 * Palabras que no dicen nada sobre el repuesto y que aparecerían en todo.
 *
 * Sin esta lista, "radiador **del** aveo" haría que `del` puntúe contra medio
 * catálogo y el orden dejaría de significar algo. Misma lista que la del `not
 * in (...)` de `buscar_productos`.
 */
const VACIAS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "para",
  "con",
  "y",
  "o",
  "mi",
  "me",
  "por",
  "que",
  "tiene",
  "tienen",
  "tenes",
  "tienes",
  "hay",
  "busco",
  "necesito",
  "quiero",
  "precio",
  "cuanto",
  "cuesta",
]);

/**
 * Cuánto vale que una palabra aparezca en cada columna.
 *
 * `categoriaExacta` va arriba del nombre a propósito: acertar la categoría
 * entera es la señal más fuerte de que es **ese** repuesto y no uno que lo
 * menciona de paso — quien pide "radiador" quiere un `RADIADOR` y no una
 * `MANG RADIADOR`, que es la manguera.
 */
const PESO = {
  codigo: 10,
  categoriaExacta: 9,
  nombre: 8,
  categoria: 6,
  descripcion: 3,
} as const;

/**
 * Cuánto vale acertar el código, según cuál de los tres sea.
 *
 * El de fábrica manda porque es el que el cliente tiene grabado en la pieza
 * vieja. El interno lo usa la casa. Los alternos son casi todos de proveedor
 * y no le dicen nada al cliente — pero hay 343 filas del catálogo real donde
 * el número de fábrica aparece SOLO ahí, así que machean igual, más abajo.
 */
const PESO_CODIGO = {
  fabrica: 1000,
  interno: 900,
  alterno: 700,
} as const;

/*
 * El filtro por vehículo (marca, modelo, año, cilindrada) vive en
 * `./compatibilidad`, que espeja `buscar_productos` y `resolver_modelos`. Una
 * `compatibilidad` vacía sigue significando "no sabemos", no "no sirve".
 */

/** Lo mínimo que hace falta saber de un producto para puntuarlo. */
export interface ProductoPuntuable {
  readonly codigo_interno: string;
  readonly codigo_fabrica: string | null;
  readonly otros_codigos: readonly string[];
  readonly nombre: string;
  readonly categoria: string | null;
  readonly descripcion: string | null;
}

/**
 * Las palabras útiles de lo que escribió el cliente, sin tildes ni relleno.
 *
 * Se descartan las de un solo caracter: no discriminan nada contra 21.009
 * filas y solo agregan ruido al puntaje.
 */
export function palabrasDe(q: string): string[] {
  return plegar(q)
    .split(/[^0-9a-z/.\-*]+/i)
    .filter((t) => t.length > 1 && !VACIAS.has(t));
}

/** El texto donde se cuenta cuántas palabras acertó: espeja la columna generada `busqueda`. */
export function blobDeBusqueda(p: ProductoPuntuable): string {
  return plegar(
    [
      p.codigo_interno,
      p.codigo_fabrica ?? "",
      p.otros_codigos.join(" "),
      p.nombre,
      p.categoria ?? "",
      p.descripcion ?? "",
    ].join(" "),
  );
}

/** El componente por código: 0 si la consulta no es ninguno de los tres. */
export function puntajeDeCodigo(p: ProductoPuntuable, consulta: string): number {
  const cod = plegarCodigo(consulta);
  if (cod === "") return 0;
  if (plegarCodigo(p.codigo_fabrica ?? "") === cod) return PESO_CODIGO.fabrica;
  if (plegarCodigo(p.codigo_interno) === cod) return PESO_CODIGO.interno;
  if (p.otros_codigos.some((o) => plegarCodigo(o) === cod)) return PESO_CODIGO.alterno;
  return 0;
}

/**
 * El puntaje total. 0 significa que el producto no entra en el resultado.
 *
 * Se compone de dos partes independientes, igual que en SQL: el acierto de
 * código —que es binario y pesado— más el puntaje por palabra, duplicado
 * cuando el producto acierta TODAS las palabras de la consulta. Un producto
 * puede sumar las dos: quien dicta un código que además aparece en el nombre
 * queda arriba de quien solo machea el código.
 *
 * Las palabras que son una posición («delanteros», «izquierdo») o un atributo no
 * puntúan ni cuentan para "todas": son filtros (ver `nivelDeLado`). Y una palabra
 * larga también acierta por la abreviatura del catálogo a la que se pliega o por
 * un prefijo suyo (`amortiguadores` ~ `AMORTIG`).
 */
export function puntaje(
  p: ProductoPuntuable,
  consulta: string,
  indice: IndiceAbreviaturas = INDICE_VACIO,
): number {
  const exacto = puntajeDeCodigo(p, consulta);

  const palabras = analizarConsulta(consulta, indice).requeridas;
  if (palabras.length === 0) return exacto;

  const cod = plegar(p.codigo_interno);
  const nom = plegar(p.nombre);
  const cat = plegar(p.categoria ?? "");
  const desc = plegar(p.descripcion ?? "");
  const blob = blobDeBusqueda(p);
  const f = tokensDeFila(p);
  const catPlegada = plegarTexto(p.categoria ?? "");

  let suma = 0;
  for (const w of palabras) {
    let peso = 0;
    if (cod.includes(w.palabra)) peso = PESO.codigo;
    else if (cat === w.palabra) peso = PESO.categoriaExacta;
    else if (nom.includes(w.palabra)) peso = PESO.nombre;
    else if (cat.includes(w.palabra)) peso = PESO.categoria;
    else if (desc.includes(w.palabra)) peso = PESO.descripcion;

    // Lo mismo contra las abreviaturas y prefijos: se queda con lo mejor.
    for (const t of terminosDe(w)) {
      let v = 0;
      if (valeEn(t.ambito, "categoria") && catPlegada === t.token) v = PESO.categoriaExacta;
      else if (valeEn(t.ambito, "nombre") && f.nombre.includes(t.token)) v = PESO.nombre;
      else if (valeEn(t.ambito, "categoria") && f.categoria.includes(t.token)) v = PESO.categoria;
      if (v > peso) peso = v;
    }
    suma += peso;
  }

  // `aciertos` se cuenta sobre el blob entero y no sobre las columnas
  // puntuadas: es lo que hace `buscar_productos` con la columna `busqueda`.
  const aciertos = palabras.filter((w) => blob.includes(w.palabra) || terminoAcierta(w, f)).length;
  const bonificada = aciertos === palabras.length ? suma * 2 : suma;

  return exacto + bonificada;
}
