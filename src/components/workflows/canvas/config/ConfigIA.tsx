"use client";

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
import { editorDeConfig, type ConfigDeTipo } from "@/lib/workflows/config-nodos";
import { TextareaConVariables } from "./TextareaConVariables";
import { Badge } from "@/components/ui/badge";

interface ConfigIAProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  intents: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

type CampoExtraccion = ConfigDeTipo<"ia_extraer">["campos"][number];

/**
 * Formularios de los bloques de IA.
 *
 * Qué clave escribe cada campo, y con qué valor arranca uno que nadie tocó,
 * sale del contrato de config (`editorDeConfig`, `lib/workflows/config-nodos.ts`):
 * el mismo schema que revisa el validador. Una clave que el contrato no conoce
 * no compila.
 */
export function ConfigIA({ tipo, config, onChange, intents, readonly }: ConfigIAProps) {
  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "ia_clasificar": {
      const c = editorDeConfig("ia_clasificar", config);
      const selectedIntents = Array.isArray(c.valores.intentIds)
        ? (c.valores.intentIds as string[])
        : [];
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
                          onChange(
                            c.con(
                              "intentIds",
                              selectedIntents.filter((id) => id !== intentId),
                            ),
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
                  onChange(c.con("intentIds", [...selectedIntents, v]));
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
            <span className={labelClass}>Umbral de confianza: {Number(c.valores.umbral)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Number(c.valores.umbral)}
              onChange={(e) => onChange(c.con("umbral", Number(e.target.value)))}
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
              value={String(c.valores.variableResultado)}
              onChange={(e) => onChange(c.con("variableResultado", e.target.value))}
              placeholder="intent_detectado"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_responder": {
      const c = editorDeConfig("ia_responder", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Instrucciones para el modelo</span>
            <TextareaConVariables
              value={String(c.valores.instrucciones ?? "")}
              onChange={(v) => onChange(c.con("instrucciones", v))}
              placeholder="Eres un asistente de ventas para repuestos automotrices. El cliente se llama {{lead.nombre}} y está en la etapa {{lead.etapa}}..."
              rows={6}
              className={`${inputClass} h-auto min-h-[150px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Modelo</span>
            <Select
              value={String(c.valores.modelo)}
              onValueChange={(v) => onChange(c.con("modelo", v))}
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
              Temperatura: {Number(c.valores.temperatura).toFixed(1)}
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={Number(c.valores.temperatura)}
              onChange={(e) => onChange(c.con("temperatura", Number(e.target.value)))}
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
              value={Number(c.valores.maxTokens)}
              onChange={(e) => onChange(c.con("maxTokens", Number(e.target.value)))}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Guardar respuesta en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(c.valores.variableRespuesta)}
              onChange={(e) => onChange(c.con("variableRespuesta", e.target.value))}
              placeholder="respuesta_ia"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_extraer": {
      const c = editorDeConfig("ia_extraer", config);
      const campos = Array.isArray(c.valores.campos) ? (c.valores.campos as CampoExtraccion[]) : [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a analizar</span>
            <TextareaConVariables
              value={String(c.valores.texto ?? "")}
              onChange={(v) => onChange(c.con("texto", v))}
              placeholder="Texto a analizar, con variables como {{lead.nombre}}"
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
                    onChange(
                      c.con("campos", [...campos, { nombre: "", tipo: "texto", descripcion: "" }]),
                    )
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
                        onChange(c.con("campos", newCampos));
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
                        onChange(c.con("campos", newCampos));
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
                          onChange(
                            c.con(
                              "campos",
                              campos.filter((_, i) => i !== idx),
                            ),
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
                      onChange(c.con("campos", newCampos));
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
              value={String(c.valores.variableResultado)}
              onChange={(e) => onChange(c.con("variableResultado", e.target.value))}
              placeholder="datos_extraidos"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_sentimiento": {
      const c = editorDeConfig("ia_sentimiento", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a analizar</span>
            <TextareaConVariables
              value={String(c.valores.texto ?? "")}
              onChange={(v) => onChange(c.con("texto", v))}
              placeholder="Texto a analizar, con variables como {{lead.nombre}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Tipo de analisis</span>
            <Select
              value={String(c.valores.tipoAnalisis)}
              onValueChange={(v) => onChange(c.con("tipoAnalisis", v))}
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
              value={String(c.valores.variableResultado)}
              onChange={(e) => onChange(c.con("variableResultado", e.target.value))}
              placeholder="sentimiento"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_resumir": {
      const c = editorDeConfig("ia_resumir", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Que resumir</span>
            <Select
              value={String(c.valores.fuente)}
              onValueChange={(v) => onChange(c.con("fuente", v))}
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

          {c.valores.fuente === "ultimos_mensajes" && (
            <label className="block">
              <span className={labelClass}>Cantidad de mensajes</span>
              <Input
                type="number"
                min={1}
                max={50}
                className={inputClass}
                value={Number(c.valores.cantidad)}
                onChange={(e) => onChange(c.con("cantidad", Number(e.target.value)))}
                disabled={readonly}
              />
            </label>
          )}

          {c.valores.fuente === "texto" && (
            <label className="block">
              <span className={labelClass}>Texto a resumir</span>
              <TextareaConVariables
                value={String(c.valores.texto ?? "")}
                onChange={(v) => onChange(c.con("texto", v))}
                placeholder="Texto a resumir..."
                rows={4}
                className={`${inputClass} h-auto min-h-[100px] resize-y`}
              />
            </label>
          )}

          <label className="block">
            <span className={labelClass}>Longitud del resumen</span>
            <Select
              value={String(c.valores.longitud)}
              onValueChange={(v) => onChange(c.con("longitud", v))}
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
              value={String(c.valores.variableResultado)}
              onChange={(e) => onChange(c.con("variableResultado", e.target.value))}
              placeholder="resumen"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_traducir": {
      const c = editorDeConfig("ia_traducir", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a traducir</span>
            <TextareaConVariables
              value={String(c.valores.texto ?? "")}
              onChange={(v) => onChange(c.con("texto", v))}
              placeholder="Texto a analizar, con variables como {{lead.nombre}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Idioma origen</span>
            <Select
              value={String(c.valores.idiomaOrigen)}
              onValueChange={(v) => onChange(c.con("idiomaOrigen", v))}
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
              value={String(c.valores.idiomaDestino)}
              onValueChange={(v) => onChange(c.con("idiomaDestino", v))}
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
              value={String(c.valores.variableResultado)}
              onChange={(e) => onChange(c.con("variableResultado", e.target.value))}
              placeholder="traduccion"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "ia_spam": {
      const c = editorDeConfig("ia_spam", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Texto a verificar</span>
            <TextareaConVariables
              value={String(c.valores.texto ?? "")}
              onChange={(v) => onChange(c.con("texto", v))}
              placeholder="Texto a analizar, con variables como {{lead.nombre}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Umbral de spam: {Number(c.valores.umbral)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Number(c.valores.umbral)}
              onChange={(e) => onChange(c.con("umbral", Number(e.target.value)))}
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
              value={String(c.valores.variableResultado)}
              onChange={(e) => onChange(c.con("variableResultado", e.target.value))}
              placeholder="es_spam"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo de IA no tiene configuracion adicional
        </p>
      );
  }
}
