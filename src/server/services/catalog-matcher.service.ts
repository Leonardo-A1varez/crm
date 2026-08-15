import { plegar } from "@/lib/ui/busqueda-hilo";
import type { Producto } from "@/types/entities";
import type { ProductsRepository } from "@/server/repositories/productos.repo";
import type {
  BuscarRepuestoInput,
  BuscarRepuestoMatch,
  BuscarRepuestoOutput,
} from "@/lib/validation/ai";

export interface CatalogMatcherService {
  buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput>;
}

export class DefaultCatalogMatcherService implements CatalogMatcherService {
  constructor(private readonly productos: ProductsRepository) {}

  async buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput> {
    const all = await this.productos.list({ activo: true });

    const q = input.query.toLowerCase().trim();
    const marca = input.marca?.toLowerCase().trim();
    const modelo = input.modelo?.toLowerCase().trim();
    const anio = input.anio;

    const scored: Array<{ p: Producto; score: number }> = [];
    for (const p of all) {
      if (!matchesCompatibilidad(p, marca, modelo, anio)) continue;
      const score = relevanceScore(p, q);
      if (score > 0) scored.push({ p, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const matches: BuscarRepuestoMatch[] = scored.map(({ p }) => ({
      id: p.id,
      codigo_interno: p.codigo_interno,
      nombre: p.nombre,
      precio: p.precio,
      stock: p.stock,
    }));

    return { matches, count: matches.length };
  }
}

/**
 * Palabras que no dicen nada sobre el repuesto y que aparecerían en todo.
 *
 * Sin esta lista, "radiador **del** aveo" haría que `del` puntúe contra medio
 * catálogo y el orden dejaría de significar algo.
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
 * menciona de paso.
 */
const PESO = {
  codigo: 10,
  categoriaExacta: 9,
  nombre: 8,
  categoria: 6,
  descripcion: 3,
} as const;

/**
 * Las palabras útiles de lo que escribió el cliente, sin tildes ni relleno.
 *
 * Se descartan las de un solo caracter: no discriminan nada contra 21.544
 * filas y solo agregan ruido al puntaje.
 */
function palabrasDe(q: string): string[] {
  return plegar(q)
    .split(/[^0-9a-z/.\-*]+/i)
    .filter((t) => t.length > 1 && !VACIAS.has(t));
}

/**
 * Cuánto se parece un producto a lo que preguntaron. 0 = no entra.
 *
 * **Puntúa palabra por palabra, no la frase entera**, porque así es como
 * pregunta un cliente: "radiador del aveo" tiene el tipo de repuesto en una
 * palabra y el auto en otra, y viven en columnas distintas —`categoria` dice
 * `RADIADOR` y `nombre` dice `CH AVEO 1.6 05-`—. Buscar la frase completa
 * dentro de cada columna daba cero, que fue exactamente lo que hizo al agente
 * responder "no tenemos" con 444 radiadores de Aveo en el depósito.
 *
 * Las cuatro columnas se miran en orden de confianza: el código identifica una
 * pieza única, el nombre lleva el vehículo, la categoría el tipo de repuesto y
 * la descripción la marca del fabricante o las medidas (`MOBIS`, `KOREA`,
 * `76mm1.5*1.5*4`). Sumar por palabra hace que el que acierta el repuesto **y**
 * el auto quede arriba del que solo acierta uno.
 *
 * El código completo sigue teniendo su atajo: un taller que dicta
 * `96817344/CH` espera esa fila primero y no una lista.
 */
function relevanceScore(p: Producto, q: string): number {
  const cod = plegar(p.codigo_interno);
  const nom = plegar(p.nombre);
  const cat = plegar(p.categoria ?? "");
  const desc = plegar(p.descripcion ?? "");

  const consulta = plegar(q).trim();
  if (consulta !== "" && cod === consulta) return 1000;

  const palabras = palabrasDe(q);
  // Sin palabras útiles queda la frase cruda: mejor eso que descartar todo.
  if (palabras.length === 0) return cod.includes(consulta) || nom.includes(consulta) ? 10 : 0;

  let total = 0;
  let aciertos = 0;
  for (const palabra of palabras) {
    let mejor = 0;
    if (cod.includes(palabra)) mejor = PESO.codigo;
    else if (nom.includes(palabra)) mejor = PESO.nombre;
    // La categoría exacta pesa más que contenerla: quien pide "radiador" quiere
    // un `RADIADOR`, no una `MANG RADIADOR` —que es la manguera— ni una `TAPA
    // RADIADOR`. Sin este desempate las tres puntuaban igual y el orden lo
    // decidía el azar.
    else if (cat === palabra) mejor = PESO.categoriaExacta;
    else if (cat.includes(palabra)) mejor = PESO.categoria;
    else if (desc.includes(palabra)) mejor = PESO.descripcion;
    if (mejor > 0) {
      total += mejor;
      aciertos += 1;
    }
  }

  if (aciertos === 0) return 0;
  // Bonus por acertar todo: entre "radiador de Aveo" y "radiador de Spark",
  // el que cumple las dos palabras tiene que quedar claramente arriba.
  return aciertos === palabras.length ? total * 2 : total;
}

/**
 * Si el producto es compatible con el auto que preguntan.
 *
 * Un `compatibilidad` vacío significa **"no sabemos"**, no "no sirve". El
 * catálogo real llega de un export de inventario que no trae esa columna: el
 * vehículo va escrito adentro del nombre (`CH TAX AVEO`, `MZ ALEG`, `TY COROLLA
 * 09-`). Como `[].some()` es siempre `false`, filtrar por ahí escondía los
 * 21.544 productos apenas el agente mencionaba una marca, y respondía "no
 * tenemos" con 65 unidades en el depósito.
 *
 * Con la lista vacía se deja pasar y decide el texto: `relevanceScore` mira
 * nombre y código, que es donde está el dato. Cuando alguien cargue
 * compatibilidad de verdad, esa lista vuelve a mandar y filtra como antes.
 */
function matchesCompatibilidad(
  p: Producto,
  marca: string | undefined,
  modelo: string | undefined,
  anio: number | undefined,
): boolean {
  if (!marca && !modelo && anio === undefined) return true;
  if (p.compatibilidad.length === 0) return true;
  return p.compatibilidad.some((c) => {
    if (marca && c.marca.toLowerCase() !== marca) return false;
    if (modelo && c.modelo.toLowerCase() !== modelo) return false;
    if (anio !== undefined && !(c.anio_desde <= anio && anio <= c.anio_hasta)) return false;
    return true;
  });
}
