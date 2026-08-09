export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          payload: Json
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_config: {
        Row: {
          activa: boolean
          creada_por: string | null
          created_at: string
          descuento_max_pct: number
          emojis: string
          horario: Json
          horario_timezone: string
          id: string
          instrucciones: string
          largo: string
          max_pasos_tool: number
          modelo: string
          nota: string | null
          plantilla_fuera_horario: string
          politica_tope: string
          rollback_de: string | null
          tono: string
          tope_gasto_diario_usd: number
          umbral_resumen_turnos: number
          ventana_contexto_mensajes: number
          version: number
        }
        Insert: {
          activa?: boolean
          creada_por?: string | null
          created_at?: string
          descuento_max_pct: number
          emojis: string
          horario: Json
          horario_timezone: string
          id?: string
          instrucciones?: string
          largo: string
          max_pasos_tool: number
          modelo: string
          nota?: string | null
          plantilla_fuera_horario?: string
          politica_tope: string
          rollback_de?: string | null
          tono: string
          tope_gasto_diario_usd: number
          umbral_resumen_turnos: number
          ventana_contexto_mensajes: number
          version: number
        }
        Update: {
          activa?: boolean
          creada_por?: string | null
          created_at?: string
          descuento_max_pct?: number
          emojis?: string
          horario?: Json
          horario_timezone?: string
          id?: string
          instrucciones?: string
          largo?: string
          max_pasos_tool?: number
          modelo?: string
          nota?: string | null
          plantilla_fuera_horario?: string
          politica_tope?: string
          rollback_de?: string | null
          tono?: string
          tope_gasto_diario_usd?: number
          umbral_resumen_turnos?: number
          ventana_contexto_mensajes?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agente_config_creada_por_fkey"
            columns: ["creada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agente_config_rollback_de_fkey"
            columns: ["rollback_de"]
            isOneToOne: false
            referencedRelation: "agente_config"
            referencedColumns: ["id"]
          },
        ]
      }
      conversaciones: {
        Row: {
          canal: Database["public"]["Enums"]["canal_enum"]
          canal_thread_id: string
          created_at: string
          id: string
          lead_id: string
          ultima_actividad_at: string
        }
        Insert: {
          canal: Database["public"]["Enums"]["canal_enum"]
          canal_thread_id: string
          created_at?: string
          id?: string
          lead_id: string
          ultima_actividad_at?: string
        }
        Update: {
          canal?: Database["public"]["Enums"]["canal_enum"]
          canal_thread_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          ultima_actividad_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversaciones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          created_at: string
          id: string
          nombre: string
          ruc_nit: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          nombre: string
          ruc_nit?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          nombre?: string
          ruc_nit?: string | null
        }
        Relationships: []
      }
      event_outbox: {
        Row: {
          attempts: number
          created_at: string
          event_data: Json
          event_id: string | null
          event_name: string
          id: string
          last_error: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_data?: Json
          event_id?: string | null
          event_name: string
          id?: string
          last_error?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_data?: Json
          event_id?: string | null
          event_name?: string
          id?: string
          last_error?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      intents: {
        Row: {
          activo: boolean
          auto_detectado: boolean
          created_at: string
          descripcion: string
          ejemplos: string[]
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          auto_detectado?: boolean
          created_at?: string
          descripcion?: string
          ejemplos?: string[]
          id?: string
          nombre: string
        }
        Update: {
          activo?: boolean
          auto_detectado?: boolean
          created_at?: string
          descripcion?: string
          ejemplos?: string[]
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      lead_session: {
        Row: {
          bloqueador: string | null
          cantidad: number | null
          closed_at: string | null
          codigo_interno: string | null
          comprobante_pago_url: string | null
          consulta: string
          context_summary: string | null
          current_stage: Database["public"]["Enums"]["current_stage_enum"]
          extras: Json
          ia_pausada: boolean
          id: string
          lead_id: string
          metodo_pago: Database["public"]["Enums"]["metodo_pago_enum"] | null
          motivo_perdida:
            | Database["public"]["Enums"]["motivo_perdida_enum"]
            | null
          precio_cotizado: number | null
          producto_cotizado_id: string | null
          resultado: Database["public"]["Enums"]["resultado_enum"] | null
          started_at: string
          urgencia: Database["public"]["Enums"]["urgencia_enum"]
        }
        Insert: {
          bloqueador?: string | null
          cantidad?: number | null
          closed_at?: string | null
          codigo_interno?: string | null
          comprobante_pago_url?: string | null
          consulta?: string
          context_summary?: string | null
          current_stage?: Database["public"]["Enums"]["current_stage_enum"]
          extras?: Json
          ia_pausada?: boolean
          id?: string
          lead_id: string
          metodo_pago?: Database["public"]["Enums"]["metodo_pago_enum"] | null
          motivo_perdida?:
            | Database["public"]["Enums"]["motivo_perdida_enum"]
            | null
          precio_cotizado?: number | null
          producto_cotizado_id?: string | null
          resultado?: Database["public"]["Enums"]["resultado_enum"] | null
          started_at?: string
          urgencia?: Database["public"]["Enums"]["urgencia_enum"]
        }
        Update: {
          bloqueador?: string | null
          cantidad?: number | null
          closed_at?: string | null
          codigo_interno?: string | null
          comprobante_pago_url?: string | null
          consulta?: string
          context_summary?: string | null
          current_stage?: Database["public"]["Enums"]["current_stage_enum"]
          extras?: Json
          ia_pausada?: boolean
          id?: string
          lead_id?: string
          metodo_pago?: Database["public"]["Enums"]["metodo_pago_enum"] | null
          motivo_perdida?:
            | Database["public"]["Enums"]["motivo_perdida_enum"]
            | null
          precio_cotizado?: number | null
          producto_cotizado_id?: string | null
          resultado?: Database["public"]["Enums"]["resultado_enum"] | null
          started_at?: string
          urgencia?: Database["public"]["Enums"]["urgencia_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_session_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_session_producto_cotizado_id_fkey"
            columns: ["producto_cotizado_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          lead_id: string
          source: Database["public"]["Enums"]["tag_source_enum"]
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          lead_id: string
          source?: Database["public"]["Enums"]["tag_source_enum"]
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          lead_id?: string
          source?: Database["public"]["Enums"]["tag_source_enum"]
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          canal_origen: Database["public"]["Enums"]["canal_enum"]
          created_at: string
          direccion: string | null
          email: string | null
          empresa_id: string | null
          id: string
          meta_user_ids: Json
          nombre: string
          telefono: string
          updated_at: string
          vehiculo_anio: number
          vehiculo_marca: string
          vehiculo_modelo: string
          vehiculo_motor: string | null
        }
        Insert: {
          canal_origen: Database["public"]["Enums"]["canal_enum"]
          created_at?: string
          direccion?: string | null
          email?: string | null
          empresa_id?: string | null
          id?: string
          meta_user_ids?: Json
          nombre: string
          telefono: string
          updated_at?: string
          vehiculo_anio: number
          vehiculo_marca: string
          vehiculo_modelo: string
          vehiculo_motor?: string | null
        }
        Update: {
          canal_origen?: Database["public"]["Enums"]["canal_enum"]
          created_at?: string
          direccion?: string | null
          email?: string | null
          empresa_id?: string | null
          id?: string
          meta_user_ids?: Json
          nombre?: string
          telefono?: string
          updated_at?: string
          vehiculo_anio?: number
          vehiculo_marca?: string
          vehiculo_modelo?: string
          vehiculo_motor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      mensajes: {
        Row: {
          contenido: string | null
          conversacion_id: string
          created_at: string
          direction: Database["public"]["Enums"]["direction_enum"]
          id: string
          idempotency_key: string | null
          lead_session_id: string
          media_url: string | null
          meta_message_id: string | null
          metadata: Json
          sender: Database["public"]["Enums"]["sender_enum"]
          sender_user_id: string | null
          tipo: Database["public"]["Enums"]["tipo_mensaje_enum"]
        }
        Insert: {
          contenido?: string | null
          conversacion_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["direction_enum"]
          id?: string
          idempotency_key?: string | null
          lead_session_id: string
          media_url?: string | null
          meta_message_id?: string | null
          metadata?: Json
          sender: Database["public"]["Enums"]["sender_enum"]
          sender_user_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_mensaje_enum"]
        }
        Update: {
          contenido?: string | null
          conversacion_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["direction_enum"]
          id?: string
          idempotency_key?: string | null
          lead_session_id?: string
          media_url?: string | null
          meta_message_id?: string | null
          metadata?: Json
          sender?: Database["public"]["Enums"]["sender_enum"]
          sender_user_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_mensaje_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      merge_candidates: {
        Row: {
          created_at: string
          dst_lead_id: string
          id: string
          reasons: Json
          resolved_at: string | null
          resolved_by: string | null
          similarity_score: number
          src_lead_id: string
          status: Database["public"]["Enums"]["merge_candidate_status_enum"]
        }
        Insert: {
          created_at?: string
          dst_lead_id: string
          id?: string
          reasons?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          similarity_score: number
          src_lead_id: string
          status?: Database["public"]["Enums"]["merge_candidate_status_enum"]
        }
        Update: {
          created_at?: string
          dst_lead_id?: string
          id?: string
          reasons?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          similarity_score?: number
          src_lead_id?: string
          status?: Database["public"]["Enums"]["merge_candidate_status_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "merge_candidates_dst_lead_id_fkey"
            columns: ["dst_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_candidates_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_candidates_src_lead_id_fkey"
            columns: ["src_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          categoria: string | null
          codigo_interno: string
          compatibilidad: Json
          created_at: string
          descripcion: string | null
          id: string
          imagen_url: string | null
          nombre: string
          precio: number
          sku_proveedor: string | null
          stock: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria?: string | null
          codigo_interno: string
          compatibilidad?: Json
          created_at?: string
          descripcion?: string | null
          id?: string
          imagen_url?: string | null
          nombre: string
          precio: number
          sku_proveedor?: string | null
          stock?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria?: string | null
          codigo_interno?: string
          compatibilidad?: Json
          created_at?: string
          descripcion?: string | null
          id?: string
          imagen_url?: string | null
          nombre?: string
          precio?: number
          sku_proveedor?: string | null
          stock?: number
          updated_at?: string
        }
        Relationships: []
      }
      reactivation_dispatches: {
        Row: {
          created_at: string
          id: string
          lead_session_id: string
          meta_message_id: string | null
          motivo: Database["public"]["Enums"]["motivo_perdida_enum"] | null
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_session_id: string
          meta_message_id?: string | null
          motivo?: Database["public"]["Enums"]["motivo_perdida_enum"] | null
          status?: string
          template_name: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_session_id?: string
          meta_message_id?: string | null
          motivo?: Database["public"]["Enums"]["motivo_perdida_enum"] | null
          status?: string
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactivation_dispatches_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
            referencedColumns: ["id"]
          },
        ]
      }
      reglas: {
        Row: {
          activa: boolean
          condiciones_extra: Json | null
          created_at: string
          id: string
          intent_id: string
          prioridad: number
          respuesta_contenido: string
          respuesta_tipo: Database["public"]["Enums"]["respuesta_tipo_enum"]
        }
        Insert: {
          activa?: boolean
          condiciones_extra?: Json | null
          created_at?: string
          id?: string
          intent_id: string
          prioridad?: number
          respuesta_contenido: string
          respuesta_tipo: Database["public"]["Enums"]["respuesta_tipo_enum"]
        }
        Update: {
          activa?: boolean
          condiciones_extra?: Json | null
          created_at?: string
          id?: string
          intent_id?: string
          prioridad?: number
          respuesta_contenido?: string
          respuesta_tipo?: Database["public"]["Enums"]["respuesta_tipo_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "reglas_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_executions: {
        Row: {
          created_at: string
          id: string
          matched_intent_id: string
          mensaje_id: string
          regla_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          matched_intent_id: string
          mensaje_id: string
          regla_id: string
        }
        Update: {
          created_at?: string
          id?: string
          matched_intent_id?: string
          mensaje_id?: string
          regla_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_executions_matched_intent_id_fkey"
            columns: ["matched_intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_executions_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: false
            referencedRelation: "mensajes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_executions_regla_id_fkey"
            columns: ["regla_id"]
            isOneToOne: false
            referencedRelation: "reglas"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          descripcion: string | null
          id: string
          nombre: string
        }
        Insert: {
          color?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre: string
        }
        Update: {
          color?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      tool_executions: {
        Row: {
          args: Json
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          lead_session_id: string
          mensaje_id: string | null
          result: Json | null
          tool_name: string
        }
        Insert: {
          args: Json
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          lead_session_id: string
          mensaje_id?: string | null
          result?: Json | null
          tool_name: string
        }
        Update: {
          args?: Json
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          lead_session_id?: string
          mensaje_id?: string | null
          result?: Json | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_executions_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_executions_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: false
            referencedRelation: "mensajes"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios: {
        Row: {
          activo: boolean
          created_at: string
          email: string
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["rol_usuario_enum"]
        }
        Insert: {
          activo?: boolean
          created_at?: string
          email: string
          id: string
          nombre: string
          rol?: Database["public"]["Enums"]["rol_usuario_enum"]
        }
        Update: {
          activo?: boolean
          created_at?: string
          email?: string
          id?: string
          nombre?: string
          rol?: Database["public"]["Enums"]["rol_usuario_enum"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_rol: {
        Args: never
        Returns: Database["public"]["Enums"]["rol_usuario_enum"]
      }
      is_admin: { Args: never; Returns: boolean }
      is_vendedor: { Args: never; Returns: boolean }
      server_now: { Args: never; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      canal_enum: "wa" | "ig" | "fb"
      current_stage_enum:
        | "nuevo"
        | "identificando"
        | "cotizado"
        | "negociando"
        | "esperando_pago"
        | "cerrado"
        | "perdido"
        | "requiere_humano"
      direction_enum: "in" | "out"
      merge_candidate_status_enum:
        | "pending"
        | "approved"
        | "rejected"
        | "superseded"
      metodo_pago_enum: "transferencia" | "efectivo" | "tarjeta"
      motivo_perdida_enum:
        | "precio"
        | "stock"
        | "tiempo"
        | "no_responde"
        | "otro"
      respuesta_tipo_enum: "text" | "template" | "handoff"
      resultado_enum: "exito" | "perdido"
      rol_usuario_enum: "admin" | "vendedor"
      sender_enum: "lead" | "ia" | "humano" | "sistema"
      tag_source_enum: "manual" | "workflow"
      tipo_mensaje_enum:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "doc"
        | "location"
        | "template"
      urgencia_enum: "baja" | "media" | "alta"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      canal_enum: ["wa", "ig", "fb"],
      current_stage_enum: [
        "nuevo",
        "identificando",
        "cotizado",
        "negociando",
        "esperando_pago",
        "cerrado",
        "perdido",
        "requiere_humano",
      ],
      direction_enum: ["in", "out"],
      merge_candidate_status_enum: [
        "pending",
        "approved",
        "rejected",
        "superseded",
      ],
      metodo_pago_enum: ["transferencia", "efectivo", "tarjeta"],
      motivo_perdida_enum: ["precio", "stock", "tiempo", "no_responde", "otro"],
      respuesta_tipo_enum: ["text", "template", "handoff"],
      resultado_enum: ["exito", "perdido"],
      rol_usuario_enum: ["admin", "vendedor"],
      sender_enum: ["lead", "ia", "humano", "sistema"],
      tag_source_enum: ["manual", "workflow"],
      tipo_mensaje_enum: [
        "text",
        "image",
        "audio",
        "video",
        "doc",
        "location",
        "template",
      ],
      urgencia_enum: ["baja", "media", "alta"],
    },
  },
} as const
