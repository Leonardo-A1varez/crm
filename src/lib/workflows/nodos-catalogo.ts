/**
 * Catálogo de nodos de la paleta del editor de workflows.
 *
 * Es el vocabulario que la UI le ofrece a quien arma un flujo — 57 tipos
 * repartidos en 7 categorías. Vive separado de `catalogo.ts` (el vocabulario
 * que el motor sabe ejecutar: disparadores/acciones reales de
 * `src/inngest/bootstrap.ts`) porque todavía no hay 1:1 entre ambos: agregar
 * un nodo acá lo hace aparecer arrastrable en el canvas, no lo hace ejecutar
 * nada. La integración nodo-de-paleta → acción-del-motor es trabajo de otro
 * stream.
 */

import {
  MessageSquare,
  Webhook,
  Clock,
  Play,
  Tag,
  GitBranch,
  UserPlus,
  Users,
  FileText,
  Send,
  LayoutGrid,
  List,
  Image,
  File,
  MapPin,
  Heart,
  CirclePlus,
  CircleMinus,
  CircleX,
  User,
  RefreshCw,
  Edit,
  CheckSquare,
  StickyNote,
  Ban,
  Archive,
  Headset,
  GitMerge,
  CheckCircle,
  MessageCircle,
  Radio,
  Repeat,
  Box,
  CornerDownRight,
  Square,
  AlertTriangle,
  Globe,
  Code,
  Mail,
  Sheet,
  Database,
  Brain,
  Bot,
  FileSearch,
  Smile,
  Languages,
  ShieldAlert,
  Handshake,
  Bell,
  Bug,
  Megaphone,
  UsersRound,
  UserMinus,
  Hourglass,
  Split,
  type LucideIcon,
} from "lucide-react";

export interface NodoCatalogo {
  tipo: string;
  nombre: string;
  icono: LucideIcon;
  descripcion: string;
}

export interface CategoriaNodos {
  id: string;
  nombre: string;
  /** Color de acento de la categoría (hex), usado en el header y el badge. */
  color: string;
  nodos: NodoCatalogo[];
}

export const CATEGORIAS_NODOS: CategoriaNodos[] = [
  {
    id: "triggers",
    nombre: "Triggers",
    color: "#10b981",
    nodos: [
      {
        tipo: "trigger_mensaje",
        nombre: "Mensaje recibido",
        icono: MessageSquare,
        descripcion: "Cuando un lead envía un mensaje",
      },
      {
        tipo: "trigger_webhook",
        nombre: "Webhook",
        icono: Webhook,
        descripcion: "Petición HTTP externa",
      },
      {
        tipo: "trigger_cron",
        nombre: "Programado",
        icono: Clock,
        descripcion: "A una hora o intervalo",
      },
      { tipo: "trigger_manual", nombre: "Manual", icono: Play, descripcion: "Ejecutar a mano" },
      {
        tipo: "trigger_etiqueta",
        nombre: "Etiqueta asignada",
        icono: Tag,
        descripcion: "Cuando recibe etiqueta",
      },
      {
        tipo: "trigger_etiqueta_removida",
        nombre: "Etiqueta removida",
        icono: CircleX,
        descripcion: "Cuando pierde etiqueta",
      },
      {
        tipo: "trigger_etapa",
        nombre: "Etapa cambiada",
        icono: GitBranch,
        descripcion: "Cambio de etapa",
      },
      {
        tipo: "trigger_lead_creado",
        nombre: "Lead creado",
        icono: UserPlus,
        descripcion: "Nuevo lead",
      },
      {
        tipo: "trigger_vendedor_asignado",
        nombre: "Vendedor asignado",
        icono: Users,
        descripcion: "Asignación de vendedor",
      },
      {
        tipo: "trigger_inactividad",
        nombre: "Inactividad",
        icono: Clock,
        descripcion: "Sin respuesta por X tiempo",
      },
      {
        tipo: "trigger_formulario",
        nombre: "Formulario",
        icono: FileText,
        descripcion: "Form web enviado",
      },
      {
        tipo: "trigger_difusion_respondida",
        nombre: "Difusión respondida",
        icono: Megaphone,
        descripcion: "Cuando contesta una difusión",
      },
    ],
  },
  {
    id: "mensajeria",
    nombre: "Mensajería",
    color: "#3b82f6",
    nodos: [
      {
        tipo: "msg_texto",
        nombre: "Enviar mensaje",
        icono: Send,
        descripcion: "Mensaje de texto",
      },
      {
        tipo: "msg_botones",
        nombre: "Mensaje con botones",
        icono: LayoutGrid,
        descripcion: "Opciones clickeables",
      },
      {
        tipo: "msg_lista",
        nombre: "Mensaje de lista",
        icono: List,
        descripcion: "Lista desplegable WA",
      },
      {
        tipo: "msg_imagen",
        nombre: "Enviar imagen",
        icono: Image,
        descripcion: "Imagen con caption",
      },
      {
        tipo: "msg_documento",
        nombre: "Enviar documento",
        icono: File,
        descripcion: "PDF, Excel, etc",
      },
      {
        tipo: "msg_ubicacion",
        nombre: "Enviar ubicación",
        icono: MapPin,
        descripcion: "Ubicación en mapa",
      },
      {
        tipo: "msg_plantilla",
        nombre: "Plantilla HSM",
        icono: FileText,
        descripcion: "Template aprobado",
      },
      { tipo: "msg_reaccion", nombre: "Reacción", icono: Heart, descripcion: "Emoji en mensaje" },
    ],
  },
  {
    id: "crm",
    nombre: "CRM",
    color: "#8b5cf6",
    nodos: [
      {
        tipo: "crm_etiqueta_add",
        nombre: "Asignar etiqueta",
        icono: CirclePlus,
        descripcion: "Agregar etiqueta",
      },
      {
        tipo: "crm_etiqueta_remove",
        nombre: "Remover etiqueta",
        icono: CircleMinus,
        descripcion: "Quitar etiqueta",
      },
      {
        tipo: "crm_etapa",
        nombre: "Cambiar etapa",
        icono: GitBranch,
        descripcion: "Mover en pipeline",
      },
      {
        tipo: "crm_vendedor",
        nombre: "Asignar vendedor",
        icono: User,
        descripcion: "Asignar específico",
      },
      {
        tipo: "crm_round_robin",
        nombre: "Round Robin",
        icono: RefreshCw,
        descripcion: "Rotar vendedores",
      },
      {
        tipo: "crm_campo",
        nombre: "Actualizar campo del Twin",
        icono: Edit,
        descripcion: "Escribe un dato de la ficha",
      },
      {
        tipo: "crm_tarea",
        nombre: "Crear tarea",
        icono: CheckSquare,
        descripcion: "Tarea de seguimiento",
      },
      {
        tipo: "crm_nota",
        nombre: "Agregar nota",
        icono: StickyNote,
        descripcion: "Nota en conversación",
      },
      { tipo: "crm_spam", nombre: "Marcar spam", icono: Ban, descripcion: "Lead como spam" },
      { tipo: "crm_archivar", nombre: "Archivar", icono: Archive, descripcion: "Archivar lead" },
      {
        tipo: "crm_escalar_humano",
        nombre: "Escalar a humano",
        icono: Headset,
        descripcion: "Pausa la IA y lo pasa a una persona",
      },
    ],
  },
  {
    id: "logica",
    nombre: "Lógica",
    color: "#f59e0b",
    nodos: [
      {
        tipo: "logica_condicion",
        nombre: "Condición (IF)",
        icono: GitBranch,
        descripcion: "Si X entonces...",
      },
      {
        tipo: "logica_switch",
        nombre: "Según el valor",
        icono: GitMerge,
        descripcion: "Una rama por valor",
      },
      {
        tipo: "logica_validacion",
        nombre: "Validación",
        icono: CheckCircle,
        descripcion: "Validar y continuar/fallar",
      },
      {
        tipo: "logica_esperar",
        nombre: "Esperar tiempo",
        icono: Clock,
        descripcion: "Pausar X tiempo",
      },
      {
        tipo: "logica_esperar_respuesta",
        nombre: "Esperar respuesta",
        icono: MessageCircle,
        descripcion: "Hasta que responda",
      },
      {
        tipo: "logica_esperar_evento",
        nombre: "Esperar evento",
        icono: Radio,
        descripcion: "Hasta que ocurra",
      },
      { tipo: "logica_loop", nombre: "Loop", icono: Repeat, descripcion: "Iterar lista" },
      { tipo: "logica_grupo", nombre: "Agrupar", icono: Box, descripcion: "Grupo visual" },
      {
        tipo: "logica_goto",
        nombre: "Ir a",
        icono: CornerDownRight,
        descripcion: "Salta a otro paso",
      },
      {
        tipo: "logica_detener",
        nombre: "Detener",
        icono: Square,
        descripcion: "Terminar workflow",
      },
      {
        tipo: "logica_error",
        nombre: "Error handler",
        icono: AlertTriangle,
        descripcion: "Capturar errores",
      },
    ],
  },
  {
    id: "integraciones",
    nombre: "Integraciones",
    color: "#06b6d4",
    nodos: [
      { tipo: "int_http", nombre: "HTTP Request", icono: Globe, descripcion: "Llamada API" },
      {
        tipo: "int_webhook_out",
        nombre: "Webhook saliente",
        icono: Send,
        descripcion: "Notificar externo",
      },
      { tipo: "int_codigo", nombre: "Código JS", icono: Code, descripcion: "JavaScript custom" },
      { tipo: "int_email", nombre: "Enviar email", icono: Mail, descripcion: "Email SMTP" },
      {
        tipo: "int_sheets",
        nombre: "Google Sheets",
        icono: Sheet,
        descripcion: "Leer/escribir",
      },
      { tipo: "int_db", nombre: "Base de datos", icono: Database, descripcion: "Query SQL" },
    ],
  },
  {
    id: "ia",
    nombre: "IA",
    color: "#ec4899",
    nodos: [
      {
        tipo: "ia_clasificar",
        nombre: "Clasificar intent",
        icono: Brain,
        descripcion: "Detectar intención",
      },
      {
        tipo: "ia_responder",
        nombre: "Generar respuesta",
        icono: Bot,
        descripcion: "Respuesta IA",
      },
      {
        tipo: "ia_extraer",
        nombre: "Extraer datos",
        icono: FileSearch,
        descripcion: "Info estructurada",
      },
      {
        tipo: "ia_sentimiento",
        nombre: "Sentimiento",
        icono: Smile,
        descripcion: "Emoción del mensaje",
      },
      {
        tipo: "ia_resumir",
        nombre: "Resumir",
        icono: FileText,
        descripcion: "Resumen conversación",
      },
      {
        tipo: "ia_traducir",
        nombre: "Traducir",
        icono: Languages,
        descripcion: "Traducir mensaje",
      },
      {
        tipo: "ia_spam",
        nombre: "Verificar spam",
        icono: ShieldAlert,
        descripcion: "Detectar spam",
      },
      {
        tipo: "ia_delegar",
        nombre: "Delegar al agente",
        icono: Handshake,
        descripcion: "Le cede un tramo al agente",
      },
    ],
  },
  {
    id: "internos",
    nombre: "Internos",
    color: "#6b7280",
    nodos: [
      {
        tipo: "int_notif_vendedor",
        nombre: "Avisar al equipo",
        icono: Bell,
        descripcion: "Aviso en el panel al vendedor asignado o a los admins",
      },
      {
        tipo: "int_notif_grupo",
        nombre: "Notificar grupo",
        icono: Users,
        descripcion: "Aviso a canal",
      },
      {
        tipo: "int_comentario",
        nombre: "Comentario interno",
        icono: MessageSquare,
        descripcion: "Solo visible interno",
      },
      { tipo: "int_debug", nombre: "Log/Debug", icono: Bug, descripcion: "Para debugging" },
    ],
  },
  {
    id: "difusion",
    nombre: "Difusión",
    color: "#a9700c",
    nodos: [
      {
        tipo: "dif_audiencia",
        nombre: "Definir audiencia",
        icono: UsersRound,
        descripcion: "Arma el grupo de destinatarios",
      },
      {
        tipo: "dif_enviar",
        nombre: "Enviar difusión",
        icono: Megaphone,
        descripcion: "Manda a ese grupo",
      },
      {
        tipo: "dif_excluir",
        nombre: "Excluir",
        icono: UserMinus,
        descripcion: "Saca gente del grupo",
      },
      {
        tipo: "dif_esperar_respuesta",
        nombre: "Esperar respuesta de difusión",
        icono: Hourglass,
        descripcion: "Espera a que contesten",
      },
      {
        tipo: "dif_dividir",
        nombre: "Dividir audiencia",
        icono: Split,
        descripcion: "Prueba A/B con grupo de control",
      },
    ],
  },
];

export interface ResultadoBusquedaNodo {
  categoria: CategoriaNodos;
  nodo: NodoCatalogo;
}

/** Busca por nombre o descripción, case-insensitive, aplanando las categorías. */
export function buscarNodos(query: string): ResultadoBusquedaNodo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const resultados: ResultadoBusquedaNodo[] = [];
  for (const categoria of CATEGORIAS_NODOS) {
    for (const nodo of categoria.nodos) {
      if (nodo.nombre.toLowerCase().includes(q) || nodo.descripcion.toLowerCase().includes(q)) {
        resultados.push({ categoria, nodo });
      }
    }
  }
  return resultados;
}
