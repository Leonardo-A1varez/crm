import { enmascararTelefono } from "@/lib/difusion/mascara";
import { camposUsados, resolverParametros, type CampoParametro } from "@/lib/difusion/parametros";
import { normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";
import { NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import type { DatosInterpolacion } from "@/lib/workflows/variables";
import type { AdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { DifusionesRepository } from "@/server/repositories/difusiones.repo";
import type { MetaApiClient } from "@/server/services/meta-api.service";
import type { UUID } from "@/types/entities";

/**
 * "Enviar de prueba a mi número" del pre-vuelo (docs/prd-workflows.md §7.5).
 *
 * Manda la plantilla de la difusión —la guardada en el borrador, que es la que
 * va a salir— con las variables resueltas contra un lead de muestra, a un
 * número que carga el admin. Sale por `MetaApiClient.sendTemplate`, el mismo
 * que usa el motor: si la prueba llega, la plantilla, el idioma y los
 * parámetros son los que Meta acepta.
 *
 * - **No es un envío de la difusión.** No escribe en `difusion_envios` ni en
 *   `mensajes`, no consume la cola ni cuenta para el progreso.
 * - **Se audita** en `admin_actions`, ANTES de llamar a Meta: una prueba cuya
 *   respuesta se perdió igual quedó registrada, y cuenta para el tope. El
 *   número se guarda enmascarado (`enmascararTelefono`), como sale hacia la
 *   pantalla: la auditoría dice que se probó, no a quién hay que llamar.
 * - **Un número por vez y un tope por hora** por admin, contado sobre la misma
 *   auditoría. Sin tope, el botón es una forma de mandarle marketing a
 *   cualquier número.
 * - **Respeta la lista de bajas.** Un número dado de baja no recibe la prueba:
 *   el botón no puede ser la puerta de atrás de la baja (PRD §6.6). Sin claves
 *   HMAC la lectura lanza y no sale nada (falla cerrado, como el motor).
 */

/**
 * Decisión propia, sin fuente que la fije: 5 por hora por admin alcanzan para
 * probar una plantilla con dos o tres leads de muestra y corregir una variable;
 * no alcanzan para usar el botón como envío.
 */
export const PRUEBAS_POR_HORA = 5;
export const ACCION_PRUEBA_DIFUSION = "difusion.prueba_enviada";
const HORA_MS = 60 * 60_000;
/** Cuántas acciones del admin se leen para contar las de la última hora. */
const VENTANA_LECTURA = 200;

export interface EnviarPruebaInput {
  difusionId: UUID;
  /** Como lo escribió el admin: se normaliza acá. */
  telefono: string;
  /** El lead contra el que se resuelven las variables. */
  leadId: UUID;
  actorId: UUID;
}

export interface PruebaDifusionService {
  /** Cuántas pruebas le quedan en la hora a este admin, después de esta. */
  enviar(input: EnviarPruebaInput): Promise<{ restantes: number }>;
}

export interface PruebaDifusionDeps {
  difusiones: Pick<DifusionesRepository, "findById">;
  audit: Pick<AdminAuditRepository, "create" | "list">;
  meta: Pick<MetaApiClient, "sendTemplate">;
  supresiones: Pick<DifusionSupresionesRepository, "activasPorTelefonos">;
  datosDelLead: (leadId: UUID, campos: ReadonlySet<CampoParametro>) => Promise<DatosInterpolacion>;
  ahora?: () => Date;
}

export class DefaultPruebaDifusionService implements PruebaDifusionService {
  private readonly ahora: () => Date;

  constructor(private readonly deps: PruebaDifusionDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
  }

  async enviar(input: EnviarPruebaInput): Promise<{ restantes: number }> {
    const telefono = normalizarTelefonoWhatsApp(input.telefono);
    if (telefono === null) {
      throw new ValidationError("Ese número no es un teléfono de WhatsApp válido.");
    }

    const d = await this.deps.difusiones.findById(input.difusionId);
    if (!d) throw new NotFoundError("La difusión no existe.", "difusion", input.difusionId);
    if (d.plantilla_nombre === null || d.plantilla_idioma === null) {
      throw new ValidationError("Elegí la plantilla en el paso Mensaje antes de probarla.");
    }

    if ((await this.deps.supresiones.activasPorTelefonos([telefono])).length > 0) {
      throw new ValidationError(
        "Ese número está en la lista de bajas: no recibe mensajes de difusión, tampoco de prueba.",
      );
    }

    const ahora = this.ahora();
    const usadas = await this.pruebasDeLaUltimaHora(input.actorId, ahora);
    if (usadas >= PRUEBAS_POR_HORA) {
      throw new RateLimitError(
        `Ya mandaste ${PRUEBAS_POR_HORA} pruebas en la última hora. Esperá un rato para mandar otra.`,
        "difusion_prueba",
      );
    }

    let parametrosCuerpo: string[] = [];
    if (d.plantilla_parametros.length > 0) {
      const datos = await this.deps.datosDelLead(
        input.leadId,
        camposUsados(d.plantilla_parametros),
      );
      const r = resolverParametros(d.plantilla_parametros, datos);
      if (!r.ok) {
        throw new ValidationError(
          `La variable {{${r.numero}}} queda vacía para este lead y no tiene respaldo: elegí otro lead o poné un respaldo.`,
        );
      }
      parametrosCuerpo = r.valores;
    }

    await this.deps.audit.create({
      actor_user_id: input.actorId,
      action: ACCION_PRUEBA_DIFUSION,
      entity_type: "difusion",
      entity_id: d.id,
      payload: {
        lead_id: input.leadId,
        plantilla: d.plantilla_nombre,
        idioma: d.plantilla_idioma,
        telefono: enmascararTelefono(telefono),
      },
    });

    await this.deps.meta.sendTemplate({
      to: telefono,
      plantilla: { nombre: d.plantilla_nombre, idioma: d.plantilla_idioma, parametrosCuerpo },
    });
    return { restantes: Math.max(0, PRUEBAS_POR_HORA - usadas - 1) };
  }

  private async pruebasDeLaUltimaHora(actorId: UUID, ahora: Date): Promise<number> {
    const desde = ahora.getTime() - HORA_MS;
    const recientes = await this.deps.audit.list({
      actorUserId: actorId,
      entityType: "difusion",
      limit: VENTANA_LECTURA,
    });
    return recientes.filter(
      (a) => a.action === ACCION_PRUEBA_DIFUSION && a.created_at.getTime() > desde,
    ).length;
  }
}
