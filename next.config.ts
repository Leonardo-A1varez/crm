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
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-eval para RSC streaming + unsafe-inline para
      // bootstrap script (con nonce sería ideal pero requiere refactor Layouts).
      // Tracked en docs/security-threat-model.md como hardening futuro.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // Imágenes: self + Supabase Storage (configurable env) + data: para inline.
      "img-src 'self' data: blob: https://*.supabase.co https://scontent.whatsapp.net https://scontent.cdninstagram.com",
      "media-src 'self' https://*.supabase.co https://scontent.whatsapp.net",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://api.openai.com https://graph.facebook.com wss://*.supabase.co",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Strict mode React 19+
  reactStrictMode: true,
  // Disable x-powered-by header (info leak)
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
