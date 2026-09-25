import { NotFoundError, PermissionDeniedError, ValidationError } from "@/lib/errors";
import type {
  OrigenSupresion,
  SupresionDifusion,
  SupresionEncontrada,
} from "@/lib/difusion/modelo";
import { normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";
import type { RolUsuario } from "@/types/domain";
import type { UUID } from "@/types/entities";
import { exigirPagina } from "./_paginacion";
import { hasherBajasEfimero, type HasherTelefonoBajas } from "./difusion-supresiones.hash";

export interface SupresionInsert {
  /** En cualquier formato: se normaliza y se hashea. Un placeholder `ig:`/`fb:` se rechaza. */
  telefono: string;
  origen: OrigenSupresion;
  /** Qué la disparó, sin datos personales: "BAJA", el código de Meta, el botón. */
  detalle?: string | null;
  lead_id?: UUID | null;
  difusion_id?: UUID | null;
  registrada_por?: UUID | null;
}

/**
 * La lista de bajas de Difusión (§6.3). **Irreversible por escritura
 * automática**: no hay `delete` ni `update` en esta interfaz, y la base lo
 * impide también para el service-role (trigger `difusion_supresiones_irreversible`).
 * La única salida es `reactivar`, que exige una persona admin y queda auditada.
 *
 * La interfaz habla de teléfonos, pero la base guarda un HMAC
 * (`difusion-supresiones.hash.ts`): el hash se calcula acá, en el servidor, y
 * ni el teléfono ni el hash salen de esta capa.
 */
export interface DifusionSupresionesRepository {
  /**
   * Idempotente: si el teléfono ya tiene una baja activa —con cualquier versión
   * de la clave—, devuelve esa y no crea otra.
   */
  registrar(input: SupresionInsert): Promise<SupresionDifusion>;
  /**
   * Las bajas activas de esos teléfonos, en cualquier formato, buscadas con
   * todas las versiones vigentes de la clave. Cada una trae el `telefono`
   * (normalizado) que la encontró.
   */
  activasPorTelefonos(telefonos: readonly string[]): Promise<SupresionEncontrada[]>;
  /** Todas, activas y reactivadas, la más reciente primero. */
  listar(pagina: { limite: number; desde?: number }): Promise<SupresionDifusion[]>;
  contarActivas(): Promise<number>;
  /**
   * Levanta una baja. `ValidationError` sin un motivo de 10 a 500 caracteres,
   * `NotFoundError` si no hay una baja activa con ese id, y
   * `PermissionDeniedError` si quien llama no es una persona admin —el
   * service-role no lo es: ni un import ni la API reactivan—.
   */
  reactivar(id: UUID, motivo: string): Promise<SupresionDifusion>;
}

/**
 * El hasher, o cómo conseguirlo. Una función se resuelve en cada uso: así, que
 * falten las claves hace fallar la operación sobre bajas (`IllegalStateError`)
 * y no la construcción del repo, que ocurre al boot junto con todo lo demás.
 */
export type FuenteHasherBajas = HasherTelefonoBajas | (() => HasherTelefonoBajas);

export function resolverHasher(fuente: FuenteHasherBajas): HasherTelefonoBajas {
  return typeof fuente === "function" ? fuente() : fuente;
}

/**
 * Los hashes a buscar para esos teléfonos, cada uno con el teléfono normalizado
 * que lo produjo. Los que no son de WhatsApp no pueden tener baja y se omiten.
 */
export function hashesDeBusqueda(
  hasher: HasherTelefonoBajas,
  telefonos: readonly string[],
): Map<string, string> {
  const porHash = new Map<string, string>();
  for (const crudo of telefonos) {
    const telefono = normalizarTelefonoWhatsApp(crudo);
    if (telefono === null) continue;
    for (const h of hasher.busqueda(telefono)) porHash.set(h.telefono_hash, telefono);
  }
  return porHash;
}

export const MOTIVO_REACTIVACION_MIN = 10;
export const MOTIVO_REACTIVACION_MAX = 500;

export function exigirDetalleDeBaja(detalle: string | null | undefined): string | null {
  const d = detalle ?? null;
  if (d !== null && d.length > 200)
    throw new ValidationError("el detalle de una baja admite hasta 200 caracteres");
  return d;
}

/** Lo que guarda la base: sin espacios de los bordes, entre 10 y 500 caracteres. */
export function exigirMotivoReactivacion(motivo: string): string {
  const m = motivo.trim();
  if (m.length < MOTIVO_REACTIVACION_MIN || m.length > MOTIVO_REACTIVACION_MAX) {
    throw new ValidationError(
      `el motivo de la reactivación es obligatorio: entre ${MOTIVO_REACTIVACION_MIN} y ${MOTIVO_REACTIVACION_MAX} caracteres`,
    );
  }
  return m;
}

/** La persona que simula el in-memory. `null` = service-role: nadie. */
export interface SesionSimulada {
  usuarioId: UUID;
  rol: RolUsuario;
}

/** Una fila como la guarda la base: con el hash, sin el teléfono. */
export type FilaSupresionEnMemoria = SupresionDifusion & { telefono_hash: string };

/**
 * Las filas del in-memory. Compartirlas entre instancias es lo que hace la
 * tabla entre procesos: un repo con otra configuración de claves ve las mismas
 * bajas.
 */
export type AlmacenSupresionesEnMemoria = Map<UUID, FilaSupresionEnMemoria>;

export class InMemoryDifusionSupresionesRepository implements DifusionSupresionesRepository {
  private readonly store: AlmacenSupresionesEnMemoria;
  private readonly sesion: SesionSimulada | null;
  private readonly hasher: FuenteHasherBajas;
  private ultimo = 0;

  constructor(
    opciones: {
      sesion?: SesionSimulada | null;
      /** Sin hasher, una clave al azar por instancia: las filas tampoco sobreviven al proceso. */
      hasher?: FuenteHasherBajas;
      almacen?: AlmacenSupresionesEnMemoria;
    } = {},
  ) {
    this.sesion = opciones.sesion ?? null;
    this.hasher = opciones.hasher ?? hasherBajasEfimero();
    this.store = opciones.almacen ?? new Map();
  }

  private reloj(): Date {
    const ultimaGuardada = Math.max(0, ...[...this.store.values()].map((s) => ultimaFecha(s)));
    this.ultimo = Math.max(Date.now(), this.ultimo + 1, ultimaGuardada + 1);
    return new Date(this.ultimo);
  }

  async registrar(input: SupresionInsert): Promise<SupresionDifusion> {
    const hasher = resolverHasher(this.hasher);
    const alta = hasher.alta(input.telefono);
    const detalle = exigirDetalleDeBaja(input.detalle);
    const buscados = new Set(hasher.busqueda(input.telefono).map((h) => h.telefono_hash));
    const activa = [...this.store.values()]
      .filter((s) => s.reactivada_at === null && buscados.has(s.telefono_hash))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
    if (activa) return publica(activa);

    const s: FilaSupresionEnMemoria = {
      id: crypto.randomUUID(),
      telefono_hash: alta.telefono_hash,
      clave_version: alta.clave_version,
      origen: input.origen,
      detalle,
      lead_id: input.lead_id ?? null,
      difusion_id: input.difusion_id ?? null,
      registrada_por: input.registrada_por ?? null,
      created_at: this.reloj(),
      reactivada_at: null,
      reactivada_por: null,
      reactivacion_motivo: null,
    };
    this.store.set(s.id, s);
    return publica(s);
  }

  async activasPorTelefonos(telefonos: readonly string[]): Promise<SupresionEncontrada[]> {
    const porHash = hashesDeBusqueda(resolverHasher(this.hasher), telefonos);
    const encontradas: SupresionEncontrada[] = [];
    for (const s of this.store.values()) {
      const telefono = porHash.get(s.telefono_hash);
      if (s.reactivada_at === null && telefono !== undefined) {
        encontradas.push({ ...publica(s), telefono });
      }
    }
    return encontradas.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }

  async listar({
    limite,
    desde = 0,
  }: {
    limite: number;
    desde?: number;
  }): Promise<SupresionDifusion[]> {
    exigirPagina(limite, desde);
    return [...this.store.values()]
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1))
      .slice(desde, desde + limite)
      .map(publica);
  }

  async contarActivas(): Promise<number> {
    let n = 0;
    for (const s of this.store.values()) if (s.reactivada_at === null) n += 1;
    return n;
  }

  // Mismo orden de chequeos que `reactivar_supresion_difusion()`: motivo,
  // existencia, persona.
  async reactivar(id: UUID, motivo: string): Promise<SupresionDifusion> {
    const m = exigirMotivoReactivacion(motivo);
    const s = this.store.get(id);
    if (!s || s.reactivada_at !== null) {
      throw new NotFoundError(`no hay una baja activa con id ${id}`, "difusion_supresion", id);
    }
    if (this.sesion === null || this.sesion.rol !== "admin") {
      throw new PermissionDeniedError("reactivar una baja exige una persona con rol admin");
    }
    const reactivada: FilaSupresionEnMemoria = {
      ...s,
      reactivada_at: this.reloj(),
      reactivada_por: this.sesion.usuarioId,
      reactivacion_motivo: m,
    };
    this.store.set(id, reactivada);
    return publica(reactivada);
  }
}

function ultimaFecha(s: SupresionDifusion): number {
  return Math.max(s.created_at.getTime(), s.reactivada_at?.getTime() ?? 0);
}

/** La fila sin el hash: lo que sale del repo. */
function publica(fila: FilaSupresionEnMemoria): SupresionDifusion {
  const { telefono_hash: _hash, ...resto } = structuredClone(fila);
  return resto;
}
