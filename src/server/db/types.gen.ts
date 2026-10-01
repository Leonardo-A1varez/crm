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
          escalar_cotizacion_desde: number | null
          escalar_palabras: string[]
          escalar_umbral_intents: number
          horario: Json
          horario_equipo: Json
          horario_timezone: string
          id: string
          instrucciones: string
          largo: string
          max_pasos_tool: number
          max_salientes_automaticos_24h: number
          modelo: string
          nota: string | null
          plantilla_escalado: string
          plantilla_fuera_horario: string
          politica_tope: string
          rollback_de: string | null
          timeout_tool_ms: number
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
          escalar_cotizacion_desde?: number | null
          escalar_palabras?: string[]
          escalar_umbral_intents?: number
          horario: Json
          horario_equipo?: Json
          horario_timezone: string
          id?: string
          instrucciones?: string
          largo: string
          max_pasos_tool: number
          max_salientes_automaticos_24h?: number
          modelo: string
          nota?: string | null
          plantilla_escalado?: string
          plantilla_fuera_horario?: string
          politica_tope: string
          rollback_de?: string | null
          timeout_tool_ms?: number
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
          escalar_cotizacion_desde?: number | null
          escalar_palabras?: string[]
          escalar_umbral_intents?: number
          horario?: Json
          horario_equipo?: Json
          horario_timezone?: string
          id?: string
          instrucciones?: string
          largo?: string
          max_pasos_tool?: number
          max_salientes_automaticos_24h?: number
          modelo?: string
          nota?: string | null
          plantilla_escalado?: string
          plantilla_fuera_horario?: string
          politica_tope?: string
          rollback_de?: string | null
          timeout_tool_ms?: number
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
      borradores_ia: {
        Row: {
          contenido: string | null
          conversacion_id: string
          created_at: string
          error_codigo: string | null
          estado: string
          id: string
          lead_session_id: string
          mensaje_origen_id: string
          origen: string | null
          regla_id: string | null
          updated_at: string
          usado_at: string | null
          usado_por: string | null
          usado_via: string | null
        }
        Insert: {
          contenido?: string | null
          conversacion_id: string
          created_at?: string
          error_codigo?: string | null
          estado: string
          id?: string
          lead_session_id: string
          mensaje_origen_id: string
          origen?: string | null
          regla_id?: string | null
          updated_at?: string
          usado_at?: string | null
          usado_por?: string | null
          usado_via?: string | null
        }
        Update: {
          contenido?: string | null
          conversacion_id?: string
          created_at?: string
          error_codigo?: string | null
          estado?: string
          id?: string
          lead_session_id?: string
          mensaje_origen_id?: string
          origen?: string | null
          regla_id?: string | null
          updated_at?: string
          usado_at?: string | null
          usado_por?: string | null
          usado_via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "borradores_ia_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borradores_ia_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borradores_ia_mensaje_origen_id_fkey"
            columns: ["mensaje_origen_id"]
            isOneToOne: false
            referencedRelation: "mensajes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borradores_ia_regla_id_fkey"
            columns: ["regla_id"]
            isOneToOne: false
            referencedRelation: "reglas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borradores_ia_usado_por_fkey"
            columns: ["usado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      campanias: {
        Row: {
          created_at: string
          desde: string
          hasta: string
          id: string
          nombre: string
        }
        Insert: {
          created_at?: string
          desde: string
          hasta: string
          id?: string
          nombre: string
        }
        Update: {
          created_at?: string
          desde?: string
          hasta?: string
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      candados: {
        Row: {
          clave: string
          duenio: string
          vence_at: string
        }
        Insert: {
          clave: string
          duenio: string
          vence_at: string
        }
        Update: {
          clave?: string
          duenio?: string
          vence_at?: string
        }
        Relationships: []
      }
      conversaciones: {
        Row: {
          canal: Database["public"]["Enums"]["canal_enum"]
          canal_thread_id: string
          created_at: string
          id: string
          lead_id: string
          modo_respuesta_override: string | null
          ultima_actividad_at: string
        }
        Insert: {
          canal: Database["public"]["Enums"]["canal_enum"]
          canal_thread_id: string
          created_at?: string
          id?: string
          lead_id: string
          modo_respuesta_override?: string | null
          ultima_actividad_at?: string
        }
        Update: {
          canal?: Database["public"]["Enums"]["canal_enum"]
          canal_thread_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          modo_respuesta_override?: string | null
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
      difusion_envios: {
        Row: {
          alta_dinamica: boolean
          created_at: string
          difusion_id: string
          error_codigo: string | null
          error_detalle: string | null
          estado: Database["public"]["Enums"]["difusion_envio_estado"]
          estado_at: string
          id: string
          intento_at: string | null
          lead_id: string | null
          meta_message_id: string | null
          motivo_exclusion:
            | Database["public"]["Enums"]["difusion_motivo_exclusion"]
            | null
          programado_para: string | null
          respondido_at: string | null
          respuesta_meta_message_id: string | null
          ruta: Database["public"]["Enums"]["difusion_ruta"] | null
          salio_como: string | null
          tanda: number | null
          telefono: string | null
        }
        Insert: {
          alta_dinamica?: boolean
          created_at?: string
          difusion_id: string
          error_codigo?: string | null
          error_detalle?: string | null
          estado: Database["public"]["Enums"]["difusion_envio_estado"]
          estado_at?: string
          id?: string
          intento_at?: string | null
          lead_id?: string | null
          meta_message_id?: string | null
          motivo_exclusion?:
            | Database["public"]["Enums"]["difusion_motivo_exclusion"]
            | null
          programado_para?: string | null
          respondido_at?: string | null
          respuesta_meta_message_id?: string | null
          ruta?: Database["public"]["Enums"]["difusion_ruta"] | null
          salio_como?: string | null
          tanda?: number | null
          telefono?: string | null
        }
        Update: {
          alta_dinamica?: boolean
          created_at?: string
          difusion_id?: string
          error_codigo?: string | null
          error_detalle?: string | null
          estado?: Database["public"]["Enums"]["difusion_envio_estado"]
          estado_at?: string
          id?: string
          intento_at?: string | null
          lead_id?: string | null
          meta_message_id?: string | null
          motivo_exclusion?:
            | Database["public"]["Enums"]["difusion_motivo_exclusion"]
            | null
          programado_para?: string | null
          respondido_at?: string | null
          respuesta_meta_message_id?: string | null
          ruta?: Database["public"]["Enums"]["difusion_ruta"] | null
          salio_como?: string | null
          tanda?: number | null
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "difusion_envios_difusion_id_fkey"
            columns: ["difusion_id"]
            isOneToOne: false
            referencedRelation: "difusiones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "difusion_envios_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      difusion_supresiones: {
        Row: {
          clave_version: number
          created_at: string
          detalle: string | null
          difusion_id: string | null
          id: string
          lead_id: string | null
          origen: Database["public"]["Enums"]["difusion_supresion_origen"]
          reactivacion_motivo: string | null
          reactivada_at: string | null
          reactivada_por: string | null
          registrada_por: string | null
          telefono_hash: string
        }
        Insert: {
          clave_version: number
          created_at?: string
          detalle?: string | null
          difusion_id?: string | null
          id?: string
          lead_id?: string | null
          origen: Database["public"]["Enums"]["difusion_supresion_origen"]
          reactivacion_motivo?: string | null
          reactivada_at?: string | null
          reactivada_por?: string | null
          registrada_por?: string | null
          telefono_hash: string
        }
        Update: {
          clave_version?: number
          created_at?: string
          detalle?: string | null
          difusion_id?: string | null
          id?: string
          lead_id?: string | null
          origen?: Database["public"]["Enums"]["difusion_supresion_origen"]
          reactivacion_motivo?: string | null
          reactivada_at?: string | null
          reactivada_por?: string | null
          registrada_por?: string | null
          telefono_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "difusion_supresiones_difusion_id_fkey"
            columns: ["difusion_id"]
            isOneToOne: false
            referencedRelation: "difusiones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "difusion_supresiones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "difusion_supresiones_reactivada_por_fkey"
            columns: ["reactivada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "difusion_supresiones_registrada_por_fkey"
            columns: ["registrada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      difusiones: {
        Row: {
          audiencia: Json
          audiencia_modo: Database["public"]["Enums"]["difusion_audiencia_modo"]
          audiencia_tanda_evaluada: number | null
          audiencia_toda_la_base: boolean
          canary_continuada_at: string | null
          canary_revisado_at: string | null
          canary_tamano: number | null
          creada_por: string | null
          created_at: string
          detenida_por: string | null
          estado: Database["public"]["Enums"]["difusion_estado"]
          exenta_tope_frecuencia: boolean
          finalizada_at: string | null
          id: string
          incluir_en_negociacion: boolean
          iniciada_at: string | null
          motivo_detencion: string | null
          motivo_revision: string | null
          nombre: string
          plantilla_categoria:
            | Database["public"]["Enums"]["difusion_plantilla_categoria"]
            | null
          plantilla_idioma: string | null
          plantilla_nombre: string | null
          plantilla_parametros: Json
          programada_para: string | null
          texto_libre: string | null
          updated_at: string
        }
        Insert: {
          audiencia: Json
          audiencia_modo?: Database["public"]["Enums"]["difusion_audiencia_modo"]
          audiencia_tanda_evaluada?: number | null
          audiencia_toda_la_base?: boolean
          canary_continuada_at?: string | null
          canary_revisado_at?: string | null
          canary_tamano?: number | null
          creada_por?: string | null
          created_at?: string
          detenida_por?: string | null
          estado?: Database["public"]["Enums"]["difusion_estado"]
          exenta_tope_frecuencia?: boolean
          finalizada_at?: string | null
          id?: string
          incluir_en_negociacion?: boolean
          iniciada_at?: string | null
          motivo_detencion?: string | null
          motivo_revision?: string | null
          nombre: string
          plantilla_categoria?:
            | Database["public"]["Enums"]["difusion_plantilla_categoria"]
            | null
          plantilla_idioma?: string | null
          plantilla_nombre?: string | null
          plantilla_parametros?: Json
          programada_para?: string | null
          texto_libre?: string | null
          updated_at?: string
        }
        Update: {
          audiencia?: Json
          audiencia_modo?: Database["public"]["Enums"]["difusion_audiencia_modo"]
          audiencia_tanda_evaluada?: number | null
          audiencia_toda_la_base?: boolean
          canary_continuada_at?: string | null
          canary_revisado_at?: string | null
          canary_tamano?: number | null
          creada_por?: string | null
          created_at?: string
          detenida_por?: string | null
          estado?: Database["public"]["Enums"]["difusion_estado"]
          exenta_tope_frecuencia?: boolean
          finalizada_at?: string | null
          id?: string
          incluir_en_negociacion?: boolean
          iniciada_at?: string | null
          motivo_detencion?: string | null
          motivo_revision?: string | null
          nombre?: string
          plantilla_categoria?:
            | Database["public"]["Enums"]["difusion_plantilla_categoria"]
            | null
          plantilla_idioma?: string | null
          plantilla_nombre?: string | null
          plantilla_parametros?: Json
          programada_para?: string | null
          texto_libre?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "difusiones_creada_por_fkey"
            columns: ["creada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "difusiones_detenida_por_fkey"
            columns: ["detenida_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
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
      handoff_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          lead_session_id: string
          previous_stage:
            | Database["public"]["Enums"]["current_stage_enum"]
            | null
          reason_code: string
          source: string
          source_event_key: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          lead_session_id: string
          previous_stage?:
            | Database["public"]["Enums"]["current_stage_enum"]
            | null
          reason_code: string
          source: string
          source_event_key: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          lead_session_id?: string
          previous_stage?:
            | Database["public"]["Enums"]["current_stage_enum"]
            | null
          reason_code?: string
          source?: string
          source_event_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "handoff_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoff_events_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
            referencedColumns: ["id"]
          },
        ]
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
      lead_identificadores: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          origen: string
          principal: boolean
          tipo: Database["public"]["Enums"]["identificador_tipo_enum"]
          valor: string
          valor_original: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          origen?: string
          principal?: boolean
          tipo: Database["public"]["Enums"]["identificador_tipo_enum"]
          valor: string
          valor_original?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          origen?: string
          principal?: boolean
          tipo?: Database["public"]["Enums"]["identificador_tipo_enum"]
          valor?: string
          valor_original?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_identificadores_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_session: {
        Row: {
          asignado_at: string | null
          bloqueador: string | null
          cantidad: number | null
          closed_at: string | null
          codigo_interno: string | null
          comprobante_pago_url: string | null
          consulta: string
          context_summary: string | null
          current_stage: Database["public"]["Enums"]["current_stage_enum"]
          etapa_alcanzada: Database["public"]["Enums"]["current_stage_enum"]
          extras: Json
          ia_pausada: boolean
          id: string
          lead_id: string
          metodo_pago: Database["public"]["Enums"]["metodo_pago_enum"] | null
          motivo_perdida:
            | Database["public"]["Enums"]["motivo_perdida_enum"]
            | null
          precio_cotizado: number | null
          procedencia: Json
          producto_cotizado_id: string | null
          resultado: Database["public"]["Enums"]["resultado_enum"] | null
          stage_before_handoff:
            | Database["public"]["Enums"]["current_stage_enum"]
            | null
          started_at: string
          updated_at: string
          urgencia: Database["public"]["Enums"]["urgencia_enum"]
          vendedor_asignado_id: string | null
        }
        Insert: {
          asignado_at?: string | null
          bloqueador?: string | null
          cantidad?: number | null
          closed_at?: string | null
          codigo_interno?: string | null
          comprobante_pago_url?: string | null
          consulta?: string
          context_summary?: string | null
          current_stage?: Database["public"]["Enums"]["current_stage_enum"]
          etapa_alcanzada?: Database["public"]["Enums"]["current_stage_enum"]
          extras?: Json
          ia_pausada?: boolean
          id?: string
          lead_id: string
          metodo_pago?: Database["public"]["Enums"]["metodo_pago_enum"] | null
          motivo_perdida?:
            | Database["public"]["Enums"]["motivo_perdida_enum"]
            | null
          precio_cotizado?: number | null
          procedencia?: Json
          producto_cotizado_id?: string | null
          resultado?: Database["public"]["Enums"]["resultado_enum"] | null
          stage_before_handoff?:
            | Database["public"]["Enums"]["current_stage_enum"]
            | null
          started_at?: string
          updated_at?: string
          urgencia?: Database["public"]["Enums"]["urgencia_enum"]
          vendedor_asignado_id?: string | null
        }
        Update: {
          asignado_at?: string | null
          bloqueador?: string | null
          cantidad?: number | null
          closed_at?: string | null
          codigo_interno?: string | null
          comprobante_pago_url?: string | null
          consulta?: string
          context_summary?: string | null
          current_stage?: Database["public"]["Enums"]["current_stage_enum"]
          etapa_alcanzada?: Database["public"]["Enums"]["current_stage_enum"]
          extras?: Json
          ia_pausada?: boolean
          id?: string
          lead_id?: string
          metodo_pago?: Database["public"]["Enums"]["metodo_pago_enum"] | null
          motivo_perdida?:
            | Database["public"]["Enums"]["motivo_perdida_enum"]
            | null
          precio_cotizado?: number | null
          procedencia?: Json
          producto_cotizado_id?: string | null
          resultado?: Database["public"]["Enums"]["resultado_enum"] | null
          stage_before_handoff?:
            | Database["public"]["Enums"]["current_stage_enum"]
            | null
          started_at?: string
          updated_at?: string
          urgencia?: Database["public"]["Enums"]["urgencia_enum"]
          vendedor_asignado_id?: string | null
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
          {
            foreignKeyName: "lead_session_vendedor_asignado_id_fkey"
            columns: ["vendedor_asignado_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          lead_id: string
          quitada_at: string | null
          quitada_por: string | null
          source: Database["public"]["Enums"]["tag_source_enum"]
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          lead_id: string
          quitada_at?: string | null
          quitada_por?: string | null
          source?: Database["public"]["Enums"]["tag_source_enum"]
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          lead_id?: string
          quitada_at?: string | null
          quitada_por?: string | null
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
            foreignKeyName: "lead_tags_quitada_por_fkey"
            columns: ["quitada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
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
      lead_vehiculos: {
        Row: {
          anio: number | null
          created_at: string
          id: string
          lead_id: string
          marca: string | null
          modelo: string | null
          motor: string | null
          placa: string | null
          placa_original: string | null
          principal: boolean
          vin: string | null
          vin_original: string | null
        }
        Insert: {
          anio?: number | null
          created_at?: string
          id?: string
          lead_id: string
          marca?: string | null
          modelo?: string | null
          motor?: string | null
          placa?: string | null
          placa_original?: string | null
          principal?: boolean
          vin?: string | null
          vin_original?: string | null
        }
        Update: {
          anio?: number | null
          created_at?: string
          id?: string
          lead_id?: string
          marca?: string | null
          modelo?: string | null
          motor?: string | null
          placa?: string | null
          placa_original?: string | null
          principal?: boolean
          vin?: string | null
          vin_original?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_vehiculos_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          campania_id: string | null
          canal_origen: Database["public"]["Enums"]["canal_enum"]
          created_at: string
          datos_extra: Json
          direccion: string | null
          email: string | null
          empresa_id: string | null
          id: string
          meta_user_ids: Json
          nombre: string
          nombre_perfil: string | null
          telefono: string
          updated_at: string
          vehiculo_anio: number | null
          vehiculo_marca: string | null
          vehiculo_modelo: string | null
          vehiculo_motor: string | null
        }
        Insert: {
          campania_id?: string | null
          canal_origen: Database["public"]["Enums"]["canal_enum"]
          created_at?: string
          datos_extra?: Json
          direccion?: string | null
          email?: string | null
          empresa_id?: string | null
          id?: string
          meta_user_ids?: Json
          nombre: string
          nombre_perfil?: string | null
          telefono: string
          updated_at?: string
          vehiculo_anio?: number | null
          vehiculo_marca?: string | null
          vehiculo_modelo?: string | null
          vehiculo_motor?: string | null
        }
        Update: {
          campania_id?: string | null
          canal_origen?: Database["public"]["Enums"]["canal_enum"]
          created_at?: string
          datos_extra?: Json
          direccion?: string | null
          email?: string | null
          empresa_id?: string | null
          id?: string
          meta_user_ids?: Json
          nombre?: string
          nombre_perfil?: string | null
          telefono?: string
          updated_at?: string
          vehiculo_anio?: number | null
          vehiculo_marca?: string | null
          vehiculo_modelo?: string | null
          vehiculo_motor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_campania_id_fkey"
            columns: ["campania_id"]
            isOneToOne: false
            referencedRelation: "campanias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_usage: {
        Row: {
          costo_usd: number
          created_at: string
          id: string
          input_tokens: number
          lead_session_id: string | null
          mensaje_id: string | null
          modelo: string
          output_tokens: number
          workflow: string
        }
        Insert: {
          costo_usd: number
          created_at?: string
          id?: string
          input_tokens?: number
          lead_session_id?: string | null
          mensaje_id?: string | null
          modelo: string
          output_tokens?: number
          workflow: string
        }
        Update: {
          costo_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          lead_session_id?: string | null
          mensaje_id?: string | null
          modelo?: string
          output_tokens?: number
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llm_usage_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: false
            referencedRelation: "mensajes"
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
          error_entrega: string | null
          estado_entrega:
            | Database["public"]["Enums"]["estado_entrega_enum"]
            | null
          estado_entrega_at: string | null
          id: string
          idempotency_key: string | null
          lead_session_id: string
          media_url: string | null
          meta_message_id: string | null
          metadata: Json
          platform_created_at: string | null
          sender: Database["public"]["Enums"]["sender_enum"]
          sender_user_id: string | null
          tipo: Database["public"]["Enums"]["tipo_mensaje_enum"]
        }
        Insert: {
          contenido?: string | null
          conversacion_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["direction_enum"]
          error_entrega?: string | null
          estado_entrega?:
            | Database["public"]["Enums"]["estado_entrega_enum"]
            | null
          estado_entrega_at?: string | null
          id?: string
          idempotency_key?: string | null
          lead_session_id: string
          media_url?: string | null
          meta_message_id?: string | null
          metadata?: Json
          platform_created_at?: string | null
          sender: Database["public"]["Enums"]["sender_enum"]
          sender_user_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_mensaje_enum"]
        }
        Update: {
          contenido?: string | null
          conversacion_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["direction_enum"]
          error_entrega?: string | null
          estado_entrega?:
            | Database["public"]["Enums"]["estado_entrega_enum"]
            | null
          estado_entrega_at?: string | null
          id?: string
          idempotency_key?: string | null
          lead_session_id?: string
          media_url?: string | null
          meta_message_id?: string | null
          metadata?: Json
          platform_created_at?: string | null
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
      meta_operational_events: {
        Row: {
          campo: string
          created_at: string
          evento: string | null
          id: string
          objeto_id: string | null
          objeto_nombre: string | null
          ocurrido_at: string | null
          payload: Json
        }
        Insert: {
          campo: string
          created_at?: string
          evento?: string | null
          id?: string
          objeto_id?: string | null
          objeto_nombre?: string | null
          ocurrido_at?: string | null
          payload: Json
        }
        Update: {
          campo?: string
          created_at?: string
          evento?: string | null
          id?: string
          objeto_id?: string | null
          objeto_nombre?: string | null
          ocurrido_at?: string | null
          payload?: Json
        }
        Relationships: []
      }
      notificaciones: {
        Row: {
          clave: string
          conversacion_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          leida_at: string | null
          texto: string
          usuario_id: string
          workflow_run_id: string | null
        }
        Insert: {
          clave: string
          conversacion_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          leida_at?: string | null
          texto: string
          usuario_id: string
          workflow_run_id?: string | null
        }
        Update: {
          clave?: string
          conversacion_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          leida_at?: string | null
          texto?: string
          usuario_id?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificaciones_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          busqueda: string | null
          categoria: string | null
          codigo_fabrica: string | null
          codigo_fabrica_plegado: string | null
          codigo_interno: string
          codigo_interno_plegado: string | null
          compatibilidad: Json
          created_at: string
          descripcion: string | null
          id: string
          imagen_url: string | null
          nombre: string
          otros_codigos: string[]
          precio: number
          sku_proveedor: string | null
          stock: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          busqueda?: string | null
          categoria?: string | null
          codigo_fabrica?: string | null
          codigo_fabrica_plegado?: string | null
          codigo_interno: string
          codigo_interno_plegado?: string | null
          compatibilidad?: Json
          created_at?: string
          descripcion?: string | null
          id?: string
          imagen_url?: string | null
          nombre: string
          otros_codigos?: string[]
          precio: number
          sku_proveedor?: string | null
          stock?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          busqueda?: string | null
          categoria?: string | null
          codigo_fabrica?: string | null
          codigo_fabrica_plegado?: string | null
          codigo_interno?: string
          codigo_interno_plegado?: string | null
          compatibilidad?: Json
          created_at?: string
          descripcion?: string | null
          id?: string
          imagen_url?: string | null
          nombre?: string
          otros_codigos?: string[]
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
      reglas_etiqueta: {
        Row: {
          activa: boolean
          condiciones_extra: Json | null
          created_at: string
          id: string
          intent_id: string
          tag_id: string
        }
        Insert: {
          activa?: boolean
          condiciones_extra?: Json | null
          created_at?: string
          id?: string
          intent_id: string
          tag_id: string
        }
        Update: {
          activa?: boolean
          condiciones_extra?: Json | null
          created_at?: string
          id?: string
          intent_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reglas_etiqueta_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglas_etiqueta_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
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
      session_recordatorios: {
        Row: {
          avisado_at: string | null
          cancelado_at: string | null
          creado_por: string | null
          created_at: string
          estado: string
          id: string
          lead_session_id: string
          motivo_cancelacion: string | null
          nota: string
          recordar_at: string
        }
        Insert: {
          avisado_at?: string | null
          cancelado_at?: string | null
          creado_por?: string | null
          created_at?: string
          estado?: string
          id?: string
          lead_session_id: string
          motivo_cancelacion?: string | null
          nota?: string
          recordar_at: string
        }
        Update: {
          avisado_at?: string | null
          cancelado_at?: string | null
          creado_por?: string | null
          created_at?: string
          estado?: string
          id?: string
          lead_session_id?: string
          motivo_cancelacion?: string | null
          nota?: string
          recordar_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_recordatorios_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_recordatorios_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
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
      turn_classifications: {
        Row: {
          confidence: number
          created_at: string
          id: string
          intent_id: string | null
          intent_nombre: string | null
          mensaje_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          id?: string
          intent_id?: string | null
          intent_nombre?: string | null
          mensaje_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          intent_id?: string | null
          intent_nombre?: string | null
          mensaje_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turn_classifications_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turn_classifications_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: true
            referencedRelation: "mensajes"
            referencedColumns: ["id"]
          },
        ]
      }
      turnos_interceptados: {
        Row: {
          created_at: string
          id: string
          mensaje_id: string
          motivo: string
          workflow_id: string | null
          workflow_run_id: string | null
          workflow_version_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mensaje_id: string
          motivo: string
          workflow_id?: string | null
          workflow_run_id?: string | null
          workflow_version_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mensaje_id?: string
          motivo?: string
          workflow_id?: string | null
          workflow_run_id?: string | null
          workflow_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "turnos_interceptados_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: true
            referencedRelation: "mensajes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_interceptados_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_interceptados_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_interceptados_workflow_version_id_fkey"
            columns: ["workflow_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versiones"
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
      whatsapp_numeros_rol: {
        Row: {
          actualizado_por: string | null
          phone_number_id: string
          rol: string
          updated_at: string
        }
        Insert: {
          actualizado_por?: string | null
          phone_number_id: string
          rol: string
          updated_at?: string
        }
        Update: {
          actualizado_por?: string | null
          phone_number_id?: string
          rol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_numeros_rol_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_plantillas_sin_sesion: {
        Row: {
          contenido: string
          conversacion_id: string
          created_at: string
          error_codigo: string | null
          error_detalle: string | null
          estado: string
          estado_at: string | null
          id: string
          idempotency_key: string
          intento_at: string
          lead_id: string
          mensaje_id: string | null
          meta_message_id: string | null
          parametros_cuerpo: Json
          plantilla_idioma: string
          plantilla_nombre: string
          workflow_run_id: string | null
        }
        Insert: {
          contenido: string
          conversacion_id: string
          created_at?: string
          error_codigo?: string | null
          error_detalle?: string | null
          estado?: string
          estado_at?: string | null
          id?: string
          idempotency_key: string
          intento_at: string
          lead_id: string
          mensaje_id?: string | null
          meta_message_id?: string | null
          parametros_cuerpo?: Json
          plantilla_idioma: string
          plantilla_nombre: string
          workflow_run_id?: string | null
        }
        Update: {
          contenido?: string
          conversacion_id?: string
          created_at?: string
          error_codigo?: string | null
          error_detalle?: string | null
          estado?: string
          estado_at?: string | null
          id?: string
          idempotency_key?: string
          intento_at?: string
          lead_id?: string
          mensaje_id?: string | null
          meta_message_id?: string | null
          parametros_cuerpo?: Json
          plantilla_idioma?: string
          plantilla_nombre?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_plantillas_sin_sesion_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_plantillas_sin_sesion_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_plantillas_sin_sesion_mensaje_id_fkey"
            columns: ["mensaje_id"]
            isOneToOne: false
            referencedRelation: "mensajes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_plantillas_sin_sesion_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_run_pasos: {
        Row: {
          created_at: string
          entrada: Json | null
          error: string | null
          id: string
          motivo_salto: string | null
          nodo_id: string
          orden: number
          run_id: string
          salida: Json | null
        }
        Insert: {
          created_at?: string
          entrada?: Json | null
          error?: string | null
          id?: string
          motivo_salto?: string | null
          nodo_id: string
          orden: number
          run_id: string
          salida?: Json | null
        }
        Update: {
          created_at?: string
          entrada?: Json | null
          error?: string | null
          id?: string
          motivo_salto?: string | null
          nodo_id?: string
          orden?: number
          run_id?: string
          salida?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_run_pasos_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          contexto: Json
          ended_at: string | null
          error: string | null
          estado: Database["public"]["Enums"]["workflow_run_estado"]
          id: string
          intentos: number | null
          lead_id: string
          lead_session_id: string | null
          motivo_salto: string | null
          nodo_actual: string | null
          pasos_ejecutados: number
          started_at: string
          workflow_version_id: string
        }
        Insert: {
          contexto?: Json
          ended_at?: string | null
          error?: string | null
          estado?: Database["public"]["Enums"]["workflow_run_estado"]
          id?: string
          intentos?: number | null
          lead_id: string
          lead_session_id?: string | null
          motivo_salto?: string | null
          nodo_actual?: string | null
          pasos_ejecutados?: number
          started_at?: string
          workflow_version_id: string
        }
        Update: {
          contexto?: Json
          ended_at?: string | null
          error?: string | null
          estado?: Database["public"]["Enums"]["workflow_run_estado"]
          id?: string
          intentos?: number | null
          lead_id?: string
          lead_session_id?: string | null
          motivo_salto?: string | null
          nodo_actual?: string | null
          pasos_ejecutados?: number
          started_at?: string
          workflow_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_lead_session_id_fkey"
            columns: ["lead_session_id"]
            isOneToOne: false
            referencedRelation: "lead_session"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_version_id_fkey"
            columns: ["workflow_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versiones"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versiones: {
        Row: {
          created_at: string
          created_by: string | null
          grafo: Json
          id: string
          max_pasos: number
          nota: string | null
          politica_concurrencia: Database["public"]["Enums"]["workflow_concurrencia"]
          publicada: boolean
          version: number
          workflow_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grafo: Json
          id?: string
          max_pasos?: number
          nota?: string | null
          politica_concurrencia?: Database["public"]["Enums"]["workflow_concurrencia"]
          publicada?: boolean
          version: number
          workflow_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grafo?: Json
          id?: string
          max_pasos?: number
          nota?: string | null
          politica_concurrencia?: Database["public"]["Enums"]["workflow_concurrencia"]
          publicada?: boolean
          version?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versiones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_versiones_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          activo: boolean
          created_at: string
          descripcion: string | null
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_lead_merge: {
        Args: { p_candidate_id: string; p_keep_lead_id: string }
        Returns: {
          error_code: string
          ganador_id: string
        }[]
      }
      arrancar_workflow_run: {
        Args: {
          p_contexto: Json
          p_lead_id: string
          p_session_id: string
          p_version_id: string
        }
        Returns: {
          cancelados: string[]
          error_code: string
          run_id: string
        }[]
      }
      buscar_productos: {
        Args: {
          p_anio?: number
          p_marca?: string
          p_modelo?: string
          p_q: string
          p_tope?: number
        }
        Returns: {
          categoria: string
          codigo_fabrica: string
          codigo_interno: string
          descripcion: string
          id: string
          nombre: string
          precio: number
          puntaje: number
          stock: number
        }[]
      }
      clonar_workflow_version: {
        Args: {
          p_created_by?: string
          p_nota?: string
          p_publicar: boolean
          p_version_id: string
        }
        Returns: {
          error_code: string
          version_id: string
        }[]
      }
      codigos_a_texto: { Args: { ts: string[] }; Returns: string }
      contar_corridas_vivas: {
        Args: { p_workflow_id: string }
        Returns: {
          cantidad: number
          version_id: string
        }[]
      }
      contar_leads_por_etiqueta: {
        Args: never
        Returns: {
          leads: number
          tag_id: string
        }[]
      }
      contar_saltos_workflow: {
        Args: { p_desde: string }
        Returns: {
          cantidad: number
          motivo: string
        }[]
      }
      current_rol: {
        Args: never
        Returns: Database["public"]["Enums"]["rol_usuario_enum"]
      }
      difusion_audiencia_predicado: {
        Args: { p_ahora: string; p_nivel?: number; p_nodo: Json }
        Returns: string
      }
      difusion_audiencia_regla: {
        Args: { p_ahora: string; p_regla: Json }
        Returns: string
      }
      difusion_envios_conteo: {
        Args: { p_difusion_id: string }
        Returns: {
          cantidad: number
          estado: Database["public"]["Enums"]["difusion_envio_estado"]
          motivo_exclusion: Database["public"]["Enums"]["difusion_motivo_exclusion"]
        }[]
      }
      difusion_envios_fallos: {
        Args: { p_difusion_id: string }
        Returns: {
          cantidad: number
          error_codigo: string
        }[]
      }
      difusion_envios_muestra: {
        Args: { p_difusion_id: string; p_hasta: string }
        Returns: {
          cantidad: number
          error_codigo: string
          estado: Database["public"]["Enums"]["difusion_envio_estado"]
        }[]
      }
      difusion_envios_resumen: {
        Args: { p_difusion_ids: string[] }
        Returns: {
          aceptados: number
          cancelados: number
          difusion_id: string
          en_cola: number
          entregados: number
          excluidos: number
          fallidos: number
          leidos: number
          total: number
        }[]
      }
      difusion_envios_tandas: {
        Args: { p_difusion_id: string }
        Returns: {
          desde: string
          en_cola: number
          por_plantilla: number
          tanda: number
          total: number
        }[]
      }
      difusion_resolver_audiencia: {
        Args: {
          p_ahora: string
          p_audiencia: Json
          p_despues_de?: string
          p_limite?: number
        }
        Returns: {
          etapa_activa: Database["public"]["Enums"]["current_stage_enum"]
          lead_id: string
          nombre: string
          salientes_automaticos_24h: number
          telefono: string
          ultimo_entrante_at: string
          vehiculo: string
        }[]
      }
      difusion_sumar_altas: {
        Args: { p_difusion_id: string; p_envios: Json }
        Returns: number
      }
      difusion_supresiones_activas: {
        Args: { p_hashes: string[] }
        Returns: {
          clave_version: number
          created_at: string
          detalle: string | null
          difusion_id: string | null
          id: string
          lead_id: string | null
          origen: Database["public"]["Enums"]["difusion_supresion_origen"]
          reactivacion_motivo: string | null
          reactivada_at: string | null
          reactivada_por: string | null
          registrada_por: string | null
          telefono_hash: string
        }[]
        SetofOptions: {
          from: "*"
          to: "difusion_supresiones"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      difusion_uso_cupo_24h: { Args: { p_desde: string }; Returns: number }
      inbox_recent_messages: {
        Args: { p_limit?: number; p_session_ids: string[] }
        Returns: {
          contenido: string
          conversacion_id: string
          created_at: string
          direction: Database["public"]["Enums"]["direction_enum"]
          lead_session_id: string
          sender: Database["public"]["Enums"]["sender_enum"]
        }[]
      }
      iniciar_borrador_ia: {
        Args: {
          p_conversacion_id: string
          p_forzar?: boolean
          p_lead_session_id: string
          p_mensaje_origen_id: string
        }
        Returns: {
          out_estado: string
          out_id: string
          out_resultado: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_vendedor: { Args: never; Returns: boolean }
      leads_que_comparten_identificador: {
        Args: { p_lead_id: string }
        Returns: {
          lead_id: string
          tipos: string[]
        }[]
      }
      metricas_clasificaciones_por_intent: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          intent_id: string
          turnos: number
        }[]
      }
      metricas_gasto_por_workflow: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          costo_usd: number
          input_tokens: number
          llamadas: number
          output_tokens: number
          workflow: string
        }[]
      }
      metricas_pausas_por_motivo: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          cantidad: number
          reason_code: string
        }[]
      }
      plegar_codigo: { Args: { t: string }; Returns: string }
      plegar_codigos: { Args: { ts: string[] }; Returns: string[] }
      plegar_texto: { Args: { t: string }; Returns: string }
      programar_difusion: {
        Args: {
          p_canary_tamano?: number
          p_difusion_id: string
          p_envios: Json
          p_programada_para: string
        }
        Returns: {
          audiencia_inicial: number
          destinatarios: number
        }[]
      }
      publicar_workflow_version: {
        Args: { p_version_id: string }
        Returns: {
          error_code: string
          version_id: string
        }[]
      }
      publicar_workflow_version_con_nota: {
        Args: { p_nota?: string; p_version_id: string }
        Returns: {
          error_code: string
          version_id: string
        }[]
      }
      reactivar_supresion_difusion: {
        Args: { p_motivo: string; p_supresion_id: string }
        Returns: {
          clave_version: number
          created_at: string
          detalle: string | null
          difusion_id: string | null
          id: string
          lead_id: string | null
          origen: Database["public"]["Enums"]["difusion_supresion_origen"]
          reactivacion_motivo: string | null
          reactivada_at: string | null
          reactivada_por: string | null
          registrada_por: string | null
          telefono_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "difusion_supresiones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reanudar_workflow_run: {
        Args: { p_run_id: string }
        Returns: {
          desde_paso: number
          error_code: string
          nodo_id: string
        }[]
      }
      relanzar_workflow_run: {
        Args: { p_run_id: string }
        Returns: {
          cancelados: string[]
          error_code: string
          run_id: string
        }[]
      }
      resumen_asignaciones_vendedores: {
        Args: { p_vendedor_ids: string[] }
        Returns: {
          sesiones_abiertas: number
          ultima_asignacion_at: string
          vendedor_id: string
        }[]
      }
      revert_lead_merge: {
        Args: { p_merge_action_id: string }
        Returns: {
          error_code: string
          perdedor_id: string
        }[]
      }
      server_now: { Args: never; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soltar_candado: {
        Args: { p_clave: string; p_duenio: string }
        Returns: undefined
      }
      tomar_candado: {
        Args: { p_clave: string; p_duenio: string; p_ttl_ms: number }
        Returns: boolean
      }
      transition_handoff: {
        Args: {
          p_action: string
          p_notify_customer?: boolean
          p_reason_code: string
          p_session_id: string
          p_source: string
          p_source_event_key: string
        }
        Returns: {
          action: string
          created_at: string
          handoff_event_id: string
          lead_session_id: string
          previous_stage: Database["public"]["Enums"]["current_stage_enum"]
          reason_code: string
          source: string
        }[]
      }
      uso_cupo_whatsapp: {
        Args: { p_dias: number; p_zona: string }
        Returns: {
          destinatarios: number
          dia: string
          total_ventana: number
        }[]
      }
      workflow_condicion_coincidencias: {
        Args: {
          p_ahora: string
          p_arbol: Json
          p_muestra?: number
          p_zona: string
        }
        Returns: Json
      }
      workflow_condicion_predicado: {
        Args: {
          p_ahora: string
          p_nivel?: number
          p_nodo: Json
          p_zona: string
        }
        Returns: string
      }
      workflow_condicion_regla: {
        Args: { p_ahora: string; p_regla: Json; p_zona: string }
        Returns: string
      }
      workflow_corridas_por_nodo: {
        Args: { p_desde: string; p_version_id: string }
        Returns: Json
      }
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
      difusion_audiencia_modo: "congelada" | "dinamica"
      difusion_envio_estado:
        | "excluido"
        | "en_cola"
        | "aceptado"
        | "entregado"
        | "leido"
        | "fallido"
        | "cancelado"
      difusion_estado:
        | "borrador"
        | "programada"
        | "enviando"
        | "en_revision"
        | "completada"
        | "detenida"
      difusion_motivo_exclusion:
        | "sin_telefono"
        | "duplicado_telefono"
        | "baja_propia"
        | "baja_meta"
        | "requiere_humano"
        | "conversacion_activa"
        | "sin_ventana"
        | "saturado_meta"
        | "cap_frecuencia"
        | "en_negociacion"
      difusion_plantilla_categoria: "marketing" | "utility"
      difusion_ruta: "ventana_abierta" | "plantilla"
      difusion_supresion_origen:
        | "palabra_clave"
        | "boton_baja"
        | "meta_131050"
        | "meta_preferencias"
        | "manual"
      direction_enum: "in" | "out"
      estado_entrega_enum: "enviado" | "entregado" | "leido" | "fallido"
      identificador_tipo_enum:
        | "telefono"
        | "email"
        | "ruc"
        | "cedula"
        | "placa"
        | "vin"
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
        | "interactive"
      urgencia_enum: "baja" | "media" | "alta"
      workflow_concurrencia: "ignorar" | "reiniciar" | "permitir"
      workflow_run_estado:
        | "corriendo"
        | "esperando"
        | "terminado"
        | "fallado"
        | "cancelado"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
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
      difusion_audiencia_modo: ["congelada", "dinamica"],
      difusion_envio_estado: [
        "excluido",
        "en_cola",
        "aceptado",
        "entregado",
        "leido",
        "fallido",
        "cancelado",
      ],
      difusion_estado: [
        "borrador",
        "programada",
        "enviando",
        "en_revision",
        "completada",
        "detenida",
      ],
      difusion_motivo_exclusion: [
        "sin_telefono",
        "duplicado_telefono",
        "baja_propia",
        "baja_meta",
        "requiere_humano",
        "conversacion_activa",
        "sin_ventana",
        "saturado_meta",
        "cap_frecuencia",
        "en_negociacion",
      ],
      difusion_plantilla_categoria: ["marketing", "utility"],
      difusion_ruta: ["ventana_abierta", "plantilla"],
      difusion_supresion_origen: [
        "palabra_clave",
        "boton_baja",
        "meta_131050",
        "meta_preferencias",
        "manual",
      ],
      direction_enum: ["in", "out"],
      estado_entrega_enum: ["enviado", "entregado", "leido", "fallido"],
      identificador_tipo_enum: [
        "telefono",
        "email",
        "ruc",
        "cedula",
        "placa",
        "vin",
      ],
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
        "interactive",
      ],
      urgencia_enum: ["baja", "media", "alta"],
      workflow_concurrencia: ["ignorar", "reiniciar", "permitir"],
      workflow_run_estado: [
        "corriendo",
        "esperando",
        "terminado",
        "fallado",
        "cancelado",
      ],
    },
  },
} as const
