import { mapPostgrestError } from "@/server/db/postgrest-errors";
import {
  ESTADOS_HISTORIAL_FINALES,
  LARGO_MAXIMO_ERROR,
  type ConectarNumeroInput,
  type WhatsAppNumerosRepository,
} from "./whatsapp-numeros.repo";
import type { AppClient } from "@/server/db/client";
import type { Database } from "@/server/db/types.gen";
import type { UUID } from "@/types/entities";
import {
  ESTADO_HISTORIAL,
  ESTADO_NUMERO,
  MODO_NUMERO,
  type EstadoHistorial,
  type Sincronizacion,
  type WhatsAppNumero,
} from "@/types/whatsapp-numeros";

type Row = Database["public"]["Tables"]["whatsapp_numeros"]["Row"];

/** Columnas explícitas: el panel nunca pide `*` (ver la migración). */
const COLUMNAS =
  "id, waba_id, phone_number_id, display_phone_number, verified_name, modo, estado, error, " +
  "conectado_por, conectado_at, is_on_biz_app, platform_type, verificado_at, " +
  "contactos_pedido_at, contactos_sincronizados_at, historial_pedido_at, historial_estado, " +
  "historial_progreso";

const RECURSO = { resource: "whatsapp_numeros" } as const;

/**
 * Supabase impl. Con el client authed del admin sólo funcionan `listar` y
 * `conectar`; el resto es del backend (service role). Ver la interfaz.
 */
export class SupabaseWhatsAppNumerosRepository implements WhatsAppNumerosRepository {
  constructor(private readonly db: AppClient) {}

  async listar(): Promise<WhatsAppNumero[]> {
    const { data, error } = await this.db
      .from("whatsapp_numeros")
      .select(COLUMNAS)
      .order("conectado_at", { ascending: false })
      .range(0, 199);
    if (error) throw mapPostgrestError(error, RECURSO);
    return ((data ?? []) as unknown as Row[]).map(mapRow);
  }

  async conectar(input: ConectarNumeroInput): Promise<{ id: UUID; conectado_at: Date }> {
    const { data, error } = await this.db.rpc("whatsapp_numero_conectar", {
      p_waba_id: input.waba_id,
      p_phone_number_id: input.phone_number_id,
      p_display_phone_number: input.display_phone_number ?? "",
      p_verified_name: input.verified_name ?? "",
      p_modo: input.modo,
      p_token_cifrado: input.token_cifrado,
    });
    if (error) throw mapPostgrestError(error, RECURSO);
    const fila = (data ?? [])[0];
    if (!fila) throw mapPostgrestError({ code: "PGRST116", message: "sin fila" }, RECURSO);
    return { id: fila.id as UUID, conectado_at: new Date(fila.conectado_at) };
  }

  async buscar(phoneNumberId: string): Promise<WhatsAppNumero | null> {
    const { data, error } = await this.db
      .from("whatsapp_numeros")
      .select(COLUMNAS)
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, RECURSO);
    return data ? mapRow(data as unknown as Row) : null;
  }

  async tokenCifrado(phoneNumberId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("whatsapp_numeros_credenciales")
      .select("token_cifrado, whatsapp_numeros!inner(estado)")
      .eq("phone_number_id", phoneNumberId)
      .eq("whatsapp_numeros.estado", "conectado")
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "whatsapp_numeros_credenciales" });
    return data?.token_cifrado ?? null;
  }

  async registrarVerificacion(
    phoneNumberId: string,
    v: { is_on_biz_app: boolean | null; platform_type: string | null },
  ): Promise<void> {
    await this.actualizar(phoneNumberId, {
      is_on_biz_app: v.is_on_biz_app,
      platform_type: v.platform_type,
      verificado_at: new Date().toISOString(),
    });
  }

  async reservarSincronizacion(phoneNumberId: string, tipo: Sincronizacion): Promise<boolean> {
    const campo = tipo === "contactos" ? "contactos_pedido_at" : "historial_pedido_at";
    const ahora = new Date().toISOString();
    const patch: Database["public"]["Tables"]["whatsapp_numeros"]["Update"] =
      tipo === "contactos"
        ? { contactos_pedido_at: ahora, updated_at: ahora }
        : { historial_pedido_at: ahora, updated_at: ahora };
    // CAS: sólo la toma quien la encuentra vacía. Dos reintentos a la vez no
    // la piden dos veces.
    const { data, error } = await this.db
      .from("whatsapp_numeros")
      .update(patch)
      .eq("phone_number_id", phoneNumberId)
      .is(campo, null)
      .select("id");
    if (error) throw mapPostgrestError(error, RECURSO);
    return (data ?? []).length === 1;
  }

  async confirmarSincronizacion(
    phoneNumberId: string,
    tipo: Sincronizacion,
    requestId: string,
  ): Promise<void> {
    if (tipo === "contactos") {
      await this.actualizar(phoneNumberId, {
        contactos_sincronizados_at: new Date().toISOString(),
        contactos_request_id: requestId,
      });
      return;
    }
    await this.actualizar(phoneNumberId, { historial_request_id: requestId });
    await this.actualizarHistorial(phoneNumberId, { estado: "pedido" });
  }

  async liberarSincronizacion(phoneNumberId: string, tipo: Sincronizacion): Promise<void> {
    await this.actualizar(
      phoneNumberId,
      tipo === "contactos" ? { contactos_pedido_at: null } : { historial_pedido_at: null },
    );
  }

  async registrarError(phoneNumberId: string, mensaje: string): Promise<void> {
    await this.actualizar(phoneNumberId, { error: mensaje.slice(0, LARGO_MAXIMO_ERROR) });
  }

  async actualizarHistorial(
    phoneNumberId: string,
    patch: { estado: EstadoHistorial; progreso?: number | null },
  ): Promise<void> {
    const { error } = await this.db
      .from("whatsapp_numeros")
      .update({
        historial_estado: patch.estado,
        ...(patch.progreso !== undefined ? { historial_progreso: patch.progreso } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("phone_number_id", phoneNumberId)
      // Los finales no se pisan con un lote que llega tarde.
      .not("historial_estado", "in", `(${ESTADOS_HISTORIAL_FINALES.join(",")})`);
    if (error) throw mapPostgrestError(error, RECURSO);
  }

  private async actualizar(
    phoneNumberId: string,
    patch: Database["public"]["Tables"]["whatsapp_numeros"]["Update"],
  ): Promise<void> {
    const { error } = await this.db
      .from("whatsapp_numeros")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("phone_number_id", phoneNumberId);
    if (error) throw mapPostgrestError(error, RECURSO);
  }
}

function fecha(v: string | null): Date | null {
  return v === null ? null : new Date(v);
}

function deLista<T extends string>(lista: readonly T[], v: string, porDefecto: T): T {
  return (lista as readonly string[]).includes(v) ? (v as T) : porDefecto;
}

function mapRow(r: Row): WhatsAppNumero {
  return {
    id: r.id as UUID,
    waba_id: r.waba_id,
    phone_number_id: r.phone_number_id,
    display_phone_number: r.display_phone_number,
    verified_name: r.verified_name,
    modo: deLista(MODO_NUMERO, r.modo, "cloud"),
    estado: deLista(ESTADO_NUMERO, r.estado, "error"),
    error: r.error,
    conectado_por: r.conectado_por as UUID | null,
    conectado_at: new Date(r.conectado_at),
    is_on_biz_app: r.is_on_biz_app,
    platform_type: r.platform_type,
    verificado_at: fecha(r.verificado_at),
    contactos_pedido_at: fecha(r.contactos_pedido_at),
    contactos_sincronizados_at: fecha(r.contactos_sincronizados_at),
    historial_pedido_at: fecha(r.historial_pedido_at),
    historial_estado: deLista(ESTADO_HISTORIAL, r.historial_estado, "error"),
    historial_progreso: r.historial_progreso,
  };
}
