import type { WhatsAppNumero } from "@/types/whatsapp-numeros";

/**
 * Lo que la sección "Conectar WhatsApp" muestra de cada número conectado.
 * Puro y sólo texto: lo arma la página (servidor) y lo dibuja un componente
 * cliente, así que no puede llevar componentes ni fechas.
 *
 * Los tres pasos son una secuencia real (Meta pide contactos y después
 * historial, los dos dentro de las 24 h de la conexión): por eso van en orden.
 */
export type EstadoPaso = "pendiente" | "en_curso" | "ok" | "omitido" | "error";

export interface PasoConexion {
  clave: "verificacion" | "contactos" | "historial";
  titulo: string;
  estado: EstadoPaso;
  detalle: string;
}

export interface NumeroConectadoVista {
  phoneNumberId: string;
  numero: string;
  nombre: string | null;
  modo: string;
  /** El número ya no se usa para mandar. */
  desconectado: boolean;
  pasos: PasoConexion[];
  error: string | null;
}

const VENTANA_MS = 24 * 3600_000;

export function vistaNumeroConectado(n: WhatsAppNumero, ahora: Date): NumeroConectadoVista {
  const coexistencia = n.modo === "coexistencia";
  const vencido = ahora.getTime() > n.conectado_at.getTime() + VENTANA_MS;

  return {
    phoneNumberId: n.phone_number_id,
    numero: n.display_phone_number ?? n.phone_number_id,
    nombre: n.verified_name,
    modo: coexistencia ? "App Business + API" : "Solo Cloud API",
    desconectado: n.estado === "desconectado",
    pasos: coexistencia
      ? [verificacion(n), contactos(n, vencido), historial(n)]
      : [
          {
            clave: "verificacion",
            titulo: "Número",
            estado: "ok",
            detalle: "Cloud API (el registro del número se hace en Meta)",
          },
          {
            clave: "contactos",
            titulo: "Contactos",
            estado: "omitido",
            detalle: "Sólo en coexistencia",
          },
          {
            clave: "historial",
            titulo: "Historial",
            estado: "omitido",
            detalle: "Sólo en coexistencia",
          },
        ],
    error: n.error,
  };
}

function verificacion(n: WhatsAppNumero): PasoConexion {
  const base = { clave: "verificacion", titulo: "Coexistencia" } as const;
  if (n.verificado_at === null)
    return { ...base, estado: "pendiente", detalle: "Esperando a Meta" };
  if (n.is_on_biz_app === true && n.platform_type === "CLOUD_API") {
    return { ...base, estado: "ok", detalle: "App Business y Cloud API" };
  }
  return { ...base, estado: "error", detalle: "Meta no confirma que siga en la app" };
}

function contactos(n: WhatsAppNumero, vencido: boolean): PasoConexion {
  const base = { clave: "contactos", titulo: "Contactos" } as const;
  if (n.contactos_sincronizados_at !== null)
    return { ...base, estado: "ok", detalle: "Pedidos a Meta" };
  if (n.contactos_pedido_at !== null) {
    return n.error
      ? { ...base, estado: "error", detalle: "No se pudieron pedir" }
      : { ...base, estado: "en_curso", detalle: "Pidiendo a Meta" };
  }
  if (vencido) return { ...base, estado: "error", detalle: "Vencido (más de 24 h)" };
  return { ...base, estado: "pendiente", detalle: "Todavía no se pidieron" };
}

function historial(n: WhatsAppNumero): PasoConexion {
  const base = { clave: "historial", titulo: "Historial" } as const;
  switch (n.historial_estado) {
    case "pendiente":
      return { ...base, estado: "pendiente", detalle: "Todavía no se pidió" };
    case "pedido":
      return { ...base, estado: "en_curso", detalle: "Pedido, esperando a Meta" };
    case "en_curso":
      return {
        ...base,
        estado: "en_curso",
        detalle:
          n.historial_progreso === null ? "Importando" : `Importando, ${n.historial_progreso} %`,
      };
    case "completo":
      return { ...base, estado: "ok", detalle: "Últimos 180 días importados" };
    case "rechazado":
      return { ...base, estado: "omitido", detalle: "El negocio no lo compartió" };
    case "vencido":
      return { ...base, estado: "error", detalle: "Vencido (más de 24 h)" };
    case "error":
      return { ...base, estado: "error", detalle: "No se pudo pedir" };
  }
}
