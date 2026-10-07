import {
  COLUMNAS_LISTA,
  DEFINICIONES_LISTA,
  ORDEN_POR_DEFECTO,
  valorDeColumna,
  type CampoOrden,
  type ColumnaLista,
  type DireccionOrden,
  type NivelOrden,
} from "@/lib/catalogo/columnas-productos";
import { normalizarValor } from "@/lib/catalogo/normalizar-valor";
import { plegarTexto } from "@/lib/catalogo/plegar-texto";
import {
  evaluarCompatibilidad,
  resolverModelos,
  type ElementoCompatibilidad,
  type ModeloCatalogo,
} from "@/lib/catalogo/compatibilidad";
import { blobDeBusqueda, puntaje, puntajeDeCodigo } from "@/lib/catalogo/puntaje";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  LOTE_TAMANO,
  type OpcionesFaceta,
  type ProductosFiltros,
} from "@/lib/validation/productos-filtros.schema";
import type { CompatibilidadEntry, Producto, UUID } from "@/types/entities";
import type { Faceta, LoteProductos, ProductoFila } from "@/types/productos";
import type { Insert, Update } from "./_types";

// `codigo_fabrica` y `otros_codigos` van opcionales a propósito: en la DB son
// nullable y `default '{}'`. Dejarlos requeridos obligaría a tocar todos los
// llamadores que ya existen —el alta manual, el import CSV, los tests— para
// que escriban un dato que todavía nadie tiene: el import que los llena es un
// paso posterior.
//
// Lo del ERP (los cuatro precios, `codigo_difiere`, `erp_actualizado_at`) también
// es opcional: solo lo escribe la carga del ERP (`erp_sync_cargar`), nunca el alta
// manual ni el import CSV. `compatibilidad_pendiente` la decide la base (trigger).
type CamposErp =
  | "precio_matriz"
  | "precio_magdalena"
  | "precio_koreanos"
  | "precio_sas_repuestos"
  | "codigo_difiere"
  | "erp_actualizado_at";

export type ProductoInsert = Omit<
  Insert<Producto, "id" | "created_at" | "updated_at">,
  "codigo_fabrica" | "otros_codigos" | CamposErp | "compatibilidad_pendiente"
> & {
  codigo_fabrica?: string | null;
  otros_codigos?: string[];
} & Partial<Pick<Producto, CamposErp>>;

// Los campos del ERP no se editan desde el CRM: los pisa la próxima carga.
export type ProductoUpdate = Update<
  Producto,
  "id" | "created_at" | "updated_at" | "codigo_interno" | CamposErp
>;

/** Lo que se le pregunta al catálogo. Espeja los parámetros de `buscar_productos`. */
export interface ProductoSearchInput {
  /** Texto libre del cliente. Puede ser un código dictado o una frase. */
  q: string;
  marca?: string;
  modelo?: string;
  anio?: number;
  /** En litros, ya normalizada ("1.6"). Una compatibilidad sin cilindrada sirve para cualquiera. */
  cilindrada?: string;
  /** Tope de filas. La DB lo recorta a 50 como máximo. */
  tope?: number;
}

/** Una fila del resultado, ya puntuada y ordenada. */
export interface ProductoSearchHit {
  id: UUID;
  codigo_interno: string;
  codigo_fabrica: string | null;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  /** `null` = a consultar. */
  precio: number | null;
  stock: number;
  puntaje: number;
  /**
   * Qué tan bien confirma el vehículo pedido (de 7 a -2, ver
   * `evaluarCompatibilidad`); 0 si no se pidió ninguno. La búsqueda ordena por esto
   * antes que por `puntaje`.
   */
  nivel_vehiculo: number;
  /**
   * Los elementos de `compatibilidad` que justifican el match para el vehículo
   * pedido (todos si no se pidió ninguno). Vacío si el producto no tiene
   * compatibilidad cargada: "no sabemos", no "no sirve".
   */
  compatibilidad: ElementoCompatibilidad[];
}

// Item de upsert masivo con scope CSV import: solo las columnas del archivo.
// Update NO toca compatibilidad / imagen_url / activo (se preservan); insert
// usa defaults (compatibilidad [], imagen_url null, activo true).
export type ProductoBulkUpsertItem = Omit<
  ProductoInsert,
  "compatibilidad" | "imagen_url" | "activo"
>;

export interface ProductoListFilter {
  q?: string;
  activo?: boolean;
  limit?: number;
  offset?: number;
}

export interface ProductsRepository {
  create(input: ProductoInsert): Promise<Producto>;
  findById(id: UUID): Promise<Producto | null>;
  findByCodigoInterno(codigo: string): Promise<Producto | null>;
  update(id: UUID, patch: ProductoUpdate): Promise<Producto>;
  list(filter?: ProductoListFilter): Promise<Producto[]>;
  /**
   * Búsqueda puntuada del catálogo: por número de fábrica, código interno,
   * códigos alternos y texto.
   *
   * Existe porque `list()` NO sirve para esto. Un `list` sin `limit` no aplica
   * ningún `range`, así que manda el tope del servidor PostgREST —1.000 filas—
   * y el filtrado quedaba del otro lado de la red, en memoria. Con 21.009
   * productos eso significa que el agente ve 1.000 ordenados alfabéticamente y
   * contesta "no tenemos" sin un solo error en ningún log. Ya pasó una vez.
   */
  search(input: ProductoSearchInput): Promise<ProductoSearchHit[]>;
  /**
   * Un lote de la carga completa: las filas `[(lote-1)·LOTE_TAMANO, lote·LOTE_TAMANO)`
   * del conjunto filtrado y ordenado, con el total REAL del filtro.
   *
   * Recibe filtros ya validados (`parseProductosFiltros`). El orden son los niveles
   * elegidos (o el de por defecto) más un desempate por código —único—, así que es
   * total y dos lotes nunca se pisan ni se saltean filas. Un lote fuera de rango
   * devuelve `filas: []` con el total correcto.
   */
  listarLote(filtros: ProductosFiltros, lote: number): Promise<LoteProductos>;
  /**
   * La lista de valores estilo Excel de UNA columna, con su cantidad. Se calcula con
   * todos los filtros activos EXCEPTO los de su propia columna (incluir y excluir),
   * así que cada lista muestra solo lo que dejan pasar los OTROS filtros.
   *
   * `opciones.q` busca dentro de la lista (plegado, "contiene"; en el código, por
   * igualdad) ANTES del límite, así cualquier valor es encontrable aunque quede fuera
   * del top. `limite` recorta la lista; los valores seleccionados que coinciden con
   * la búsqueda siempre entran, con cantidad 0 si no tienen filas. `distintos` cuenta
   * solo valores con filas (cantidad > 0).
   */
  faceta(filtros: ProductosFiltros, opciones: OpcionesFaceta): Promise<Faceta>;
  // Upsert masivo por codigo_interno (import CSV). Throws si hay codigo_interno
  // duplicado en el input. Preserva orden del input en el array de retorno.
  bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]>;
  /**
   * Hasta `limite` productos cuyo `nombre` cambió y cuya compatibilidad hay que
   * recalcular (`compatibilidad_pendiente`). Solo `id` y `nombre`: es todo lo que
   * necesita el traductor.
   */
  listarCompatibilidadPendiente(limite: number): Promise<ProductoPendienteDeCompatibilidad[]>;
  /**
   * Guarda la compatibilidad recalculada y baja la marca de pendiente, SOLO si el
   * `nombre` sigue siendo el que se tradujo. Si la sincronización lo cambió
   * mientras tanto devuelve `false` y el producto queda pendiente para la próxima
   * pasada: guardar igual dejaría una compatibilidad de un nombre viejo marcada
   * como al día.
   */
  guardarCompatibilidad(
    id: UUID,
    nombreTraducido: string,
    compatibilidad: CompatibilidadEntry[],
  ): Promise<boolean>;
}

export interface ProductoPendienteDeCompatibilidad {
  id: UUID;
  nombre: string;
}

// Deep clone defensivo de compatibilidad (jsonb array) para evitar mutación cruzada de refs.
function cloneProducto(p: Producto): Producto {
  return {
    ...p,
    compatibilidad: p.compatibilidad.map((c) => ({ ...c })),
    otros_codigos: [...p.otros_codigos],
  };
}

export class InMemoryProductsRepository implements ProductsRepository {
  private readonly store = new Map<UUID, Producto>();
  private readonly modelos: readonly ModeloCatalogo[];

  /**
   * `modelos` es el espejo en memoria de `catalogo_modelos`: sin él, "Accent" no
   * se resuelve a la sigla `ACC` y la búsqueda cae al texto, igual que en la base
   * con el diccionario vacío.
   */
  constructor(opciones: { modelos?: readonly ModeloCatalogo[] } = {}) {
    this.modelos = opciones.modelos ?? [];
  }

  async create(input: ProductoInsert): Promise<Producto> {
    const existing = await this.findByCodigoInterno(input.codigo_interno);
    if (existing) {
      throw new ConflictError(
        `codigo_interno duplicado: ${input.codigo_interno}`,
        "duplicate_codigo_interno",
      );
    }
    const now = new Date();
    const prod: Producto = {
      ...input,
      compatibilidad: input.compatibilidad.map((c) => ({ ...c })),
      codigo_fabrica: input.codigo_fabrica ?? null,
      otros_codigos: [...(input.otros_codigos ?? [])],
      precio_matriz: input.precio_matriz ?? null,
      precio_magdalena: input.precio_magdalena ?? null,
      precio_koreanos: input.precio_koreanos ?? null,
      precio_sas_repuestos: input.precio_sas_repuestos ?? null,
      codigo_difiere: input.codigo_difiere ?? false,
      erp_actualizado_at: input.erp_actualizado_at ?? null,
      // Espejo del trigger `productos_compatibilidad_pendiente`: todo alta queda pendiente.
      compatibilidad_pendiente: true,
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    };
    this.store.set(prod.id, prod);
    return cloneProducto(prod);
  }

  async findById(id: UUID): Promise<Producto | null> {
    const p = this.store.get(id);
    return p ? cloneProducto(p) : null;
  }

  async findByCodigoInterno(codigo: string): Promise<Producto | null> {
    for (const p of this.store.values()) {
      if (p.codigo_interno === codigo) return cloneProducto(p);
    }
    return null;
  }

  async update(id: UUID, patch: ProductoUpdate): Promise<Producto> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`producto no encontrado: ${id}`, "producto", id);
    const next: Producto = {
      ...current,
      ...patch,
      compatibilidad: patch.compatibilidad
        ? patch.compatibilidad.map((c) => ({ ...c }))
        : current.compatibilidad.map((c) => ({ ...c })),
      otros_codigos: patch.otros_codigos ? [...patch.otros_codigos] : [...current.otros_codigos],
      // Espejo del trigger: un nombre distinto la prende, gane lo que gane el patch.
      compatibilidad_pendiente:
        patch.nombre !== undefined && patch.nombre !== current.nombre
          ? true
          : (patch.compatibilidad_pendiente ?? current.compatibilidad_pendiente),
      id: current.id,
      codigo_interno: current.codigo_interno,
      created_at: current.created_at,
      updated_at: new Date(),
    };
    this.store.set(id, next);
    return cloneProducto(next);
  }

  async list(filter: ProductoListFilter = {}): Promise<Producto[]> {
    let rows = Array.from(this.store.values());
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.codigo_interno.toLowerCase().includes(q),
      );
    }
    if (filter.activo !== undefined) {
      rows = rows.filter((p) => p.activo === filter.activo);
    }
    // Orden estable nombre + codigo_interno (paridad con ORDER BY de Supabase impl).
    rows.sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre) || a.codigo_interno.localeCompare(b.codigo_interno),
    );
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map(cloneProducto);
  }

  async search(input: ProductoSearchInput): Promise<ProductoSearchHit[]> {
    const tope = Math.max(1, Math.min(input.tope ?? 20, 50));
    const hits: ProductoSearchHit[] = [];
    // Quien dicta un código exacto lo encuentra primero, sea cual sea su vehículo.
    const porCodigo = new Map<UUID, boolean>();
    const resueltos = resolverModelos(this.modelos, input.marca, input.modelo);

    for (const p of this.store.values()) {
      if (!p.activo) continue;
      const compat = evaluarCompatibilidad(p.compatibilidad, input, resueltos, blobDeBusqueda(p));
      if (compat === null) continue;
      const score = puntaje(p, input.q);
      if (score <= 0) continue;
      hits.push({
        id: p.id,
        codigo_interno: p.codigo_interno,
        codigo_fabrica: p.codigo_fabrica,
        nombre: p.nombre,
        categoria: p.categoria,
        descripcion: p.descripcion,
        precio: p.precio,
        stock: p.stock,
        puntaje: score,
        nivel_vehiculo: compat.nivel,
        compatibilidad: compat.elementos.map((e) => ({ ...e })),
      });
      porCodigo.set(p.id, puntajeDeCodigo(p, input.q) > 0);
    }

    // Mismo orden que el `order by` de `buscar_productos`: primero el código
    // exacto, después el nivel de vehículo, el puntaje, el stock —lo que se puede
    // despachar hoy va arriba— y al final el nombre para que el orden sea estable.
    hits.sort(
      (a, b) =>
        Number(porCodigo.get(b.id)) - Number(porCodigo.get(a.id)) ||
        b.nivel_vehiculo - a.nivel_vehiculo ||
        b.puntaje - a.puntaje ||
        b.stock - a.stock ||
        a.nombre.localeCompare(b.nombre),
    );
    return hits.slice(0, tope);
  }

  async listarLote(filtros: ProductosFiltros, lote: number): Promise<LoteProductos> {
    const filas = [...this.store.values()]
      .filter((p) => cumpleFiltros(p, filtros, null))
      .sort(comparadorDe(filtros.orden));
    const desde = (lote - 1) * LOTE_TAMANO;
    return {
      filas: filas.slice(desde, desde + LOTE_TAMANO).map(aFila),
      total: filas.length,
      lote,
      desde,
    };
  }

  async faceta(filtros: ProductosFiltros, opciones: OpcionesFaceta): Promise<Faceta> {
    const cuentas = new Map<string, number>();
    for (const p of this.store.values()) {
      if (!cumpleFiltros(p, filtros, opciones.columna)) continue;
      const v = valorDeColumna(p, opciones.columna);
      cuentas.set(v, (cuentas.get(v) ?? 0) + 1);
    }
    const d = DEFINICIONES_LISTA[opciones.columna];
    return armarFaceta(cuentas, [...filtros[d.incluir], ...filtros[d.excluir]], opciones);
  }

  async bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]> {
    if (items.length === 0) return [];

    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.codigo_interno)) {
        throw new ValidationError(`codigo_interno duplicado en input bulk: ${item.codigo_interno}`);
      }
      seen.add(item.codigo_interno);
    }

    const result: Producto[] = [];
    for (const item of items) {
      const existing = await this.findByCodigoInterno(item.codigo_interno);
      if (existing) {
        const { codigo_interno: _ignore, ...rest } = item;
        const updated = await this.update(existing.id, rest);
        result.push(updated);
      } else {
        const created = await this.create({
          ...item,
          compatibilidad: [],
          imagen_url: null,
          activo: true,
        });
        result.push(created);
      }
    }
    return result;
  }

  async listarCompatibilidadPendiente(
    limite: number,
  ): Promise<ProductoPendienteDeCompatibilidad[]> {
    return Array.from(this.store.values())
      .filter((p) => p.compatibilidad_pendiente === true)
      .sort((a, b) => a.codigo_interno.localeCompare(b.codigo_interno))
      .slice(0, Math.max(0, limite))
      .map((p) => ({ id: p.id, nombre: p.nombre }));
  }

  async guardarCompatibilidad(
    id: UUID,
    nombreTraducido: string,
    compatibilidad: CompatibilidadEntry[],
  ): Promise<boolean> {
    const current = this.store.get(id);
    if (!current || current.nombre !== nombreTraducido) return false;
    this.store.set(id, {
      ...current,
      compatibilidad: compatibilidad.map((c) => ({ ...c })),
      compatibilidad_pendiente: false,
    });
    return true;
  }
}

/** Espejo de `plegar_texto(campo) like %buscado%`: sin mayúsculas ni tildes, subcadena. */
function contieneTexto(campo: string, buscado: string): boolean {
  return plegarTexto(campo).includes(plegarTexto(buscado));
}

/**
 * Espejo del buscador general `q` de `productos_filtrados`: "contiene" plegado en
 * el código interno, el de fábrica, los alternos (unidos con espacio, como
 * `codigos_a_texto`), el nombre y la marca. La marca es solo la `descripcion`
 * real: la etiqueta SIN_MARCA es un valor de lista, no texto buscable. La
 * categoría no entra: se filtra con su propia columna.
 */
function coincideBuscador(p: Producto, q: string): boolean {
  const campos = [
    p.codigo_interno,
    p.codigo_fabrica ?? "",
    p.otros_codigos.join(" "),
    p.nombre,
    normalizarValor(p.descripcion ?? ""),
  ];
  return campos.some((c) => contieneTexto(c, q));
}

/**
 * El predicado único del listado y de las listas de valores. `excluir` salta los
 * filtros de la columna cuya lista se está calculando.
 */
function cumpleFiltros(p: Producto, f: ProductosFiltros, excluir: ColumnaLista | null): boolean {
  if (f.q !== undefined && !coincideBuscador(p, f.q)) return false;
  for (const columna of COLUMNAS_LISTA) {
    if (columna === excluir) continue;
    const d = DEFINICIONES_LISTA[columna];
    const incluir = f[d.incluir];
    const quitar = f[d.excluir];
    if (incluir.length === 0 && quitar.length === 0) continue;
    const v = valorDeColumna(p, columna);
    if (incluir.length > 0 && !incluir.includes(v)) return false;
    if (quitar.includes(v)) return false;
  }
  // Como en SQL: con un rango de precio pedido, "a consultar" (null) no entra.
  if (f.precioMin !== undefined && (p.precio === null || p.precio < f.precioMin)) return false;
  if (f.precioMax !== undefined && (p.precio === null || p.precio > f.precioMax)) return false;
  if (f.stockMin !== undefined && p.stock < f.stockMin) return false;
  if (f.stockMax !== undefined && p.stock > f.stockMax) return false;
  if (f.conStock === true && p.stock <= 0) return false;
  if (f.conStock === false && p.stock > 0) return false;
  if (f.estado === "activo" && !p.activo) return false;
  if (f.estado === "inactivo" && p.activo) return false;
  return true;
}

function aFila(p: Producto): ProductoFila {
  return {
    id: p.id,
    codigo_interno: p.codigo_interno,
    codigo_fabrica: p.codigo_fabrica,
    otros_codigos: [...p.otros_codigos],
    sku_proveedor: p.sku_proveedor,
    nombre: p.nombre,
    descripcion: p.descripcion,
    categoria: p.categoria,
    precio: p.precio,
    precio_matriz: p.precio_matriz,
    precio_magdalena: p.precio_magdalena,
    precio_koreanos: p.precio_koreanos,
    precio_sas_repuestos: p.precio_sas_repuestos,
    codigo_difiere: p.codigo_difiere,
    erp_actualizado_at: p.erp_actualizado_at ? p.erp_actualizado_at.toISOString() : null,
    stock: p.stock,
    activo: p.activo,
  };
}

// --- Orden -----------------------------------------------------------------

const CODIGO_NUMERICO = /^[0-9]{1,18}$/;

/** El código como número, si es todo dígitos: `1, 2, 10` y no `1, 10, 2`. Espejo de `codigo_interno_orden`. */
function codigoNumerico(codigo: string): bigint | null {
  return CODIGO_NUMERICO.test(codigo) ? BigInt(codigo) : null;
}

/** Texto recortado, o `null` si queda vacío (los vacíos van al final, como `nulls last`). */
function textoONulo(v: string | null): string | null {
  const t = normalizarValor(v ?? "");
  return t === "" ? null : t;
}

type ClaveOrden = string | number | bigint | null;

function claveDe(p: Producto, campo: CampoOrden): ClaveOrden {
  switch (campo) {
    case "codigo":
      return codigoNumerico(p.codigo_interno);
    case "codigoFabrica":
      return textoONulo(p.codigo_fabrica);
    case "otrosCodigos":
      return textoONulo(p.otros_codigos.join(", "));
    case "categoria":
      return textoONulo(p.categoria);
    case "descripcion":
      return p.nombre;
    case "marca":
      return textoONulo(p.descripcion);
    case "precio":
      return p.precio;
    case "precio_matriz":
    case "precio_magdalena":
    case "precio_koreanos":
    case "precio_sas_repuestos":
      // `null` queda al final en las dos direcciones, como `nulls last` en SQL.
      return p[campo];
    case "stock":
      return p.stock;
    case "estado":
      // Ascendente = activos primero (como Activo antes que Inactivo).
      return p.activo ? 0 : 1;
  }
}

/** Compara dos claves no nulas del mismo tipo. */
function compararClaves(a: string | number | bigint, b: string | number | bigint): number {
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return a === b ? 0 : a < b ? -1 : 1;
}

/** `nulls last`: un vacío va siempre después de un valor, en las dos direcciones. */
function compararConNulosAlFinal(a: ClaveOrden, b: ClaveOrden): number | null {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return null;
}

/**
 * Espejo del `order by` de `productos_listar`: los niveles elegidos (o el de por
 * defecto), vacíos al final en las dos direcciones, y el código —único— de desempate.
 */
function comparadorDe(niveles: readonly NivelOrden[]) {
  const efectivos = niveles.length > 0 ? niveles : ORDEN_POR_DEFECTO;
  return (a: Producto, b: Producto): number => {
    for (const { campo, dir } of efectivos) {
      if (campo === "codigo") {
        const c = compararCodigos(a.codigo_interno, b.codigo_interno, dir);
        if (c !== 0) return c;
        continue;
      }
      const ka = claveDe(a, campo);
      const kb = claveDe(b, campo);
      const nulo = compararConNulosAlFinal(ka, kb);
      if (nulo !== null) {
        if (nulo !== 0) return nulo;
        continue;
      }
      const c = compararClaves(ka as string | number | bigint, kb as string | number | bigint);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return compararCodigos(a.codigo_interno, b.codigo_interno, "asc");
  };
}

/**
 * Espejo de `codigo_interno_orden {dir} nulls last, codigo_interno {dir}`: primero
 * el número (los que no son todo dígitos, al final en las dos direcciones) y, a
 * igual número, el texto en el mismo sentido.
 */
function compararCodigos(a: string, b: string, dir: DireccionOrden): number {
  const signo = dir === "desc" ? -1 : 1;
  const na = codigoNumerico(a);
  const nb = codigoNumerico(b);
  if (na !== nb) return na === null ? 1 : nb === null ? -1 : na < nb ? -signo : signo;
  return signo * a.localeCompare(b);
}

// --- Listas de valores -------------------------------------------------------

function armarFaceta(
  cuentas: Map<string, number>,
  seleccionados: string[],
  opciones: OpcionesFaceta,
): Faceta {
  // Un valor seleccionado sin filas bajo los demás filtros igual se muestra, en 0.
  for (const s of seleccionados) if (!cuentas.has(s)) cuentas.set(s, 0);
  const d = DEFINICIONES_LISTA[opciones.columna];
  // La búsqueda dentro de la lista va ANTES del límite y recorta también a los seleccionados.
  const buscado = opciones.q === undefined ? null : plegarTexto(opciones.q);
  const coincide = (valor: string) =>
    buscado === null ||
    (d.identificador
      ? valor.toLowerCase() === (opciones.q ?? "").toLowerCase()
      : plegarTexto(valor).includes(buscado));
  const numerico = (valor: string): bigint | null =>
    d.identificador ? codigoNumerico(valor) : null;
  const todos = [...cuentas.entries()]
    .filter(([valor]) => coincide(valor))
    .map(([valor, cantidad]) => ({ valor, cantidad }))
    .sort((a, b) => {
      if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
      const na = numerico(a.valor);
      const nb = numerico(b.valor);
      if (na !== null && nb !== null && na !== nb) return na < nb ? -1 : 1;
      if ((na === null) !== (nb === null)) return na === null ? 1 : -1;
      // Orden binario, no localeCompare: es el desempate de Postgres con `collate "C"`.
      return a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0;
    });
  const elegidos = new Set(seleccionados);
  const valores = todos.filter((v, i) => i < opciones.limite || elegidos.has(v.valor));
  // Los seleccionados con 0 filas se muestran pero no son valores "que existen".
  return { valores, distintos: todos.filter((v) => v.cantidad > 0).length };
}
