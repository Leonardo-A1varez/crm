import { describe, expect, test } from "vitest";
import {
  EXTRAS_COEXISTENCIA,
  leerMensajeEmbeddedSignup,
  opcionesDeLogin,
} from "@/lib/meta/embedded-signup";

const exito = JSON.stringify({
  data: { waba_id: "102290129340398" },
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  version: 3,
});

describe("leerMensajeEmbeddedSignup", () => {
  test("coexistencia: el evento trae sólo waba_id (doc de Meta)", () => {
    expect(leerMensajeEmbeddedSignup("https://www.facebook.com", exito)).toEqual({
      tipo: "exito",
      evento: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      wabaId: "102290129340398",
      phoneNumberId: null,
    });
  });

  test("FINISH trae phone_number_id además", () => {
    const m = JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { phone_number_id: "106540352242922", waba_id: "102290129340398", business_id: "1" },
    });
    expect(leerMensajeEmbeddedSignup("https://web.facebook.com", m)).toMatchObject({
      tipo: "exito",
      evento: "FINISH",
      phoneNumberId: "106540352242922",
    });
  });

  test("otro origen se ignora, incluido uno que sólo termina en 'facebook.com'", () => {
    expect(leerMensajeEmbeddedSignup("https://evilfacebook.com", exito)).toBeNull();
    expect(leerMensajeEmbeddedSignup("http://www.facebook.com", exito)).toBeNull();
    expect(leerMensajeEmbeddedSignup("https://localhost:3002", exito)).toBeNull();
  });

  test("cancelado y error se distinguen; lo que no es del registro insertado se ignora", () => {
    expect(
      leerMensajeEmbeddedSignup(
        "https://www.facebook.com",
        JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "CANCEL",
          data: { current_step: "PHONE_NUMBER_SETUP" },
        }),
      ),
    ).toEqual({ tipo: "cancelado", paso: "PHONE_NUMBER_SETUP" });
    expect(
      leerMensajeEmbeddedSignup(
        "https://www.facebook.com",
        JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "CANCEL",
          data: { error_message: "Algo falló", error_code: "524126", session_id: "x" },
        }),
      ),
    ).toEqual({ tipo: "error", mensaje: "Algo falló", codigo: "524126" });
    expect(leerMensajeEmbeddedSignup("https://www.facebook.com", "no-json")).toBeNull();
    expect(
      leerMensajeEmbeddedSignup("https://www.facebook.com", JSON.stringify({ type: "OTRO" })),
    ).toBeNull();
  });

  test("un waba_id que no es numérico no pasa", () => {
    const m = JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: { waba_id: "1; drop" },
    });
    expect(leerMensajeEmbeddedSignup("https://www.facebook.com", m)).toBeNull();
  });
});

describe("opcionesDeLogin", () => {
  test("las opciones de FB.login de la doc de coexistencia", () => {
    expect(opcionesDeLogin("777")).toEqual({
      config_id: "777",
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    });
    expect(EXTRAS_COEXISTENCIA.featureType).toBe("whatsapp_business_app_onboarding");
  });
});
