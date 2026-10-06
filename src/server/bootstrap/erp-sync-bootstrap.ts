import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseErpSyncEstadoRepository } from "@/server/repositories/erp-sync-estado.supabase.repo";
import { DefaultErpSyncService } from "@/server/services/catalog/erp-sync.service";
import type { AppClient } from "@/server/db/client";
import type { ErpSyncService } from "@/server/services/catalog/erp-sync.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeErpSyncService(db: AppClient): ErpSyncService {
  return new DefaultErpSyncService({ estados: new SupabaseErpSyncEstadoRepository(db) });
}

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getErpSyncServiceForRequest(): Promise<ErpSyncService> {
  return makeErpSyncService(await createSupabaseServerClient());
}
