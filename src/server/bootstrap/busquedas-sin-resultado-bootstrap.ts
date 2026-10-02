import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseBusquedasSinResultadoRepository } from "@/server/repositories/busquedas-sin-resultado.supabase.repo";
import { BusquedasSinResultadoService } from "@/server/services/catalog/busquedas-sin-resultado.service";

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getBusquedasSinResultadoServiceForRequest(): Promise<BusquedasSinResultadoService> {
  const db = await createSupabaseServerClient();
  return new BusquedasSinResultadoService(new SupabaseBusquedasSinResultadoRepository(db));
}
