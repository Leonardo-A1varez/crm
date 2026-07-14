import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/server/auth/middleware-session";

// Next 16: middleware se llama proxy. Gate de sesión del panel; webhooks
// quedan fuera del matcher (HMAC propio) igual que assets estáticos.
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isLogin = pathname === "/login";
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Todo salvo: api (webhooks HMAC), estáticos Next, favicon, archivos con extensión.
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)"],
};
