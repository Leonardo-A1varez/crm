import { ValidationError } from "@/lib/errors";
import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { ReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import type { RulesRepository } from "@/server/repositories/rules.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { RespuestaTipo } from "@/types/domain";
import type { Intent, Regla, ReglaEtiqueta, UUID } from "@/types/entities";

export interface IntentConReglas {
  intent: Intent;
  reglasActivas: number;
  reglasTotales: number;
}

export interface ReglaConIntent {
  regla: Regla;
  intentNombre: string;
}

export interface CrearIntentInput {
  nombre: string;
  descripcion: string;
  ejemplos: string[];
}

/**
 * Una regla de etiquetado con los nombres resueltos.
 *
 * La tabla guarda ids; la pantalla necesita mostrar "pide_factura → Pide
 * factura" y el color del chip. Resolverlo acá evita que la UI pida los
 * catálogos por su cuenta.
 */
export interface ReglaEtiquetaConNombres {
  regla: ReglaEtiqueta;
  intentNombre: string;
  tagNombre: string;
  tagColor: string;
}

export interface CrearReglaEtiquetaInput {
  intentId: UUID;
  tagId: UUID;
}

export interface CrearReglaInput {
  intentId: UUID;
  respuestaTipo: RespuestaTipo;
  respuestaContenido: string;
  prioridad: number;
}

export interface ReglasAdminService {
  listarIntents(): Promise<IntentConReglas[]>;
  listarReglas(): Promise<ReglaConIntent[]>;
  crearIntent(input: CrearIntentInput): Promise<Intent>;
  setIntentActivo(id: UUID, activo: boolean): Promise<Intent>;
  crearRegla(input: CrearReglaInput): Promise<Regla>;
  setReglaActiva(id: UUID, activa: boolean): Promise<Regla>;
  listarReglasEtiqueta(): Promise<ReglaEtiquetaConNombres[]>;
  crearReglaEtiqueta(input: CrearReglaEtiquetaInput): Promise<ReglaEtiqueta>;
  setReglaEtiquetaActiva(id: UUID, activa: boolean): Promise<ReglaEtiqueta>;
  borrarReglaEtiqueta(id: UUID): Promise<void>;
}

export class DefaultReglasAdminService implements ReglasAdminService {
  constructor(
    private readonly deps: {
      intents: IntentsRepository;
      rules: RulesRepository;
      reglasEtiqueta: ReglasEtiquetaRepository;
      tags: TagsRepository;
    },
  ) {}

  async listarIntents(): Promise<IntentConReglas[]> {
    const [intents, reglas] = await Promise.all([this.deps.intents.list(), this.deps.rules.list()]);

    return intents
      .map((intent) => {
        const propias = reglas.filter((r) => r.intent_id === intent.id);
        return {
          intent,
          reglasActivas: propias.filter((r) => r.activa).length,
          reglasTotales: propias.length,
        };
      })
      .sort((a, b) => a.intent.nombre.localeCompare(b.intent.nombre));
  }

  async listarReglas(): Promise<ReglaConIntent[]> {
    const [intents, reglas] = await Promise.all([this.deps.intents.list(), this.deps.rules.list()]);
    const porId = new Map(intents.map((i) => [i.id, i.nombre]));

    // Mismo orden que usa el motor: prioridad DESC y, a igual prioridad, la
    // más vieja primero. Si la pantalla ordenara distinto, el admin no vería
    // cuál gana.
    return reglas
      .map((regla) => ({ regla, intentNombre: porId.get(regla.intent_id) ?? "(intent borrado)" }))
      .sort(
        (a, b) =>
          a.intentNombre.localeCompare(b.intentNombre) ||
          b.regla.prioridad - a.regla.prioridad ||
          a.regla.created_at.getTime() - b.regla.created_at.getTime(),
      );
  }

  async crearIntent(input: CrearIntentInput): Promise<Intent> {
    const nombre = input.nombre.trim();
    // El nombre es la clave con la que el clasificador matchea: dos intents
    // homónimos hacen que las reglas del segundo no se alcancen nunca.
    const existente = await this.deps.intents.findByNombre(nombre);
    if (existente) {
      throw new ValidationError(`ya existe un intent llamado ${nombre}`, "intent_duplicado");
    }

    return this.deps.intents.create({
      nombre,
      descripcion: input.descripcion.trim(),
      ejemplos: input.ejemplos.map((e) => e.trim()).filter(Boolean),
      auto_detectado: false,
      activo: true,
    });
  }

  async setIntentActivo(id: UUID, activo: boolean): Promise<Intent> {
    return this.deps.intents.update(id, { activo });
  }

  async crearRegla(input: CrearReglaInput): Promise<Regla> {
    return this.deps.rules.create({
      intent_id: input.intentId,
      condiciones_extra: null,
      respuesta_tipo: input.respuestaTipo,
      respuesta_contenido: input.respuestaContenido.trim(),
      prioridad: input.prioridad,
      activa: true,
    });
  }

  async setReglaActiva(id: UUID, activa: boolean): Promise<Regla> {
    return this.deps.rules.update(id, { activa });
  }

  async listarReglasEtiqueta(): Promise<ReglaEtiquetaConNombres[]> {
    const [reglas, intents, tags] = await Promise.all([
      this.deps.reglasEtiqueta.list(),
      this.deps.intents.list(),
      this.deps.tags.list(),
    ]);
    const intentPorId = new Map(intents.map((i) => [i.id, i.nombre]));
    const tagPorId = new Map(tags.map((t) => [t.id, t]));

    return reglas
      .map((regla) => {
        const tag = tagPorId.get(regla.tag_id);
        return {
          regla,
          intentNombre: intentPorId.get(regla.intent_id) ?? "(intent borrado)",
          // La FK es RESTRICT, así que una etiqueta usada no se puede borrar y
          // este fallback no debería verse nunca. Está por si alguien la saca
          // por SQL: mejor una fila rara que una pantalla rota.
          tagNombre: tag?.nombre ?? "(etiqueta borrada)",
          tagColor: tag?.color ?? "#888888",
        };
      })
      .sort(
        (a, b) =>
          a.intentNombre.localeCompare(b.intentNombre) || a.tagNombre.localeCompare(b.tagNombre),
      );
  }

  async crearReglaEtiqueta(input: CrearReglaEtiquetaInput): Promise<ReglaEtiqueta> {
    return this.deps.reglasEtiqueta.create({
      intent_id: input.intentId,
      tag_id: input.tagId,
      condiciones_extra: null,
      activa: true,
    });
  }

  async setReglaEtiquetaActiva(id: UUID, activa: boolean): Promise<ReglaEtiqueta> {
    return this.deps.reglasEtiqueta.update(id, { activa });
  }

  async borrarReglaEtiqueta(id: UUID): Promise<void> {
    return this.deps.reglasEtiqueta.delete(id);
  }
}
