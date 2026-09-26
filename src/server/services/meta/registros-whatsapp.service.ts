import { ValidationError } from "@/lib/errors";
import { interpretarAccountUpdate, type RegistroDeCuenta } from "@/lib/meta/account-update";
import { zonaValida } from "@/lib/zona-horaria";
import type { MetaOperationalEventsRepository } from "@/server/repositories/meta-operational-events.repo";
import type { UsoCupoRepository, UsoDeLaVentana } from "@/server/repositories/uso-cupo.repo";
import type { WhatsAppNumerosRolRepository } from "@/server/repositories/whatsapp-numeros-rol.repo";
import type { UUID } from "@/types/entities";

export type { UsoDeLaVentana, UsoPorDia } from "@/server/repositories/uso-cupo.repo";

/**
 * Lo que la salud de WhatsApp saca de la BASE y no de la Graph API: los
 * `account_update` que mandó Meta, el uso del cupo según lo que salió por este
 * CRM y el rol que el admin le puso a cada número.
 *
 * Aparte de `SaludWhatsAppService` a propósito: aquél sólo habla con Meta con
 * el token del servidor; éste sólo con Supabase, con el client del request y
 * su RLS.
 */

/** Los días sobre los que Meta mide el uso para subir de nivel. */
export const DIAS_DE_USO = 7;

/**
 * Cuántos account_update se leen. Llegan de a uno cada tanto (una sanción, un
 * partner), así que 200 cubre años; si se llega al tope, se dice.
 */
const MAX_ACCOUNT_UPDATES = 200;

export interface SancionesLeidas {
  registros: RegistroDeCuenta[];
  /** Se leyó el tope: puede haber registros más viejos que no entraron. */
  truncado: boolean;
}

export interface RegistrosWhatsAppService {
  sanciones(): Promise<SancionesLeidas>;
  usoDelCupo(zona: string): Promise<UsoDeLaVentana>;
  roles(): Promise<Map<string, string>>;
  /** `rol` vacío (o sólo espacios) borra la etiqueta. */
  guardarRol(input: { phoneNumberId: string; rol: string; actorId: UUID | null }): Promise<void>;
}

export interface RegistrosWhatsAppDeps {
  eventos: Pick<MetaOperationalEventsRepository, "listarRecientes">;
  uso: UsoCupoRepository;
  roles: WhatsAppNumerosRolRepository;
}

export class DefaultRegistrosWhatsAppService implements RegistrosWhatsAppService {
  constructor(private readonly deps: RegistrosWhatsAppDeps) {}

  async sanciones(): Promise<SancionesLeidas> {
    const filas = await this.deps.eventos.listarRecientes({
      campo: "account_update",
      limite: MAX_ACCOUNT_UPDATES,
    });
    return {
      registros: filas.map((f) => ({
        evento: interpretarAccountUpdate(f.payload),
        at: f.ocurrido_at ?? f.created_at,
      })),
      truncado: filas.length >= MAX_ACCOUNT_UPDATES,
    };
  }

  async usoDelCupo(zona: string): Promise<UsoDeLaVentana> {
    // `at time zone` con una zona inexistente es un error de Postgres; mejor
    // decirlo acá con un mensaje que se entienda.
    if (!zonaValida(zona)) throw new ValidationError(`La zona horaria ${zona} no existe.`);
    return this.deps.uso.destinatariosPorDia(DIAS_DE_USO, zona);
  }

  async roles(): Promise<Map<string, string>> {
    const filas = await this.deps.roles.listar();
    return new Map(filas.map((f) => [f.phoneNumberId, f.rol]));
  }

  async guardarRol(input: {
    phoneNumberId: string;
    rol: string;
    actorId: UUID | null;
  }): Promise<void> {
    const rol = input.rol.trim();
    if (rol === "") return this.deps.roles.borrar(input.phoneNumberId);
    return this.deps.roles.guardar({
      phoneNumberId: input.phoneNumberId,
      rol,
      actorId: input.actorId,
    });
  }
}
