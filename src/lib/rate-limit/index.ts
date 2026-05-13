/**
 * Rate limiter interface inyectable.
 *
 * Impls:
 * - NoopRateLimiter: default tests + dev. Siempre permite (no rate limit).
 * - UpstashRateLimiter: prod. Sliding window via Upstash Redis REST.
 *
 * Uso primario: protección webhook Meta (per IP + per phone_number_id) contra
 * replay attacks + burst flood. Reuso futuro: API routes admin, cost-tracker.
 *
 * Per AGENTS.md §3 boundaries: prod requires Redis backed por multi-instance
 * safety en Vercel serverless (in-memory Map no compartido across Lambdas).
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitResult {
  /** True si la request es permitida; false si excede limit. */
  success: boolean;
  /** Requests restantes en la ventana actual. */
  remaining: number;
  /** Limit configured (max requests per window). */
  limit: number;
  /** Timestamp ms cuando el window se resetea. */
  reset: number;
}

export interface RateLimiter {
  /**
   * Consume 1 token contra key dado. Retorna result con success boolean.
   * Caller decide qué hacer en fail (HTTP 429, log, retry-after header).
   */
  limit(key: string): Promise<RateLimitResult>;
}

/**
 * Noop default: siempre permite. Tests + dev sin Upstash.
 * NO usar en prod.
 */
export class NoopRateLimiter implements RateLimiter {
  async limit(_key: string): Promise<RateLimitResult> {
    return {
      success: true,
      remaining: Number.POSITIVE_INFINITY,
      limit: Number.POSITIVE_INFINITY,
      reset: Date.now() + 60_000,
    };
  }
}

export interface UpstashRateLimiterOptions {
  redis: Redis;
  /** Max requests per window. Default: 100. */
  limit?: number;
  /**
   * Window duration. Format: `${number} ${unit}` donde unit = "s"|"m"|"h"|"d".
   * Default: "1 m" (1 minuto).
   */
  window?: `${number} ${"s" | "m" | "h" | "d"}`;
  /** Prefix Redis keys. Default: "rl". */
  prefix?: string;
  /** Algorithm: "sliding-window" (default), "token-bucket", "fixed-window". */
  algorithm?: "sliding-window" | "token-bucket" | "fixed-window";
}

/**
 * Upstash Redis-backed rate limiter. Multi-instance safe.
 * Sliding window algorithm por default (más preciso que fixed window;
 * acepta bursts moderados sin overshoot).
 */
export class UpstashRateLimiter implements RateLimiter {
  private readonly impl: Ratelimit;

  constructor(options: UpstashRateLimiterOptions) {
    const limit = options.limit ?? 100;
    const window = options.window ?? "1 m";
    const prefix = options.prefix ?? "rl";
    const algorithm = options.algorithm ?? "sliding-window";

    const limiter =
      algorithm === "token-bucket"
        ? Ratelimit.tokenBucket(limit, window, limit)
        : algorithm === "fixed-window"
          ? Ratelimit.fixedWindow(limit, window)
          : Ratelimit.slidingWindow(limit, window);

    this.impl = new Ratelimit({
      redis: options.redis,
      limiter,
      prefix,
      analytics: true,
    });
  }

  async limit(key: string): Promise<RateLimitResult> {
    const result = await this.impl.limit(key);
    return {
      success: result.success,
      remaining: result.remaining,
      limit: result.limit,
      reset: result.reset,
    };
  }
}

/**
 * Factory helper: crea Upstash limiter desde env (URL + token) o fallback Noop.
 * Útil en API route handlers donde queremos rate limit en prod pero tolerar
 * ausencia env en dev/test.
 */
export function makeRateLimiterFromEnv(options: {
  url?: string;
  token?: string;
  limit?: number;
  window?: UpstashRateLimiterOptions["window"];
  prefix?: string;
}): RateLimiter {
  if (!options.url || !options.token) {
    return new NoopRateLimiter();
  }
  const redis = new Redis({ url: options.url, token: options.token });
  return new UpstashRateLimiter({
    redis,
    limit: options.limit,
    window: options.window,
    prefix: options.prefix,
  });
}
