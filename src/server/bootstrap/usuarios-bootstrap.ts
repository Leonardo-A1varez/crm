import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseUsersRepository } from "@/server/repositories/users.supabase.repo";
import { DefaultUsuariosService } from "@/server/services/usuarios/usuarios.service";
import type { AppClient } from "@/server/db/client";
import type { UsuariosService } from "@/server/services/usuarios/usuarios.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeUsuariosService(db: AppClient): UsuariosService {
  return new DefaultUsuariosService({ users: new SupabaseUsersRepository(db) });
}

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getUsuariosServiceForRequest(): Promise<UsuariosService> {
  const db = await createSupabaseServerClient();
  return makeUsuariosService(db);
}
