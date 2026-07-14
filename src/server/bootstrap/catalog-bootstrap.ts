import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { DefaultCatalogService } from "@/server/services/catalog/default-catalog.service";
import type { AppClient } from "@/server/db/client";
import type { CatalogService } from "@/server/services/catalog/catalog.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeCatalogService(db: AppClient): CatalogService {
  return new DefaultCatalogService({ productos: new SupabaseProductsRepository(db) });
}

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getCatalogServiceForRequest(): Promise<CatalogService> {
  const db = await createSupabaseServerClient();
  return makeCatalogService(db);
}
