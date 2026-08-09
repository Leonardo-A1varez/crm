import { beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { InMemoryAgenteConfigRepository } from "@/server/repositories/agente-config.repo";
import {
  CachedAgentConfigProvider,
  StaticAgentConfigProvider,
  TTL_CONFIG_MS,
} from "@/server/services/agente/config-provider";
import type { AgenteConfigRepository } from "@/server/repositories/agente-config.repo";
import type { Logger } from "@/lib/observability/logger";

function loggerFalso(): Logger & { errores: string[] } {
  const errores: string[] = [];
  return {
    errores,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (msg: string) => {
      errores.push(msg);
    },
    child: function () {
      return this;
    },
  } as unknown as Logger & { errores: string[] };
}

async function repoConActiva(patch = {}): Promise<AgenteConfigRepository> {
  const repo = new InMemoryAgenteConfigRepository();
  const fila = await repo.crear({
    ...CONFIG_DE_FABRICA,
    ...patch,
    version: 1,
    nota: null,
    rollback_de: null,
    creada_por: null,
  });
  await repo.activar(fila.id);
  return repo;
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("CachedAgentConfigProvider", () => {
  test("devuelve la config activa del repo", async () => {
    const repo = await repoConActiva({ modelo: "gpt-4.1-mini", tono: "formal" });
    const provider = new CachedAgentConfigProvider(repo, loggerFalso());

    const config = await provider.get();
    expect(config.modelo).toBe("gpt-4.1-mini");
    expect(config.tono).toBe("formal");
  });

  test("no expone metadatos de version", async () => {
    const repo = await repoConActiva();
    const config = await new CachedAgentConfigProvider(repo, loggerFalso()).get();
    expect(config).not.toHaveProperty("version");
    expect(config).not.toHaveProperty("activa");
    expect(config).not.toHaveProperty("id");
  });

  test("cachea: dos lecturas seguidas tocan el repo una sola vez", async () => {
    const repo = await repoConActiva();
    const spy = vi.spyOn(repo, "findActiva");
    const provider = new CachedAgentConfigProvider(repo, loggerFalso());

    await provider.get();
    await provider.get();
    await provider.get();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("relee pasado el TTL", async () => {
    vi.useFakeTimers();
    const repo = await repoConActiva();
    const spy = vi.spyOn(repo, "findActiva");
    const provider = new CachedAgentConfigProvider(repo, loggerFalso());

    await provider.get();
    vi.advanceTimersByTime(TTL_CONFIG_MS + 1);
    await provider.get();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("invalidar fuerza la relectura sin esperar el TTL", async () => {
    const repo = await repoConActiva();
    const spy = vi.spyOn(repo, "findActiva");
    const provider = new CachedAgentConfigProvider(repo, loggerFalso());

    await provider.get();
    provider.invalidar();
    await provider.get();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("tras invalidar refleja el cambio", async () => {
    const repo = new InMemoryAgenteConfigRepository();
    const v1 = await repo.crear({
      ...CONFIG_DE_FABRICA,
      version: 1,
      nota: null,
      rollback_de: null,
      creada_por: null,
    });
    await repo.activar(v1.id);
    const provider = new CachedAgentConfigProvider(repo, loggerFalso());
    expect((await provider.get()).tono).toBe("cercano");

    const v2 = await repo.crear({
      ...CONFIG_DE_FABRICA,
      tono: "formal",
      version: 2,
      nota: null,
      rollback_de: null,
      creada_por: null,
    });
    await repo.activar(v2.id);
    provider.invalidar();

    expect((await provider.get()).tono).toBe("formal");
  });
});

describe("degradacion", () => {
  test("sin fila activa cae a la config de fabrica", async () => {
    const repo = new InMemoryAgenteConfigRepository();
    const provider = new CachedAgentConfigProvider(repo, loggerFalso());
    expect(await provider.get()).toEqual(CONFIG_DE_FABRICA);
  });

  test("si el repo tira, cae a fabrica en vez de propagar", async () => {
    // Un CRM mudo por no poder leer su config es peor que uno con valores de fabrica.
    const repo = new InMemoryAgenteConfigRepository();
    vi.spyOn(repo, "findActiva").mockRejectedValue(new Error("DB caida"));
    const logger = loggerFalso();
    const provider = new CachedAgentConfigProvider(repo, logger);

    expect(await provider.get()).toEqual(CONFIG_DE_FABRICA);
  });

  test("el fallo se registra como error, no en silencio", async () => {
    const repo = new InMemoryAgenteConfigRepository();
    vi.spyOn(repo, "findActiva").mockRejectedValue(new Error("DB caida"));
    const logger = loggerFalso();

    await new CachedAgentConfigProvider(repo, logger).get();
    expect(logger.errores.length).toBeGreaterThan(0);
  });

  test("no cachea el fallback: reintenta en la proxima lectura", async () => {
    // Cachear el fallback dejaria al agente en valores de fabrica 30s despues
    // de que la DB se recupere, sin razon.
    const repo = new InMemoryAgenteConfigRepository();
    const spy = vi.spyOn(repo, "findActiva").mockRejectedValue(new Error("DB caida"));
    const provider = new CachedAgentConfigProvider(repo, loggerFalso());

    await provider.get();
    await provider.get();

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("StaticAgentConfigProvider", () => {
  test("devuelve siempre la config que se le dio", async () => {
    const provider = new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, tono: "formal" });
    expect((await provider.get()).tono).toBe("formal");
    expect((await provider.get()).tono).toBe("formal");
  });

  test("invalidar es no-op y no rompe", async () => {
    const provider = new StaticAgentConfigProvider(CONFIG_DE_FABRICA);
    expect(() => provider.invalidar()).not.toThrow();
  });
});
