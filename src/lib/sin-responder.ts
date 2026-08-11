import type { Mensaje } from "@/types/entities";

export interface PendienteDeRespuesta {
  sinResponder: number;
  esperandoDesde: Date | null;
}

/**
 * Mensajes entrantes posteriores a la última respuesta nuestra.
 *
 * `sistema` se descarta a propósito aunque sea `out`: "sesión reasignada" no
 * es contestarle al cliente, y contarlo como respuesta apagaría el triage de
 * una conversación que sigue esperando.
 *
 * Vive en `lib/` y no en el servicio de Inbox porque la lista de Leads filtra
 * por lo mismo: dos cuentas distintas de "sin responder" harían que la bandeja
 * y el listado se contradijeran sobre el mismo lead.
 *
 * Espera el hilo en orden cronológico (viejo → nuevo), que es el que devuelve
 * `listBySessionId`.
 */
export function calcularSinResponder(mensajes: Mensaje[]): PendienteDeRespuesta {
  const pendientes: Mensaje[] = [];
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (!m) continue;
    if (m.direction === "out" && m.sender !== "sistema") break;
    if (m.direction === "in") pendientes.push(m);
  }
  const primero = pendientes[pendientes.length - 1];
  return { sinResponder: pendientes.length, esperandoDesde: primero?.created_at ?? null };
}
