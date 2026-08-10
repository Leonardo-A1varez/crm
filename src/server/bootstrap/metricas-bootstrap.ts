import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseMetricsRepository } from "@/server/repositories/metrics.supabase.repo";
import { DefaultMetricsService } from "@/server/services/metricas/default-metricas.service";
import type { AppClient } from "@/server/db/client";
import type { MetricsService } from "@/server/services/metricas/metricas.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeMetricsService(db: AppClient): MetricsService {
  return new DefaultMetricsService({ metrics: new SupabaseMetricsRepository(db) });
}

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getMetricsServiceForRequest(): Promise<MetricsService> {
  const db = await createSupabaseServerClient();
  return makeMetricsService(db);
}
