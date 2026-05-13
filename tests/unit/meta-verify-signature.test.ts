import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { verifyMetaSignature } from "@/lib/meta/verify-signature";

const SECRET = "test-app-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyMetaSignature", () => {
  test("firma correcta retorna true", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });

  test("body modificado retorna false", () => {
    const body = '{"object":"x"}';
    const signature = sign(body);
    expect(verifyMetaSignature('{"object":"y"}', signature, SECRET)).toBe(false);
  });

  test("secret incorrecto retorna false", () => {
    const body = "abc";
    expect(verifyMetaSignature(body, sign(body, "otro-secret"), SECRET)).toBe(false);
  });

  test("header null retorna false", () => {
    expect(verifyMetaSignature("body", null, SECRET)).toBe(false);
  });

  test("header sin prefijo sha256= retorna false", () => {
    const body = "x";
    const hex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyMetaSignature(body, hex, SECRET)).toBe(false);
  });

  test("header con length distinta retorna false sin throw", () => {
    expect(verifyMetaSignature("x", "sha256=abc", SECRET)).toBe(false);
  });

  test("header con hex invalido retorna false sin throw", () => {
    expect(() =>
      verifyMetaSignature(
        "x",
        "sha256=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        SECRET,
      ),
    ).not.toThrow();
    expect(
      verifyMetaSignature(
        "x",
        "sha256=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        SECRET,
      ),
    ).toBe(false);
  });

  test("body vacio firmado correctamente retorna true", () => {
    expect(verifyMetaSignature("", sign(""), SECRET)).toBe(true);
  });
});
