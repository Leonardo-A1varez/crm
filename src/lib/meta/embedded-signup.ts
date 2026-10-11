/**
 * Lo que el navegador necesita del registro insertado de Meta (Embedded
 * Signup v4, coexistencia). Puro: sin `window`, para poder probarlo.
 *
 * Fuentes (leídas el 2026-10-11, ver docs/meta/conectar-whatsapp.md):
 *   - embedded-signup/implementation: `FB.login` con `config_id`,
 *     `response_type: 'code'`, `override_default_response_type: true`; el
 *     popup avisa por `postMessage` con `type: 'WA_EMBEDDED_SIGNUP'`.
 *   - custom-flows/onboarding-business-app-users: `extras` con
 *     `featureType: 'whatsapp_business_app_onboarding'` y
 *     `sessionInfoVersion: '3'`; el éxito es
 *     `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` con `data.waba_id` (sin
 *     `phone_number_id`).
 */

export const EXTRAS_COEXISTENCIA = {
  setup: {},
  featureType: "whatsapp_business_app_onboarding",
  sessionInfoVersion: "3",
} as const;

export interface OpcionesFbLogin {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: typeof EXTRAS_COEXISTENCIA;
}

export function opcionesDeLogin(configId: string): OpcionesFbLogin {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: EXTRAS_COEXISTENCIA,
  };
}

export type MensajeEmbeddedSignup =
  | {
      tipo: "exito";
      evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" | "FINISH";
      wabaId: string;
      phoneNumberId: string | null;
    }
  | { tipo: "cancelado"; paso: string | null }
  | { tipo: "error"; mensaje: string; codigo: string | null };

const ID_META = /^\d{1,30}$/;

/**
 * El origen tiene que ser facebook.com o un subdominio, por https. La doc de
 * Meta usa `event.origin.endsWith('facebook.com')`, que también aceptaría
 * `https://evilfacebook.com`: acá se compara el host entero.
 */
function origenDeFacebook(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.protocol === "https:" &&
      (u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"))
    );
  } catch {
    return false;
  }
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Lee un `message` de la ventana. `null` = no es del registro insertado (otro
 * origen, otro tipo, o algo que no se entiende): se ignora sin romper nada.
 */
export function leerMensajeEmbeddedSignup(
  origin: string,
  data: unknown,
): MensajeEmbeddedSignup | null {
  if (!origenDeFacebook(origin)) return null;
  let json: unknown = data;
  if (typeof data === "string") {
    try {
      json = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!json || typeof json !== "object") return null;
  const m = json as Record<string, unknown>;
  if (m.type !== "WA_EMBEDDED_SIGNUP") return null;
  const d = m.data && typeof m.data === "object" ? (m.data as Record<string, unknown>) : {};

  if (m.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || m.event === "FINISH") {
    const wabaId = texto(d.waba_id);
    const phone = texto(d.phone_number_id);
    if (!wabaId || !ID_META.test(wabaId)) return null;
    if (phone !== null && !ID_META.test(phone)) return null;
    return { tipo: "exito", evento: m.event, wabaId, phoneNumberId: phone };
  }

  // La doc lista `ERROR` como evento pero su ejemplo de error viene con
  // `CANCEL` y `error_message`: se manejan las dos formas.
  const mensajeError = texto(d.error_message);
  if (m.event === "ERROR" || mensajeError) {
    return {
      tipo: "error",
      mensaje: mensajeError ?? "Meta informó un error en el registro.",
      codigo:
        texto(d.error_code) ?? (typeof d.error_code === "number" ? String(d.error_code) : null),
    };
  }
  if (m.event === "CANCEL") return { tipo: "cancelado", paso: texto(d.current_step) };
  return null;
}
