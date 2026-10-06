import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseUsersRepository } from "@/server/repositories/users.supabase.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultUsuariosAdminService } from "@/server/services/usuarios/usuarios-admin.service";
import { DefaultUsuariosService } from "@/server/services/usuarios/usuarios.service";
import type { AppClient } from "@/server/db/client";
import type { UsuariosAdminService } from "@/server/services/usuarios/usuarios-admin.service";
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

/** Cambios del equipo que hace un admin (y la auditoría que dejan). */
export function makeUsuariosAdminService(db: AppClient): UsuariosAdminService {
  return new DefaultUsuariosAdminService({
    users: new SupabaseUsersRepository(db),
    audit: new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db)),
  });
}

export async function getUsuariosAdminServiceForRequest(): Promise<UsuariosAdminService> {
  return makeUsuariosAdminService(await createSupabaseServerClient());
}
