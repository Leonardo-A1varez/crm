import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(PREFIX)) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const providedHex = signatureHeader.slice(PREFIX.length);

  if (providedHex.length !== expectedHex.length) return false;

  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHex, "hex");
    providedBuf = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
