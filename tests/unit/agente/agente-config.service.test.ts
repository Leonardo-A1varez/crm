import { beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { NotFoundError } from "@/lib/errors";
import { InMemoryAgenteConfigRepository } from "@/server/repositories/agente-config.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAgenteConfigService } from "@/server/services/agente/agente-config.service";
import type { AgenteConfigService } from "@/server/services/agente/agente-config.service";
import type { AgenteConfigRepository } from "@/server/repositories/agente-config.repo";
import type { AgenteConfigValores } from "@/types/agente";

interface AuditFalso {
  registros: { action: string; entity_type: string; entity_id: string | null; payload: unknown }[];
  record(input: {
    action: string;
    entity_type: string;
    entity_id: string | null;
    payload: unknown;
    actorUserId: string | null;
  }): Promise<void>;
}

function auditFalso(): AuditFalso {
  const registros: AuditFalso["registros"] = [];
  return {
    registros,
    async record(input) {
      registros.push({
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        payload: input.payload,
      });
    },
  };
}

const ACTOR = "11111111-1111-1111-1111-111111111111";

let repo: AgenteConfigRepository;
let audit: AuditFalso;
let provider: StaticAgentConfigProvider;
let service: AgenteConfigService;

function valores(patch: Partial<AgenteConfigValores> = {}): AgenteConfigValores {
  return { ...CONFIG_DE_FABRICA, ...patch };
}

/** Deja una version 1 activa, que es el estado real tras la migracion semilla. */
async function sembrarActiva(): Promise<void> {
  await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR, nota: "semilla" });
  audit.registros.length = 0;
}

beforeEach(() => {
  repo = new InMemoryAgenteConfigRepository();
  audit = auditFalso();
  provider = new StaticAgentConfigProvider(CONFIG_DE_FABRICA);
  service = new DefaultAgenteConfigService({ repo, audit, configProvider: provider });
});

describe("guardarYActivar", () => {
  test("crea la version con el numero siguiente", async () => {
    const v1 = await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    expect(v1.version).toBe(1);

    const v2 = await service.guardarYActivar({
      valores: valores({ tono: "formal" }),
      actorUserId: ACTOR,
    });
    expect(v2.version).toBe(2);
  });

  test("la nueva queda activa y la anterior no", async () => {
    const v1 = await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    const v2 = await service.guardarYActivar({
      valores: valores({ tono: "formal" }),
      actorUserId: ACTOR,
    });

    expect((await service.activa())?.id).toBe(v2.id);
    expect((await repo.findById(v1.id))?.activa).toBe(false);
  });

  test("persiste los valores que recibio", async () => {
    const creada = await service.guardarYActivar({
      valores: valores({ modelo: "gpt-4.1-mini", descuento_max_pct: 7.5, tono: "formal" }),
      actorUserId: ACTOR,
    });

    const leida = await repo.findById(creada.id);
    expect(leida?.modelo).toBe("gpt-4.1-mini");
    expect(leida?.descuento_max_pct).toBe(7.5);
    expect(leida?.tono).toBe("formal");
  });

  test("guarda el actor y la nota", async () => {
    const creada = await service.guardarYActivar({
      valores: valores(),
      actorUserId: ACTOR,
      nota: "subo el descuento para la promo",
    });

    expect(creada.creada_por).toBe(ACTOR);
    expect(creada.nota).toBe("subo el descuento para la promo");
  });

  test("registra en admin_actions con action agente_config.activar", async () => {
    await sembrarActiva();
    const nueva = await service.guardarYActivar({
      valores: valores({ tono: "formal" }),
      actorUserId: ACTOR,
    });

    expect(audit.registros).toHaveLength(1);
    expect(audit.registros[0]).toMatchObject({
      action: "agente_config.activar",
      entity_type: "agente_config",
      entity_id: nueva.id,
    });
  });

  test("el payload de auditoria nombra la version nueva y la anterior", async () => {
    await sembrarActiva();
    await service.guardarYActivar({ valores: valores({ tono: "formal" }), actorUserId: ACTOR });

    const payload = audit.registros[0]?.payload as { version: number; version_anterior: number };
    expect(payload.version).toBe(2);
    expect(payload.version_anterior).toBe(1);
  });

  test("campos_cambiados lista NOMBRES, nunca valores", async () => {
    // El audit dice QUE cambio; la tabla de config dice A QUE. `instrucciones`
    // lleva texto de negocio y no se duplica en un log con otra retencion y
    // otra audiencia.
    await sembrarActiva();
    await service.guardarYActivar({
      valores: valores({ tono: "formal", instrucciones: "margen secreto del 40 por ciento" }),
      actorUserId: ACTOR,
    });

    const payload = audit.registros[0]?.payload as { campos_cambiados: string[] };
    expect(payload.campos_cambiados).toEqual(expect.arrayContaining(["tono", "instrucciones"]));
    expect(JSON.stringify(payload)).not.toContain("margen secreto");
  });

  test("campos_cambiados no incluye los campos que no cambiaron", async () => {
    await sembrarActiva();
    await service.guardarYActivar({ valores: valores({ tono: "formal" }), actorUserId: ACTOR });

    const payload = audit.registros[0]?.payload as { campos_cambiados: string[] };
    expect(payload.campos_cambiados).toEqual(["tono"]);
  });

  test("detecta cambios dentro del horario, que es un objeto anidado", async () => {
    // Comparar por referencia daria falso negativo y el audit mentiria.
    await sembrarActiva();
    await service.guardarYActivar({
      valores: valores({ horario: { ...CONFIG_DE_FABRICA.horario, dom: [] } }),
      actorUserId: ACTOR,
    });

    const payload = audit.registros[0]?.payload as { campos_cambiados: string[] };
    expect(payload.campos_cambiados).toContain("horario");
  });

  test("sin cambios respecto de la activa, campos_cambiados va vacio", async () => {
    await sembrarActiva();
    await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });

    const payload = audit.registros[0]?.payload as { campos_cambiados: string[] };
    expect(payload.campos_cambiados).toEqual([]);
  });

  test("la primera version no tiene anterior contra la cual comparar", async () => {
    await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });

    const payload = audit.registros[0]?.payload as {
      version_anterior: number | null;
      campos_cambiados: string[];
    };
    expect(payload.version_anterior).toBeNull();
    expect(payload.campos_cambiados).toEqual([]);
  });

  test("invalida el cache del provider tras activar", async () => {
    const spy = vi.spyOn(provider, "invalidar");
    await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("audita despues de activar: si el audit falla, la config ya esta activa", async () => {
    // Auditar primero dejaria registros de cambios que nunca ocurrieron.
    await sembrarActiva();
    vi.spyOn(audit, "record").mockRejectedValueOnce(new Error("audit caido"));

    await expect(
      service.guardarYActivar({ valores: valores({ tono: "formal" }), actorUserId: ACTOR }),
    ).rejects.toThrow();

    // El fallo es visible, pero la version quedo activa: el estado es coherente.
    expect((await service.activa())?.tono).toBe("formal");
  });
});

describe("rollback", () => {
  test("crea una version NUEVA, no revive la vieja", async () => {
    const v1 = await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    await service.guardarYActivar({ valores: valores({ tono: "formal" }), actorUserId: ACTOR });

    const v3 = await service.rollback({ configId: v1.id, actorUserId: ACTOR });

    expect(v3.version).toBe(3);
    expect(v3.id).not.toBe(v1.id);
    expect((await repo.findById(v1.id))?.activa).toBe(false);
  });

  test("copia los valores de la restaurada", async () => {
    const v1 = await service.guardarYActivar({
      valores: valores({ tono: "cercano", modelo: "gpt-4o-mini", descuento_max_pct: 3 }),
      actorUserId: ACTOR,
    });
    await service.guardarYActivar({
      valores: valores({ tono: "formal", modelo: "gpt-4o", descuento_max_pct: 15 }),
      actorUserId: ACTOR,
    });

    const v3 = await service.rollback({ configId: v1.id, actorUserId: ACTOR });

    expect(v3.tono).toBe("cercano");
    expect(v3.modelo).toBe("gpt-4o-mini");
    expect(v3.descuento_max_pct).toBe(3);
  });

  test("marca rollback_de con el id restaurado", async () => {
    const v1 = await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    await service.guardarYActivar({ valores: valores({ tono: "formal" }), actorUserId: ACTOR });

    const v3 = await service.rollback({ configId: v1.id, actorUserId: ACTOR });
    expect(v3.rollback_de).toBe(v1.id);
  });

  test("la nota autogenerada nombra la version restaurada", async () => {
    const v1 = await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    await service.guardarYActivar({ valores: valores({ tono: "formal" }), actorUserId: ACTOR });

    const v3 = await service.rollback({ configId: v1.id, actorUserId: ACTOR });
    expect(v3.nota).toContain("1");
    expect(v3.nota?.toLowerCase()).toContain("rollback");
  });

  test("el audit del rollback lleva rollback_de en el payload", async () => {
    const v1 = await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    await service.guardarYActivar({ valores: valores({ tono: "formal" }), actorUserId: ACTOR });
    audit.registros.length = 0;

    await service.rollback({ configId: v1.id, actorUserId: ACTOR });

    const payload = audit.registros[0]?.payload as { rollback_de: string };
    expect(payload.rollback_de).toBe(v1.id);
  });

  test("volver a la config vigente es un no-op de valores pero deja rastro", async () => {
    // No se bloquea: el historial tiene que mostrar que alguien lo intento.
    const v1 = await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });
    const v2 = await service.rollback({ configId: v1.id, actorUserId: ACTOR });

    expect(v2.version).toBe(2);
    expect(v2.rollback_de).toBe(v1.id);
  });

  test("id inexistente tira NotFoundError", async () => {
    await expect(
      service.rollback({
        configId: "00000000-0000-0000-0000-000000000000",
        actorUserId: ACTOR,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("historial", () => {
  test("devuelve las versiones mas recientes primero", async () => {
    for (const tono of ["cercano", "formal", "neutro"] as const) {
      await service.guardarYActivar({ valores: valores({ tono }), actorUserId: ACTOR });
    }
    expect((await service.historial()).map((c) => c.version)).toEqual([3, 2, 1]);
  });

  test("respeta el limite", async () => {
    for (const tono of ["cercano", "formal", "neutro"] as const) {
      await service.guardarYActivar({ valores: valores({ tono }), actorUserId: ACTOR });
    }
    expect(await service.historial(2)).toHaveLength(2);
  });
});
