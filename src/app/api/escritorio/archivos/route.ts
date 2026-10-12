import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getArchivosEscritorioServiceForRequest } from "@/server/bootstrap/media-bootstrap";
import { responderArchivosEscritorio } from "./_lib/responder";

export const dynamic = "force-dynamic";

/** Ver `responderArchivosEscritorio`. */
export async function GET(req: Request): Promise<Response> {
  return responderArchivosEscritorio(req, {
    usuario: getAuthenticatedUser,
    servicio: getArchivosEscritorioServiceForRequest,
  });
}
