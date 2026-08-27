"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, X } from "lucide-react";
import { TextareaConVariables } from "./TextareaConVariables";
import { Badge } from "@/components/ui/badge";

interface ConfigIAProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  intents: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

interface CampoExtraccion {
  nombre: string;
  tipo: "texto" | "numero" | "fecha" | "booleano";
  descripcion: string;
}

export function ConfigIA({ tipo, config, onChange, intents, readonly }: ConfigIAProps) {
  const handleChange = useCallback(
    (campo: string, valor: unknown) => {
      onChange({ ...config, [campo]: valor });
    },
    [config, onChange],
  );

  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "ia_clasificar": {
      const selectedIntents = (config.intentIds as string[]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <div>
            <span className={labelClass}>Intents a detectar</span>

            <div className="mb-2 flex flex-wrap gap-1">
              {selectedIntents.map((intentId) => {
                const intent = intents.find((i) => i.id === intentId);
                if (!intent) return null;
                return (
                  <Badge
                    key={intentId}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                  >
                    <span className="text-[11px]">{intent.nombre}</span>
                    {!readonly && (
                      <button
                        type="button"
                        onClick={() =>
                          handleChange(
                            "intentIds",
                            selectedIntents.filter((id) => id !== intentId),
                          )
                        }
                        className="hover:bg-surface-hover rounded"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                );
              })}
            </div>

            <Select
              value=""
              onValueChange={(v) => {
                if (v && !selectedIntents.includes(v)) {
                  handleChange("intentIds", [...selectedIntents, v]);
                }
              }}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Agregar intent..." />
              </SelectTrigger>
              <SelectContent>
                {intents
                  .filter((i) => !selectedIntents.includes(i.id))
                  .map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nombre}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <label className="block">
            <span className={labelClass}>Umbral de confianza: {Number(config.umbral ?? 70)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Number(config.umbral ?? 70)}
              onChange={(e) => handleChange("umbral", Number(e.target.value))}
              disabled={readonly}
              className="w-full"
            />
            <div className="text-ink-faint flex justify-between text-[10px]">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Guardar resultado en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableResultado ?? "intent_detectado")}
              onChange={(e) => handleChange("variableResultado", e.target.value)}
              placeholder="intent_detectado"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_responder":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Instrucciones para el modelo</span>
            <TextareaConVariables
              value={String(config.instrucciones ?? "")}
              onChange={(v) => handleChange("instrucciones", v)}
              placeholder="Eres un asistente de ventas para repuestos automotrices. El cliente se llama {{lead.nombre}} y busca {{sesion.pieza_buscada}}..."
              rows={6}
              className={`${inputClass} h-auto min-h-[150px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Modelo</span>
            <Select
              value={String(config.modelo ?? "gpt-4o-mini")}
              onValueChange={(v) => handleChange("modelo", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini (rapido)</SelectItem>
                <SelectItem value="gpt-4o">GPT-4o (preciso)</SelectItem>
                <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>
              Temperatura: {Number(config.temperatura ?? 0.7).toFixed(1)}
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={Number(config.temperatura ?? 0.7)}
              onChange={(e) => handleChange("temperatura", Number(e.target.value))}
              disabled={readonly}
              className="w-full"
            />
            <div className="text-ink-faint flex justify-between text-[10px]">
              <span>0 (preciso)</span>
              <span>1</span>
              <span>2 (creativo)</span>
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Maximo de tokens</span>
            <Input
              type="number"
              min={50}
              max={4096}
              className={inputClass}
              value={Number(config.maxTokens ?? 500)}
              onChange={(e) => handleChange("maxTokens", Number(e.target.value))}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Guardar respuesta en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableRespuesta ?? "respuesta_ia")}
              onChange={(e) => handleChange("variableRespuesta", e.target.value)}
              placeholder="respuesta_ia"
              disabled={readonly}
            />
          </label>
        </div>
      );

    case "ia_extraer": {
      const campos = (config.campos as CampoExtraccion[]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a analizar</span>
            <TextareaConVariables
              value={String(config.texto ?? "{{contexto.mensaje}}")}
              onChange={(v) => handleChange("texto", v)}
              placeholder="{{contexto.mensaje}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Campos a extraer</span>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() =>
                    handleChange("campos", [
                      ...campos,
                      { nombre: "", tipo: "texto", descripcion: "" },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar campo
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {campos.map((campo, idx) => (
                <div
                  key={idx}
                  className="border-line-control bg-surface-root rounded-md border p-2"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Input
                      className={`${inputClass} flex-1`}
                      value={campo.nombre}
                      onChange={(e) => {
                        const newCampos = [...campos];
                        newCampos[idx] = { ...campo, nombre: e.target.value };
                        handleChange("campos", newCampos);
                      }}
                      placeholder="nombre_campo"
                      disabled={readonly}
                    />
                    <Select
                      value={campo.tipo}
                      onValueChange={(v) => {
                        const newCampos = [...campos];
                        newCampos[idx] = {
                          ...campo,
                          tipo: v as CampoExtraccion["tipo"],
                        };
                        handleChange("campos", newCampos);
                      }}
                      disabled={readonly}
                    >
                      <SelectTrigger className={`${selectClass} w-[100px]`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="texto">Texto</SelectItem>
                        <SelectItem value="numero">Numero</SelectItem>
                        <SelectItem value="fecha">Fecha</SelectItem>
                        <SelectItem value="booleano">Si/No</SelectItem>
                      </SelectContent>
                    </Select>
                    {!readonly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-500"
                        onClick={() =>
                          handleChange(
                            "campos",
                            campos.filter((_, i) => i !== idx),
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <Input
                    className={inputClass}
                    value={campo.descripcion}
                    onChange={(e) => {
                      const newCampos = [...campos];
                      newCampos[idx] = {
                        ...campo,
                        descripcion: e.target.value,
                      };
                      handleChange("campos", newCampos);
                    }}
                    placeholder="Descripcion (ej: marca del vehiculo mencionado)"
                    disabled={readonly}
                  />
                </div>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={labelClass}>Guardar en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableResultado ?? "datos_extraidos")}
              onChange={(e) => handleChange("variableResultado", e.target.value)}
              placeholder="datos_extraidos"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_sentimiento":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a analizar</span>
            <TextareaConVariables
              value={String(config.texto ?? "{{contexto.mensaje}}")}
              onChange={(v) => handleChange("texto", v)}
              placeholder="{{contexto.mensaje}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Tipo de analisis</span>
            <Select
              value={String(config.tipoAnalisis ?? "basico")}
              onValueChange={(v) => handleChange("tipoAnalisis", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basico">Basico (positivo/negativo/neutro)</SelectItem>
                <SelectItem value="detallado">Detallado (con emociones)</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Guardar en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableResultado ?? "sentimiento")}
              onChange={(e) => handleChange("variableResultado", e.target.value)}
              placeholder="sentimiento"
              disabled={readonly}
            />
          </label>
        </div>
      );

    case "ia_resumir":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Que resumir</span>
            <Select
              value={String(config.fuente ?? "conversacion")}
              onValueChange={(v) => handleChange("fuente", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conversacion">Conversacion completa</SelectItem>
                <SelectItem value="ultimos_mensajes">Ultimos N mensajes</SelectItem>
                <SelectItem value="texto">Texto especifico</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {config.fuente === "ultimos_mensajes" && (
            <label className="block">
              <span className={labelClass}>Cantidad de mensajes</span>
              <Input
                type="number"
                min={1}
                max={50}
                className={inputClass}
                value={Number(config.cantidad ?? 10)}
                onChange={(e) => handleChange("cantidad", Number(e.target.value))}
                disabled={readonly}
              />
            </label>
          )}

          {config.fuente === "texto" && (
            <label className="block">
              <span className={labelClass}>Texto a resumir</span>
              <TextareaConVariables
                value={String(config.texto ?? "")}
                onChange={(v) => handleChange("texto", v)}
                placeholder="Texto a resumir..."
                rows={4}
                className={`${inputClass} h-auto min-h-[100px] resize-y`}
              />
            </label>
          )}

          <label className="block">
            <span className={labelClass}>Longitud del resumen</span>
            <Select
              value={String(config.longitud ?? "corto")}
              onValueChange={(v) => handleChange("longitud", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corto">Corto (1-2 oraciones)</SelectItem>
                <SelectItem value="medio">Medio (1 parrafo)</SelectItem>
                <SelectItem value="largo">Largo (varios parrafos)</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Guardar en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableResultado ?? "resumen")}
              onChange={(e) => handleChange("variableResultado", e.target.value)}
              placeholder="resumen"
              disabled={readonly}
            />
          </label>
        </div>
      );

    case "ia_traducir":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a traducir</span>
            <TextareaConVariables
              value={String(config.texto ?? "{{contexto.mensaje}}")}
              onChange={(v) => handleChange("texto", v)}
              placeholder="{{contexto.mensaje}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Idioma origen</span>
            <Select
              value={String(config.idiomaOrigen ?? "auto")}
              onValueChange={(v) => handleChange("idiomaOrigen", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Detectar automaticamente</SelectItem>
                <SelectItem value="es">Espanol</SelectItem>
                <SelectItem value="en">Ingles</SelectItem>
                <SelectItem value="pt">Portugues</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Idioma destino</span>
            <Select
              value={String(config.idiomaDestino ?? "es")}
              onValueChange={(v) => handleChange("idiomaDestino", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Espanol</SelectItem>
                <SelectItem value="en">Ingles</SelectItem>
                <SelectItem value="pt">Portugues</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Guardar en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableResultado ?? "traduccion")}
              onChange={(e) => handleChange("variableResultado", e.target.value)}
              placeholder="traduccion"
              disabled={readonly}
            />
          </label>
        </div>
      );

    case "ia_spam":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a verificar</span>
            <TextareaConVariables
              value={String(config.texto ?? "{{contexto.mensaje}}")}
              onChange={(v) => handleChange("texto", v)}
              placeholder="{{contexto.mensaje}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Umbral de spam: {Number(config.umbral ?? 80)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Number(config.umbral ?? 80)}
              onChange={(e) => handleChange("umbral", Number(e.target.value))}
              disabled={readonly}
              className="w-full"
            />
            <div className="text-ink-faint flex justify-between text-[10px]">
              <span>0% (todo pasa)</span>
              <span>50%</span>
              <span>100% (muy estricto)</span>
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Guardar resultado en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableResultado ?? "es_spam")}
              onChange={(e) => handleChange("variableResultado", e.target.value)}
              placeholder="es_spam"
              disabled={readonly}
            />
          </label>
        </div>
      );

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo de IA no tiene configuracion adicional
        </p>
      );
  }
}
