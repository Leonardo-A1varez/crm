import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getAccesoMediaServiceForRequest } from "@/server/bootstrap/media-bootstrap";
import { responderMedia } from "../_lib/responder";

export const dynamic = "force-dynamic";

/** Ver `responderMedia`: redirige a una URL firmada de pocos minutos. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ mensajeId: string }> },
): Promise<Response> {
  const { mensajeId } = await ctx.params;
  return responderMedia(req, mensajeId, {
    usuario: getAuthenticatedUser,
    servicio: getAccesoMediaServiceForRequest,
  });
}
