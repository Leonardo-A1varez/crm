/** `1536` -> `1,5 KB`. Para la tarjeta de un documento; `null` queda vacío. */
export function bytesLegibles(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "";
  const unidades = ["B", "KB", "MB", "GB"] as const;
  let valor = bytes;
  let u = 0;
  while (valor >= 1024 && u < unidades.length - 1) {
    valor /= 1024;
    u += 1;
  }
  const redondeado = u === 0 ? Math.round(valor) : Math.round(valor * 10) / 10;
  return `${String(redondeado).replace(".", ",")} ${unidades[u]}`;
}
