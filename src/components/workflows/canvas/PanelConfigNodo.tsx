"use client";

import { useMemo, useCallback } from "react";
import { X, Play, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CATEGORIAS_NODOS } from "@/lib/workflows/nodos-catalogo";
import {
  ConfigTrigger,
  ConfigMensajeria,
  ConfigCRM,
  ConfigLogica,
  ConfigIntegracion,
  ConfigIA,
  ConfigInterno,
} from "./config";

interface NodoSeleccionado {
  id: string;
  tipo: string;
  config: Record<string, unknown>;
}

interface PanelConfigNodoProps {
  nodo: NodoSeleccionado | null;
  onClose: () => void;
  onChange: (nodoId: string, config: Record<string, unknown>) => void;
  onProbar?: (nodoId: string) => void;
  tags?: ReadonlyArray<{ id: string; nombre: string; color?: string }>;
  etapas?: ReadonlyArray<{ id: string; nombre: string }>;
  vendedores?: ReadonlyArray<{ id: string; nombre: string }>;
  intents?: ReadonlyArray<{ id: string; nombre: string }>;
  campos?: ReadonlyArray<{ key: string; label: string; tipo: string }>;
  canales?: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

interface ValidacionError {
  campo: string;
  mensaje: string;
}

const VALIDADORES: Record<string, (config: Record<string, unknown>) => ValidacionError[]> = {
  msg_texto: (config) => {
    const errores: ValidacionError[] = [];
    const mensaje = String(config.mensaje ?? "");
    if (!mensaje.trim()) {
      errores.push({ campo: "mensaje", mensaje: "El mensaje es requerido" });
    }
    if (mensaje.length > 4096) {
      errores.push({ campo: "mensaje", mensaje: "Maximo 4096 caracteres" });
    }
    return errores;
  },
  msg_botones: (config) => {
    const errores: ValidacionError[] = [];
    const botones = (config.botones as { texto: string }[]) ?? [];
    if (botones.length === 0) {
      errores.push({
        campo: "botones",
        mensaje: "Agrega al menos un boton",
      });
    }
    botones.forEach((b, idx) => {
      if (!b.texto?.trim()) {
        errores.push({
          campo: `botones[${idx}]`,
          mensaje: `Boton ${idx + 1} necesita texto`,
        });
      }
    });
    return errores;
  },
  logica_condicion: (config) => {
    const errores: ValidacionError[] = [];
    if (!config.campo) {
      errores.push({ campo: "campo", mensaje: "Selecciona un campo" });
    }
    if (!config.operador) {
      errores.push({ campo: "operador", mensaje: "Selecciona un operador" });
    }
    const operador = String(config.operador ?? "");
    const noRequiereValor = ["es_verdadero", "es_falso", "existe", "no_existe"].includes(operador);
    if (!noRequiereValor && !config.valor) {
      errores.push({ campo: "valor", mensaje: "El valor es requerido" });
    }
    return errores;
  },
  int_http: (config) => {
    const errores: ValidacionError[] = [];
    const url = String(config.url ?? "");
    if (!url.trim()) {
      errores.push({ campo: "url", mensaje: "La URL es requerida" });
    } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
      errores.push({
        campo: "url",
        mensaje: "La URL debe empezar con http:// o https://",
      });
    }
    return errores;
  },
  trigger_etiqueta: (config) => {
    const errores: ValidacionError[] = [];
    if (!config.tagId) {
      errores.push({ campo: "tagId", mensaje: "Selecciona una etiqueta" });
    }
    return errores;
  },
  trigger_etiqueta_removida: (config) => {
    const errores: ValidacionError[] = [];
    if (!config.tagId) {
      errores.push({ campo: "tagId", mensaje: "Selecciona una etiqueta" });
    }
    return errores;
  },
  trigger_etapa: (config) => {
    const errores: ValidacionError[] = [];
    if (!config.etapaDestino) {
      errores.push({
        campo: "etapaDestino",
        mensaje: "Selecciona la etapa destino",
      });
    }
    return errores;
  },
  crm_etiqueta_add: (config) => {
    const errores: ValidacionError[] = [];
    const tagIds = (config.tagIds as string[]) ?? [];
    if (tagIds.length === 0) {
      errores.push({
        campo: "tagIds",
        mensaje: "Selecciona al menos una etiqueta",
      });
    }
    return errores;
  },
  crm_etiqueta_remove: (config) => {
    const errores: ValidacionError[] = [];
    const tagIds = (config.tagIds as string[]) ?? [];
    if (tagIds.length === 0) {
      errores.push({
        campo: "tagIds",
        mensaje: "Selecciona al menos una etiqueta",
      });
    }
    return errores;
  },
  crm_etapa: (config) => {
    const errores: ValidacionError[] = [];
    if (!config.etapaId) {
      errores.push({ campo: "etapaId", mensaje: "Selecciona una etapa" });
    }
    return errores;
  },
  crm_vendedor: (config) => {
    const errores: ValidacionError[] = [];
    if (!config.vendedorId) {
      errores.push({ campo: "vendedorId", mensaje: "Selecciona un vendedor" });
    }
    return errores;
  },
  crm_round_robin: (config) => {
    const errores: ValidacionError[] = [];
    const vendedorIds = (config.vendedorIds as string[]) ?? [];
    if (vendedorIds.length < 2) {
      errores.push({
        campo: "vendedorIds",
        mensaje: "Selecciona al menos 2 vendedores",
      });
    }
    return errores;
  },
  ia_clasificar: (config) => {
    const errores: ValidacionError[] = [];
    const intentIds = (config.intentIds as string[]) ?? [];
    if (intentIds.length === 0) {
      errores.push({
        campo: "intentIds",
        mensaje: "Selecciona al menos un intent",
      });
    }
    return errores;
  },
  ia_responder: (config) => {
    const errores: ValidacionError[] = [];
    if (!String(config.instrucciones ?? "").trim()) {
      errores.push({
        campo: "instrucciones",
        mensaje: "Las instrucciones son requeridas",
      });
    }
    return errores;
  },
  ia_extraer: (config) => {
    const errores: ValidacionError[] = [];
    const campos = (config.campos as { nombre: string }[]) ?? [];
    if (campos.length === 0) {
      errores.push({
        campo: "campos",
        mensaje: "Define al menos un campo a extraer",
      });
    }
    campos.forEach((c, idx) => {
      if (!c.nombre?.trim()) {
        errores.push({
          campo: `campos[${idx}]`,
          mensaje: `Campo ${idx + 1} necesita nombre`,
        });
      }
    });
    return errores;
  },
};

function obtenerCategoria(tipo: string): string | null {
  for (const cat of CATEGORIAS_NODOS) {
    if (cat.nodos.some((n) => n.tipo === tipo)) {
      return cat.id;
    }
  }
  return null;
}

function obtenerInfoNodo(tipo: string) {
  for (const cat of CATEGORIAS_NODOS) {
    const nodo = cat.nodos.find((n) => n.tipo === tipo);
    if (nodo) {
      return { nodo, categoria: cat };
    }
  }
  return null;
}

export function PanelConfigNodo({
  nodo,
  onClose,
  onChange,
  onProbar,
  tags = [],
  etapas = [],
  vendedores = [],
  intents = [],
  campos = [],
  canales = [],
  readonly,
}: PanelConfigNodoProps) {
  const info = useMemo(() => {
    if (!nodo) return null;
    return obtenerInfoNodo(nodo.tipo);
  }, [nodo]);

  const errores = useMemo(() => {
    if (!nodo) return [];
    const validador = VALIDADORES[nodo.tipo];
    if (!validador) return [];
    return validador(nodo.config);
  }, [nodo]);

  const handleConfigChange = useCallback(
    (newConfig: Record<string, unknown>) => {
      if (!nodo) return;
      onChange(nodo.id, newConfig);
    },
    [nodo, onChange],
  );

  if (!nodo) {
    return (
      <div className="border-line-layout bg-surface-panel flex h-full w-[320px] flex-col rounded-lg border">
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-ink-faint text-center text-[12px]">
            Selecciona un nodo para configurarlo
          </p>
        </div>
      </div>
    );
  }

  const Icono = info?.nodo.icono;
  const categoria = obtenerCategoria(nodo.tipo);

  const renderFormulario = () => {
    switch (categoria) {
      case "triggers":
        return (
          <ConfigTrigger
            tipo={nodo.tipo}
            config={nodo.config}
            onChange={handleConfigChange}
            tags={tags}
            etapas={etapas}
            readonly={readonly}
          />
        );
      case "mensajeria":
        return (
          <ConfigMensajeria
            tipo={nodo.tipo}
            config={nodo.config}
            onChange={handleConfigChange}
            readonly={readonly}
          />
        );
      case "crm":
        return (
          <ConfigCRM
            tipo={nodo.tipo}
            config={nodo.config}
            onChange={handleConfigChange}
            tags={tags}
            etapas={etapas}
            vendedores={vendedores}
            campos={campos}
            readonly={readonly}
          />
        );
      case "logica":
        return (
          <ConfigLogica
            tipo={nodo.tipo}
            config={nodo.config}
            onChange={handleConfigChange}
            readonly={readonly}
          />
        );
      case "integraciones":
        return (
          <ConfigIntegracion
            tipo={nodo.tipo}
            config={nodo.config}
            onChange={handleConfigChange}
            readonly={readonly}
          />
        );
      case "ia":
        return (
          <ConfigIA
            tipo={nodo.tipo}
            config={nodo.config}
            onChange={handleConfigChange}
            intents={intents}
            readonly={readonly}
          />
        );
      case "internos":
        return (
          <ConfigInterno
            tipo={nodo.tipo}
            config={nodo.config}
            onChange={handleConfigChange}
            vendedores={vendedores}
            canales={canales}
            readonly={readonly}
          />
        );
      default:
        return (
          <p className="text-ink-faint text-[11px]">Este nodo no tiene configuracion adicional</p>
        );
    }
  };

  return (
    <div className="border-line-layout bg-surface-panel flex h-full w-[320px] flex-col rounded-lg border">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: info?.categoria.color ?? "var(--line-layout)" }}
      >
        <div className="flex items-center gap-2">
          {Icono && (
            <div
              className="flex h-6 w-6 items-center justify-center rounded"
              style={{ backgroundColor: `${info?.categoria.color}20` }}
            >
              <Icono className="h-3.5 w-3.5" style={{ color: info?.categoria.color }} />
            </div>
          )}
          <span className="text-ink-primary text-[13px] font-medium">
            {info?.nodo.nombre ?? nodo.tipo}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-faint hover:text-ink-secondary p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">{renderFormulario()}</div>
      </ScrollArea>

      {/* Errores */}
      {errores.length > 0 && (
        <div className="border-line-layout border-t bg-red-500/10 px-4 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
            <div className="space-y-1">
              {errores.map((e, idx) => (
                <p key={idx} className="text-[10px] text-red-300">
                  {e.mensaje}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      {onProbar && !readonly && (
        <div className="border-line-layout border-t px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={() => onProbar(nodo.id)}
            disabled={errores.length > 0}
          >
            <Play className="mr-1.5 h-3 w-3" />
            Probar este paso
          </Button>
        </div>
      )}
    </div>
  );
}
