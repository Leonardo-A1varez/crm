import { Redis } from "@upstash/redis";
import { ValidationError } from "@/lib/errors";
import {
  InMemoryCostTracker,
  type CostTracker,
  type CostTrackerConfig,
  type UsageRecord,
} from "./cost-tracker";
import type { Logger } from "./logger";
import { esPlaceholder } from "@/lib/config-placeholder";

/**
 * CostTracker persistente sobre Upstash Redis. Arregla el kill-switch roto en
 * serverless: InMemory pierde el acumulado en cada cold start → el daily cap
 * jamás se alcanza. Key por día UTC + TTL 48h (idempotente en cada record).
 */

export interface MinimalRedis {
  incrbyfloat(key: string, value: number): Promise<number>;
  get(key: string): Promise<string | number | null>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const TTL_SECONDS = 172_800; // 48h: cubre el día en curso + margen de lectura.

function dayKey(date: Date): string {
  return `cost:${date.toISOString().slice(0, 10)}`;
}

export class UpstashCostTracker implements CostTracker {
  constructor(
    private readonly config: CostTrackerConfig,
    private readonly redis: MinimalRedis,
  ) {}

  async record(usage: UsageRecord): Promise<void> {
    const price = this.config.pricing[usage.model];
    if (!price) {
      throw new ValidationError(`model sin pricing configurado: ${usage.model}`);
    }
    const usd =
      (usage.inputTokens / 1_000_000) * price.inputUsdPer1M +
      (usage.outputTokens / 1_000_000) * price.outputUsdPer1M;
    const key = dayKey(usage.at ?? this.now());
    await this.redis.incrbyfloat(key, usd);
    await this.redis.expire(key, TTL_SECONDS);
  }

  async getDailySpendUsd(day?: Date): Promise<number> {
    const raw = await this.redis.get(dayKey(day ?? this.now()));
    if (raw === null) return 0;
    const parsed = typeof raw === "number" ? raw : Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async exceedsCap(day?: Date): Promise<boolean> {
    const spend = await this.getDailySpendUsd(day);
    return spend >= this.config.dailyCapUsd;
  }

  private now(): Date {
    return this.config.now ? this.config.now() : new Date();
  }
}

export interface MakeCostTrackerConfig extends CostTrackerConfig {
  upstashUrl?: string;
  upstashToken?: string;
  logger: Logger;
}

export function makeCostTracker(cfg: MakeCostTrackerConfig): CostTracker {
  const { upstashUrl, upstashToken, logger, ...base } = cfg;
  if (esPlaceholder(upstashUrl) || esPlaceholder(upstashToken)) {
    logger.warn("cost-tracker in-memory: daily cap NO persistente entre cold starts", {
      hint: "configurar UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN para prod",
    });
    return new InMemoryCostTracker(base);
  }
  const redis = new Redis({ url: upstashUrl as string, token: upstashToken as string });
  return new UpstashCostTracker(base, redis);
}
