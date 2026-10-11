import { PermissionDeniedError } from "@/lib/errors";
import type { UUID } from "@/types/entities";
import type {
  EstadoHistorial,
  ModoNumero,
  Sincronizacion,
  WhatsAppNumero,
} from "@/types/whatsapp-numeros";

export interface ConectarNumeroInput {
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  modo: ModoNumero;
  /** Ya cifrado (`lib/meta/token-cifrado.ts`). El repo nunca ve el token en claro. */
  token_cifrado: string;
}

/**
 * Los números conectados con el registro insertado. Dos clientes posibles:
 *
 *   - authed (panel, admin): `listar` y `conectar` (RPC security definer que
 *     exige admin). La RLS no le deja leer nada más.
 *   - service role (Inngest, envío): todo lo demás, incluido el token cifrado.
 *
 * Ver `supabase/migrations/20261011120000_whatsapp_numeros.sql`.
 */
export interface WhatsAppNumerosRepository {
  listar(): Promise<WhatsAppNumero[]>;
  conectar(input: ConectarNumeroInput): Promise<{ id: UUID; conectado_at: Date }>;
  buscar(phoneNumberId: string): Promise<WhatsAppNumero | null>;
  /** El token cifrado de un número en estado `conectado`; null si no hay. */
  tokenCifrado(phoneNumberId: string): Promise<string | null>;
  registrarVerificacion(
    phoneNumberId: string,
    v: { is_on_biz_app: boolean | null; platform_type: string | null },
  ): Promise<void>;
  /**
   * Toma la reserva de una sincronización (`*_pedido_at = now()` sólo si
   * estaba vacía). `false` = ya se pidió: Meta la acepta una sola vez.
   */
  reservarSincronizacion(phoneNumberId: string, tipo: Sincronizacion): Promise<boolean>;
  /** Meta la aceptó: guarda el `request_id` (lo pide soporte de Meta). */
  confirmarSincronizacion(
    phoneNumberId: string,
    tipo: Sincronizacion,
    requestId: string,
  ): Promise<void>;
  /** Meta la rechazó explícitamente (429): se puede volver a pedir. */
  liberarSincronizacion(phoneNumberId: string, tipo: Sincronizacion): Promise<void>;
  /** Texto para el admin. Nunca el token ni contenido de mensajes. */
  registrarError(phoneNumberId: string, mensaje: string): Promise<void>;
  /**
   * Estado del historial. `rechazado`, `vencido` y `completo` son finales: un
   * lote que llega tarde no los pisa.
   */
  actualizarHistorial(
    phoneNumberId: string,
    patch: { estado: EstadoHistorial; progreso?: number | null },
  ): Promise<void>;
}

export const ESTADOS_HISTORIAL_FINALES: readonly EstadoHistorial[] = [
  "rechazado",
  "vencido",
  "completo",
];

/** Largo máximo de `whatsapp_numeros.error` (check de la tabla). */
export const LARGO_MAXIMO_ERROR = 500;

export class InMemoryWhatsAppNumerosRepository implements WhatsAppNumerosRepository {
  readonly filas = new Map<string, WhatsAppNumero>();
  readonly tokens = new Map<string, string>();
  /** Simula el rol del que llama al RPC: `false` = no admin. */
  esAdmin = true;
  conectadoPor: UUID | null = null;
  private secuencia = 0;

  async listar(): Promise<WhatsAppNumero[]> {
    return [...this.filas.values()].map((f) => ({ ...f }));
  }

  async conectar(input: ConectarNumeroInput): Promise<{ id: UUID; conectado_at: Date }> {
    if (!this.esAdmin) {
      throw new PermissionDeniedError("solo un administrador puede conectar un numero");
    }
    const previo = this.filas.get(input.phone_number_id);
    this.secuencia += 1;
    const fila: WhatsAppNumero = {
      id:
        previo?.id ??
        (`00000000-0000-4000-8000-${String(this.secuencia).padStart(12, "0")}` as UUID),
      waba_id: input.waba_id,
      phone_number_id: input.phone_number_id,
      display_phone_number: input.display_phone_number,
      verified_name: input.verified_name,
      modo: input.modo,
      estado: "conectado",
      error: null,
      conectado_por: this.conectadoPor,
      conectado_at: new Date(),
      is_on_biz_app: null,
      platform_type: null,
      verificado_at: null,
      contactos_pedido_at: null,
      contactos_sincronizados_at: null,
      historial_pedido_at: null,
      historial_estado: "pendiente",
      historial_progreso: null,
    };
    this.filas.set(input.phone_number_id, fila);
    this.tokens.set(input.phone_number_id, input.token_cifrado);
    return { id: fila.id, conectado_at: fila.conectado_at };
  }

  async buscar(phoneNumberId: string): Promise<WhatsAppNumero | null> {
    const f = this.filas.get(phoneNumberId);
    return f ? { ...f } : null;
  }

  async tokenCifrado(phoneNumberId: string): Promise<string | null> {
    const f = this.filas.get(phoneNumberId);
    if (!f || f.estado !== "conectado") return null;
    return this.tokens.get(phoneNumberId) ?? null;
  }

  async registrarVerificacion(
    phoneNumberId: string,
    v: { is_on_biz_app: boolean | null; platform_type: string | null },
  ): Promise<void> {
    this.editar(phoneNumberId, (f) => ({ ...f, ...v, verificado_at: new Date() }));
  }

  async reservarSincronizacion(phoneNumberId: string, tipo: Sincronizacion): Promise<boolean> {
    const f = this.filas.get(phoneNumberId);
    if (!f) return false;
    const campo = tipo === "contactos" ? "contactos_pedido_at" : "historial_pedido_at";
    if (f[campo] !== null) return false;
    this.filas.set(phoneNumberId, { ...f, [campo]: new Date() });
    return true;
  }

  async confirmarSincronizacion(
    phoneNumberId: string,
    tipo: Sincronizacion,
    _requestId: string,
  ): Promise<void> {
    this.editar(phoneNumberId, (f) =>
      tipo === "contactos"
        ? { ...f, contactos_sincronizados_at: new Date() }
        : {
            ...f,
            historial_estado: ESTADOS_HISTORIAL_FINALES.includes(f.historial_estado)
              ? f.historial_estado
              : "pedido",
          },
    );
  }

  async liberarSincronizacion(phoneNumberId: string, tipo: Sincronizacion): Promise<void> {
    const campo = tipo === "contactos" ? "contactos_pedido_at" : "historial_pedido_at";
    this.editar(phoneNumberId, (f) => ({ ...f, [campo]: null }));
  }

  async registrarError(phoneNumberId: string, mensaje: string): Promise<void> {
    this.editar(phoneNumberId, (f) => ({ ...f, error: mensaje.slice(0, LARGO_MAXIMO_ERROR) }));
  }

  async actualizarHistorial(
    phoneNumberId: string,
    patch: { estado: EstadoHistorial; progreso?: number | null },
  ): Promise<void> {
    this.editar(phoneNumberId, (f) =>
      ESTADOS_HISTORIAL_FINALES.includes(f.historial_estado)
        ? f
        : {
            ...f,
            historial_estado: patch.estado,
            ...(patch.progreso !== undefined ? { historial_progreso: patch.progreso } : {}),
          },
    );
  }

  private editar(phoneNumberId: string, fn: (f: WhatsAppNumero) => WhatsAppNumero): void {
    const f = this.filas.get(phoneNumberId);
    if (f) this.filas.set(phoneNumberId, fn(f));
  }
}
