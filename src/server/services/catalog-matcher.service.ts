import type {
  BuscarRepuestoInput,
  BuscarRepuestoMatch,
  BuscarRepuestoOutput,
} from "@/lib/validation/ai";
import {
  construirDiferencias,
  diferenciasEntre,
  TOLERANCIA_NIVEL,
  type Diferencias,
  etiquetaDePieza,
  etiquetasDeCompatibilidad,
  normalizarCilindrada,
} from "@/lib/catalogo/compatibilidad";
import { filtrarPorCategoria, piezaPedida, type ConsultaDePieza } from "@/lib/catalogo/categoria";
import { encabezadoCotizacion, textoRelacionadas } from "@/lib/catalogo/formato-cotizacion";
import { indexarMarcas, resolverOrigen, type MarcaCatalogo } from "@/lib/catalogo/procedencia";
import { avisoSobremedida } from "@/lib/catalogo/sobremedida";
import type { Logger } from "@/lib/observability/logger";
import type { CatalogoMarcasRepository } from "@/server/repositories/catalogo-marcas.repo";
import type { ProductoSearchHit, ProductsRepository } from "@/server/repositories/productos.repo";

/**
 * La herramienta `buscar_repuesto` que usa el agente.
 *
 * Este servicio era el que puntuaba: traía el catálogo entero con
 * `productos.list({activo:true})` y ordenaba en memoria. Eso está roto de una
 * forma que no se ve — un `list` sin `limit` no aplica ningún `range`, así que
 * manda el tope del servidor PostgREST. Con 21.009 productos el agente veía
 * 1.000 ordenados alfabéticamente, de `001 CAMISAS` a `CH COR DW LAN 1C`, y
 * respondía "no tenemos" sin un solo error en ningún log.
 *
 * `buscar_productos` se escribió el 2026-08-15 justamente para eso y nunca se
 * cableó. Ahora el puntaje vive en dos lugares y solo dos: la función de
 * Postgres y su espejo `src/lib/catalogo/puntaje.ts`, que es el que usa el
 * repo in-memory. Este servicio ya no puntúa nada — traduce.
 */
export interface CatalogMatcherService {
  buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput>;
}

/**
 * Cuántas filas se le pasan al modelo.
 *
 * No es el tope de la búsqueda por gusto: es cuánto contexto vale la pena
 * gastar. Veinte candidatos alcanzan para que el agente calcule la pregunta
 * clave y cotice; mil solo queman tokens y lo confunden.
 */
const TOPE_PARA_EL_AGENTE = 20;

/** Un texto vacío o en blanco es "no lo dijo". */
const textoUtil = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

export class DefaultCatalogMatcherService implements CatalogMatcherService {
  constructor(
    private readonly productos: ProductsRepository,
    private readonly marcas?: CatalogoMarcasRepository,
    private readonly logger?: Logger,
  ) {}

  /**
   * Las marcas con su procedencia. Si no se pueden leer (la tabla todavía no está
   * en esa base, un corte) el agente sigue cotizando: sin la tabla cada pieza
   * queda con su marca y sin procedencia, que es lo único que no inventa nada.
   */
  private async leerMarcas(): Promise<readonly MarcaCatalogo[]> {
    if (!this.marcas) return [];
    try {
      return await this.marcas.listarActivas();
    } catch (err) {
      this.logger?.warn("catalog-matcher: no se pudieron leer las marcas", {
        error: err instanceof Error ? err.message : "desconocido",
      });
      return [];
    }
  }

  async buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput> {
    // Los modelos de lenguaje mandan `0` cuando no saben el año aunque el schema
    // les diga que lo omitan. El año 0 no existe: es "desconocido", y buscarlo
    // como año descartaría todo producto con rango de años cargado.
    const anio = input.anio !== undefined && input.anio > 0 ? input.anio : undefined;
    const cilindrada = normalizarCilindrada(input.cilindrada);

    const [hits, marcas] = await Promise.all([
      this.productos.search({
        q: input.query,
        marca: textoUtil(input.marca),
        modelo: textoUtil(input.modelo),
        anio,
        cilindrada,
        tope: TOPE_PARA_EL_AGENTE,
      }),
      this.leerMarcas(),
    ]);

    return armarSalida(
      hits,
      { anio, cilindrada },
      { query: input.query, marca: textoUtil(input.marca), modelo: textoUtil(input.modelo) },
      marcas,
    );
  }
}

/**
 * Lo que la herramienta le devuelve al agente a partir de los candidatos ya
 * ordenados por `buscar_productos`. Pura y exportada para que el eval del agente
 * le dé al modelo exactamente la salida de producción.
 */
export function armarSalida(
  todos: readonly ProductoSearchHit[],
  dado: { anio?: number | undefined; cilindrada?: string | undefined },
  consulta?: ConsultaDePieza,
  marcas: readonly MarcaCatalogo[] = [],
): BuscarRepuestoOutput {
  const indice = indexarMarcas(marcas);
  // La búsqueda de texto acepta cualquier palabra: `agua` trae los manguitos y
  // `bomba` la de combustible. Lo que solo roza la pieza pedida ni se ofrece ni
  // cuenta como alternativa de pieza (ver `categoria.ts`).
  const hits = consulta ? filtrarPorCategoria(todos, consulta) : todos;
  const acotado = hits.length < todos.length;

  // En qué se diferencian los mejores candidatos: lo único que el agente tiene
  // que preguntar. Lo que el cliente ya dijo (año, cilindrada) no entra.
  const dif0 = diferenciasEntre(hits, dado, indice);

  // La pieza pedida EXACTA (la categoría es lo que dijo el cliente, y el nombre no
  // la declara empaque, oring, base…): se cotiza sola y las demás piezas del
  // vehículo (polea, empaque, base) se nombran sin precio. Sin pieza exacta y con
  // piezas distintas, se pregunta cuál.
  // Solo las que confirman el vehículo tan bien como la mejor: una bomba de agua
  // de otro auto (sin compatibilidad cargada) comparte la categoría pero no se cotiza.
  const pedidas = consulta ? hits.filter((h) => piezaPedida(h, consulta)) : [];
  const mejorNivel = Math.max(...pedidas.map((h) => h.nivel_vehiculo ?? 0));
  const exactos = pedidas.filter((h) => (h.nivel_vehiculo ?? 0) >= mejorNivel - TOLERANCIA_NIVEL);
  const hayExacta = exactos.length > 0 && exactos.length < hits.length;
  const visibles = hayExacta ? exactos : hits;
  let relacionadas: string[] = [];
  let diferencias: Diferencias | null = dif0;
  if (hayExacta) {
    const delExacto = new Set(exactos.map((h) => etiquetaDePieza(h.categoria, h.nombre)));
    relacionadas = (dif0?.valores.pieza ?? []).filter((p) => !delExacto.has(p));
    diferencias = diferenciasEntre(exactos, dado, indice);
  } else if (dif0 && acotado && dif0.atributos.length > 0 && !dif0.atributos.includes("pieza")) {
    diferencias = {
      ...dif0,
      instruccion: `${dif0.instruccion} La pieza ya quedó definida por lo que pidió el cliente: no se la vuelvas a preguntar.`,
    };
  }

  // Con algo por preguntar no se expone ningún precio.
  const hayQuePreguntar = diferencias !== null && diferencias.atributos.length > 0;
  if (!hayQuePreguntar && relacionadas.length > 0) {
    diferencias = construirDiferencias(
      diferencias?.atributos ?? [],
      diferencias?.valores ?? {},
      diferencias?.procedencias ?? [],
      relacionadas,
    );
  }

  const matches: BuscarRepuestoMatch[] = visibles.map((h) => {
    const { marca, procedencia } = resolverOrigen(h.descripcion, h.codigo_fabrica, indice);
    const pieza = etiquetaDePieza(h.categoria, h.nombre);
    const base: BuscarRepuestoMatch = {
      id: h.id,
      codigo_interno: h.codigo_interno,
      nombre: h.nombre,
      stock: h.stock,
      ...(pieza !== null ? { pieza } : {}),
    };
    if (!hayQuePreguntar) {
      return {
        ...base,
        precio: h.precio,
        ...(marca !== null ? { marca } : {}),
        ...(procedencia !== null ? { procedencia } : {}),
      };
    }
    // A cada candidato, solo los atributos que lo distinguen de los otros.
    const e = etiquetasDeCompatibilidad(h.compatibilidad);
    const dif = diferencias?.atributos ?? [];
    return {
      ...base,
      ...(dif.includes("anio") && e.anio.length > 0 ? { anios: e.anio } : {}),
      ...(dif.includes("cilindrada") && e.cilindrada.length > 0
        ? { cilindradas: e.cilindrada }
        : {}),
      ...(dif.includes("combustible") && e.combustible.length > 0
        ? { combustibles: e.combustible }
        : {}),
    };
  });

  const aviso = avisoSobremedida(visibles);

  // La cotización ya escrita (encabezado y cierre, de usted): el modelo solo la copia.
  // Solo con precios a la vista y una única pieza; con algo por preguntar no hay nada que cotizar.
  const piezasVisibles = [...new Set(matches.map((m) => m.pieza ?? ""))];
  const piezaUnica = piezasVisibles.length === 1 ? piezasVisibles[0] : undefined;
  const encabezado =
    !hayQuePreguntar && matches.length > 0 && piezaUnica
      ? encabezadoCotizacion(piezaUnica, {
          marca: consulta?.marca,
          modelo: consulta?.modelo,
          anio: dado.anio,
          cilindrada: dado.cilindrada,
        })
      : undefined;
  const relacionadasTexto =
    !hayQuePreguntar && relacionadas.length > 0 ? textoRelacionadas(relacionadas, consulta) : null;

  // El aviso va primero a propósito: es lo que el modelo tiene que leer antes
  // de mirar precios.
  return {
    ...(aviso ? { aviso } : {}),
    matches,
    count: matches.length,
    ...(diferencias ? { diferencias } : {}),
    ...(!hayQuePreguntar && relacionadas.length > 0 ? { relacionadas } : {}),
    ...(encabezado ? { encabezado } : {}),
    ...(relacionadasTexto ? { relacionadas_texto: relacionadasTexto } : {}),
  };
}
