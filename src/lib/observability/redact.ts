// PII redaction util para logs (regla §0.9 — Compliance Latam LGPD/etc).
// Reemplaza valores en keys sensibles con "[REDACTED]" sin mutar el input.
//
// Estrategia key-based: normaliza (lowercase + strip underscores) ambos lados
// para que `telefono`, `Telefono`, `TELEFONO`, `metaUserIds`, `meta_user_ids`
// matcheen el mismo set. Evita doblar entries snake/camel.
//
// Cycle detection: ancestors WeakSet con delete al salir del subtree, para
// distinguir refs ciclicas (ancestro) de refs compartidas (no-cycle).

const REDACTED = "[REDACTED]" as const;
const CIRCULAR = "[CIRCULAR]" as const;

// Keys derivadas del schema real CRM (16 migrations + types/entities.ts).
// Normalizadas: lowercase, sin underscores.
const DEFAULT_PII_KEYS_NORMALIZED = new Set<string>([
  // Contact
  "telefono",
  "phone",
  "email",
  "direccion",
  "address",
  // Identity (nombre redacted: combo con telefono/email leakea identidad)
  "nombre",
  "name",
  "rucnit", // tax ID Latam unificado: RUC/NIT/CUIT/RFC/CPF/CNPJ
  "taxid",
  // Content (free text con PII embedded por usuario)
  "body",
  "text",
  "content",
  "mensaje",
  "message",
  "consulta",
  "bloqueador",
  // Meta IDs (traceback cross-canal)
  "metauserids",
  "metamessageid",
  // Storage URLs (signed links exponen archivos privados)
  "comprobantepagourl",
  // Secrets
  "accesstoken",
  "password",
  "apikey",
  "secret",
]);

function normalize(key: string): string {
  return key.toLowerCase().replace(/_/g, "");
}

function isPiiKey(key: string, extra: Set<string>): boolean {
  const n = normalize(key);
  return DEFAULT_PII_KEYS_NORMALIZED.has(n) || extra.has(n);
}

export function redactPii(input: unknown, extraKeys: string[] = []): unknown {
  const extra = new Set(extraKeys.map(normalize));
  const ancestors = new WeakSet<object>();
  return walk(input, extra, ancestors);
}

function walk(value: unknown, extra: Set<string>, ancestors: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  const obj = value as object;
  if (ancestors.has(obj)) return CIRCULAR;
  ancestors.add(obj);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => walk(item, extra, ancestors));
  } else {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isPiiKey(key, extra)) {
        // Preservar null/undefined: redactarlos no revela nada y rompe semantica.
        out[key] = val === null || val === undefined ? val : REDACTED;
      } else {
        out[key] = walk(val, extra, ancestors);
      }
    }
    result = out;
  }

  ancestors.delete(obj);
  return result;
}
