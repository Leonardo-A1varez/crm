import { ValidationError } from "@/lib/errors";
import type { IntentsRepository } from "@/server/repositories/intents.repo";
import type { RulesRepository } from "@/server/repositories/rules.repo";
import type { RespuestaTipo } from "@/types/domain";
import type { Intent, Regla, UUID } from "@/types/entities";

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
}

export class DefaultReglasAdminService implements ReglasAdminService {
  constructor(private readonly deps: { intents: IntentsRepository; rules: RulesRepository }) {}

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
}
