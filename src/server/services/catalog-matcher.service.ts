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
import {
  abreviaturaActiva,
  esRuido,
  indexarAbreviaturas,
  INDICE_VACIO,
  ladosDeFila,
  type IndiceAbreviaturas,
} from "@/lib/catalogo/abreviaturas";
import {
  categoriaDichaTalCual,
  filtrarPorCategoria,
  piezaPedida,
  type ConsultaDePieza,
} from "@/lib/catalogo/categoria";
import {
  encabezadoConPieza,
  encabezadoCotizacion,
  piezaDeLaConsulta,
  textoCotizacion,
  textoRelacionadas,
} from "@/lib/catalogo/formato-cotizacion";
import { indexarMarcas, resolverOrigen, type MarcaCatalogo } from "@/lib/catalogo/procedencia";
import { avisoSobremedida } from "@/lib/catalogo/sobremedida";
import type { Logger } from "@/lib/observability/logger";
import type { CatalogoAbreviaturasRepository } from "@/server/repositories/catalogo-abreviaturas.repo";
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

/** Con la cotización ya escrita, lo único que le queda al modelo es copiarla. */
const INSTRUCCION_COPIAR_COTIZACION =
  "Responde copiando `cotizacion_texto` tal cual, sin agregar nada.";

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
    private readonly abreviaturas?: CatalogoAbreviaturasRepository,
  ) {}

  /**
   * Las abreviaturas del inventario. Si no se pueden leer, el agente sigue cotizando:
   * sin la tabla la búsqueda cae al prefijo y el encabezado a lo que pidió el cliente.
   */
  private async leerAbreviaturas(): Promise<IndiceAbreviaturas> {
    if (!this.abreviaturas) return INDICE_VACIO;
    try {
      return indexarAbreviaturas(
        (await this.abreviaturas.listarActivas()).filter(abreviaturaActiva),
      );
    } catch (err) {
      this.logger?.warn("catalog-matcher: no se pudieron leer las abreviaturas", {
        error: err instanceof Error ? err.message : "desconocido",
      });
      return INDICE_VACIO;
    }
  }

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

    const [hits, marcas, indice] = await Promise.all([
      this.productos.search({
        q: input.query,
        marca: textoUtil(input.marca),
        modelo: textoUtil(input.modelo),
        anio,
        cilindrada,
        tope: TOPE_PARA_EL_AGENTE,
      }),
      this.leerMarcas(),
      this.leerAbreviaturas(),
    ]);

    return armarSalida(
      hits,
      { anio, cilindrada },
      { query: input.query, marca: textoUtil(input.marca), modelo: textoUtil(input.modelo) },
      marcas,
      indice,
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
  consultaDada?: ConsultaDePieza,
  marcas: readonly MarcaCatalogo[] = [],
  abreviaturas: IndiceAbreviaturas = INDICE_VACIO,
): BuscarRepuestoOutput {
  const indice = indexarMarcas(marcas);
  // La consulta con las abreviaturas del inventario: «amortiguadores delanteros» se
  // reconoce en `AMORTIG DELT`.
  const consulta: ConsultaDePieza | undefined = consultaDada
    ? { ...consultaDada, indice: abreviaturas }
    : undefined;
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
    const lados = ladosDeFila(h, abreviaturas).filter((l) => l === "izquierdo" || l === "derecho");
    const lado = lados.length === 1 ? (lados[0] as "izquierdo" | "derecho") : undefined;
    const base: BuscarRepuestoMatch = {
      id: h.id,
      codigo_interno: h.codigo_interno,
      nombre: h.nombre,
      stock: h.stock,
      ...(pieza !== null ? { pieza } : {}),
      ...(lado !== undefined ? { lado } : {}),
    };
    if (!hayQuePreguntar) {
      return {
        ...base,
        // Sin existencia no se cotiza: ni el precio asoma.
        ...(h.stock > 0 ? { precio: h.precio } : { disponible: false as const }),
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

  // Existencia: lo que no hay no se cotiza. Si no hay NADA, la respuesta es «no disponible».
  const conExistencia = matches.filter((m) => m.disponible === undefined).length;
  const sinExistencia = !hayQuePreguntar && matches.length > 0 && conExistencia === 0;
  const algunoSinExistencia = !hayQuePreguntar && matches.some((m) => m.disponible === false);
  const avisoExistencia = sinExistencia
    ? "Ninguna de estas piezas está disponible hoy (existencia 0): responde que no está disponible, sin precio ni estimado de llegada, y ofrece consultar con un vendedor."
    : algunoSinExistencia
      ? "Las piezas con `disponible: false` no están disponibles hoy (existencia 0): di que no está disponible, sin precio ni estimado. Cotiza solo las demás."
      : null;
  const aviso = [avisoSobremedida(visibles), avisoExistencia].filter((a) => a).join(" ") || null;

  // Dos lados de la misma pieza (los amortiguadores LH y RH): una línea por lado, sin preguntar.
  const ladosVisibles = new Set(matches.map((m) => m.lado).filter((l) => l !== undefined));
  if (!hayQuePreguntar && !sinExistencia && ladosVisibles.size > 1) {
    const base = diferencias ?? construirDiferencias([], {});
    diferencias = {
      ...base,
      instruccion: [
        base.instruccion,
        "Los candidatos son de lados distintos: pon una línea por candidato con su `lado` " +
          "(«Izquierdo $precio», «Derecho $precio»), sin preguntar el lado.",
      ]
        .filter((t) => t !== "")
        .join(" "),
    };
  }

  // La cotización ya escrita (encabezado y cierre, de usted): el modelo solo la copia.
  // Solo con precios a la vista y una única pieza; con algo por preguntar no hay nada que cotizar.
  const piezasVisibles = [...new Set(matches.map((m) => m.pieza ?? ""))];
  const piezaUnica = piezasVisibles.length === 1 ? piezasVisibles[0] : undefined;
  const vehiculoDeCotizacion = {
    marca: consulta?.marca,
    modelo: consulta?.modelo,
    anio: dado.anio,
    cilindrada: dado.cilindrada,
  };
  const encabezado =
    !hayQuePreguntar && !sinExistencia && matches.length > 0 && piezaUnica
      ? (encabezadoDeLaConsulta(visibles[0], consulta, abreviaturas, vehiculoDeCotizacion) ??
        encabezadoCotizacion(piezaUnica, vehiculoDeCotizacion))
      : undefined;
  const relacionadasTexto =
    !hayQuePreguntar && !sinExistencia && relacionadas.length > 0
      ? textoRelacionadas(relacionadas, consulta)
      : null;

  // OBSERVACION (crm-dev 2026-10-07 21:36 UTC): con los datos sueltos el modelo barato
  // escribió «Izquierdo $89,55» y perdió la marca y la procedencia. CAUSA RAIZ: la línea
  // de cada opción la componía él. FIX: la herramienta entrega la cotización completa y
  // la instrucción es copiarla.
  const opcionesConPrecio = matches.flatMap((m) =>
    m.precio === undefined || m.precio === null
      ? []
      : [{ marca: m.marca, procedencia: m.procedencia, lado: m.lado, precio: m.precio }],
  );
  const cotizacionTexto =
    encabezado && opcionesConPrecio.length > 0
      ? textoCotizacion(encabezado, opcionesConPrecio, relacionadasTexto)
      : undefined;
  if (cotizacionTexto && diferencias) {
    diferencias = { ...diferencias, instruccion: INSTRUCCION_COPIAR_COTIZACION };
  }

  // El aviso va primero a propósito: es lo que el modelo tiene que leer antes
  // de mirar precios.
  return {
    ...(aviso ? { aviso } : {}),
    ...(sinExistencia ? { sin_existencia: true as const } : {}),
    matches,
    count: matches.length,
    ...(diferencias ? { diferencias } : {}),
    ...(!hayQuePreguntar && !sinExistencia && relacionadas.length > 0 ? { relacionadas } : {}),
    ...(cotizacionTexto ? { cotizacion_texto: cotizacionTexto } : {}),
    ...(encabezado ? { encabezado } : {}),
    ...(relacionadasTexto ? { relacionadas_texto: relacionadasTexto } : {}),
  };
}

/**
 * El encabezado a partir de lo que pidió el cliente, cuando el grupo del ERP no sirve para
 * escribirlo: un grupo basura (`REPUESTO EMG`) o una abreviatura que el cliente no diría
 * (`AMORTIG DELT`). `null` si el grupo se entiende tal cual (el caso de siempre: se arma
 * del grupo) o si no queda nada de la consulta.
 */
function encabezadoDeLaConsulta(
  primero: ProductoSearchHit | undefined,
  consulta: ConsultaDePieza | undefined,
  abreviaturas: IndiceAbreviaturas,
  vehiculo: {
    marca?: string | undefined;
    modelo?: string | undefined;
    anio?: number | undefined;
    cilindrada?: string | undefined;
  },
): string | null {
  if (!primero || !consulta) return null;
  if (categoriaDichaTalCual(primero.categoria, consulta) && !esRuido(primero, abreviaturas)) {
    return null;
  }
  const pieza = piezaDeLaConsulta(consulta.query, vehiculo);
  return pieza === null ? null : encabezadoConPieza(pieza, vehiculo);
}
