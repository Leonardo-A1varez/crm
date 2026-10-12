import type { NextConfig } from "next";

/**
 * Security headers B3 — OWASP baseline para CRM industrial Latam aftermarket.
 *
 * - CSP strict: bloquea inline scripts/styles excepto Next.js runtime y propios.
 * - HSTS: forzar HTTPS 2 años + preload + includeSubDomains.
 * - X-Frame-Options DENY: prevenir clickjacking (incluso si CSP fails).
 * - Referrer-Policy strict-origin-when-cross-origin: minimiza referrer leak.
 * - Permissions-Policy: deshabilita features sensibles (camera/mic/geo) salvo
 *   que se requieran (CRM no las usa).
 * - X-Content-Type-Options nosniff: prevent MIME sniffing.
 * - X-DNS-Prefetch-Control on: speed up cross-origin lookups.
 *
 * Webhooks Meta route (`/api/webhooks/meta`) excluido de CSP via path-specific
 * config en su handler (Meta envía sin browser context).
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * El Supabase del stack local (`npm run stack:up`) habla por http/ws en
 * loopback, y la CSP de producción solo deja salir a `*.supabase.co`: sin esto
 * Realtime no conecta en local. Se suma el origen únicamente cuando la URL
 * configurada es de loopback, así que en Vercel el header no cambia.
 */
function origenesSupabaseLocal(url: string | undefined): string[] {
  if (!url) return [];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  if (!LOOPBACK.has(u.hostname)) return [];
  if (u.protocol !== "http:" && u.protocol !== "https:") return [];
  const ws = u.protocol === "https:" ? "wss:" : "ws:";
  return [`${u.protocol}//${u.host}`, `${ws}//${u.host}`];
}

/**
 * Mismo origen local pero sólo el http(s): las imágenes, audios y videos del
 * hilo se piden a `/api/media/<id>`, que redirige a una URL firmada del Storage
 * (docs/meta/media.md). En producción ya entran por `https://*.supabase.co`.
 */
const MEDIA_SUPABASE_LOCAL = origenesSupabaseLocal(process.env.NEXT_PUBLIC_SUPABASE_URL).slice(
  0,
  1,
);

const CONNECT_SRC = [
  "'self'",
  "https://*.supabase.co",
  "https://api.openai.com",
  "https://graph.facebook.com",
  "wss://*.supabase.co",
  ...origenesSupabaseLocal(process.env.NEXT_PUBLIC_SUPABASE_URL),
];

/**
 * Directivas de la CSP. Se arma desde acá para que la de `/ajustes` sea la
 * misma con tres agregados y no una copia que se desalinee.
 */
function directivasCsp(extra: { script?: string[]; connect?: string[]; frame?: string[] } = {}) {
  return [
    "default-src 'self'",
    // Next.js requires unsafe-eval para RSC streaming + unsafe-inline para
    // bootstrap script (con nonce sería ideal pero requiere refactor Layouts).
    // Tracked en docs/security-threat-model.md como hardening futuro.
    ["script-src 'self' 'unsafe-inline' 'unsafe-eval'", ...(extra.script ?? [])].join(" "),
    "style-src 'self' 'unsafe-inline'",
    // Imágenes: self + Supabase Storage (configurable env) + data: para inline.
    [
      "img-src 'self' data: blob: https://*.supabase.co https://scontent.whatsapp.net https://scontent.cdninstagram.com",
      ...MEDIA_SUPABASE_LOCAL,
    ].join(" "),
    [
      "media-src 'self' https://*.supabase.co https://scontent.whatsapp.net",
      ...MEDIA_SUPABASE_LOCAL,
    ].join(" "),
    "font-src 'self' data:",
    `connect-src ${[...CONNECT_SRC, ...(extra.connect ?? [])].join(" ")}`,
    ...(extra.frame ? [`frame-src ${extra.frame.join(" ")}`] : []),
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Sólo `/ajustes`: el botón "Conectar WhatsApp" carga el SDK de Facebook
 * (`connect.facebook.net/en_US/sdk.js`, doc de Embedded Signup) y el SDK abre
 * el popup de Meta y usa iframes de facebook.com. Meta no publica la lista de
 * orígenes que necesita su SDK: estos tres salen de los dominios que nombra la
 * doc y del popup, y hay que confirmarlos en el navegador con la app real
 * (docs/meta/conectar-whatsapp.md). El resto del panel no los permite.
 */
const CSP_AJUSTES = directivasCsp({
  script: ["https://connect.facebook.net"],
  connect: ["https://www.facebook.com", "https://connect.facebook.net"],
  frame: ["https://www.facebook.com", "https://web.facebook.com", "https://staticxx.facebook.com"],
});

const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "interest-cohort=()",
      "payment=()",
      "usb=()",
    ].join(", "),
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Content-Security-Policy",
    value: directivasCsp(),
  },
];

/**
 * Next 16 bloquea el `distDir` con un lockfile (`experimental.lockDistDir`), así
 * que dos `next dev` sobre el mismo directorio no conviven: el segundo sale. El
 * stack local (`npm run dev:local`, puerto 3002) usa otro directorio vía
 * `NEXT_DIST_DIR` (lo setea `scripts/con-stack-local.mjs`) para correr junto al
 * `npm run dev` del dueño. Sin la variable queda el default `.next`.
 */
const DIST_DIR = process.env.NEXT_DIST_DIR?.trim() || undefined;

/**
 * Con otro distDir, `next dev` reescribe el tsconfig para sumarle los tipos de
 * ese directorio. El lanzador del stack local le pasa uno propio (ignorado por
 * git, extiende `tsconfig.json`) para que el trackeado no se toque.
 */
const TSCONFIG_PATH = process.env.NEXT_TSCONFIG_PATH?.trim() || undefined;

const nextConfig: NextConfig = {
  ...(DIST_DIR ? { distDir: DIST_DIR } : {}),
  ...(TSCONFIG_PATH ? { typescript: { tsconfigPath: TSCONFIG_PATH } } : {}),
  // Strict mode React 19+
  reactStrictMode: true,
  // Disable x-powered-by header (info leak)
  poweredByHeader: false,
  // El log de desarrollo imprimía los argumentos de las Server Actions, contraseñas incluidas.
  logging: { serverFunctions: false },
  // "Enviar imagen" de un flujo sube por Server Action una imagen de hasta
  // 5 MB (el tope de Meta, `imagenes-de-flujo.service.ts`); el default de
  // Next es 1 MB. El margen es para el multipart.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
      {
        // Va después: con dos reglas que ponen la misma clave, Next aplica la
        // última. Sólo cambia la CSP; el resto de los headers sigue igual.
        source: "/ajustes",
        headers: [{ key: "Content-Security-Policy", value: CSP_AJUSTES }],
      },
    ];
  },
};

export default nextConfig;
