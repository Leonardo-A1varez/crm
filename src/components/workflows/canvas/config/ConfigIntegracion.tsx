"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { TextareaConVariables } from "./TextareaConVariables";

interface ConfigIntegracionProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readonly?: boolean;
}

interface Header {
  key: string;
  value: string;
}

export function ConfigIntegracion({ tipo, config, onChange, readonly }: ConfigIntegracionProps) {
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
    case "int_http": {
      const headers = (config.headers as Header[]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Metodo</span>
            <Select
              value={String(config.metodo ?? "GET")}
              onValueChange={(v) => handleChange("metodo", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>URL</span>
            <TextareaConVariables
              value={String(config.url ?? "")}
              onChange={(v) => handleChange("url", v)}
              placeholder="https://api.example.com/endpoint?id={{lead.id}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[50px] resize-y font-mono text-[11px]`}
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Headers</span>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => handleChange("headers", [...headers, { key: "", value: "" }])}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar
                </Button>
              )}
            </div>

            <div className="space-y-1">
              {headers.map((header, idx) => (
                <div key={idx} className="flex gap-1">
                  <Input
                    className={`${inputClass} w-[120px] font-mono text-[11px]`}
                    value={header.key}
                    onChange={(e) => {
                      const newHeaders = [...headers];
                      newHeaders[idx] = { ...header, key: e.target.value };
                      handleChange("headers", newHeaders);
                    }}
                    placeholder="Content-Type"
                    disabled={readonly}
                  />
                  <Input
                    className={`${inputClass} flex-1 font-mono text-[11px]`}
                    value={header.value}
                    onChange={(e) => {
                      const newHeaders = [...headers];
                      newHeaders[idx] = { ...header, value: e.target.value };
                      handleChange("headers", newHeaders);
                    }}
                    placeholder="application/json"
                    disabled={readonly}
                  />
                  {!readonly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500"
                      onClick={() =>
                        handleChange(
                          "headers",
                          headers.filter((_, i) => i !== idx),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {["POST", "PUT", "PATCH"].includes(String(config.metodo ?? "GET")) && (
            <label className="block">
              <span className={labelClass}>Body (JSON)</span>
              <Textarea
                className={`${inputClass} h-auto min-h-[120px] resize-y font-mono text-[11px]`}
                value={String(config.body ?? "{}")}
                onChange={(e) => handleChange("body", e.target.value)}
                placeholder={`{
  "leadId": "{{lead.id}}",
  "nombre": "{{lead.nombre}}"
}`}
                disabled={readonly}
              />
              <span className="text-ink-faint mt-1 block text-[10px]">
                Puedes usar variables como {`{{lead.nombre}}`}
              </span>
            </label>
          )}

          <label className="block">
            <span className={labelClass}>Guardar respuesta en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableRespuesta ?? "respuesta_http")}
              onChange={(e) => handleChange("variableRespuesta", e.target.value)}
              placeholder="respuesta_http"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Timeout (segundos)</span>
            <Input
              type="number"
              min={1}
              max={60}
              className={inputClass}
              value={Number(config.timeout ?? 30)}
              onChange={(e) => handleChange("timeout", Number(e.target.value))}
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "int_webhook_out": {
      const headers = (config.headers as Header[]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>URL del webhook</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.url ?? "")}
              onChange={(e) => handleChange("url", e.target.value)}
              placeholder="https://webhook.site/..."
              disabled={readonly}
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass}>Headers adicionales</span>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => handleChange("headers", [...headers, { key: "", value: "" }])}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar
                </Button>
              )}
            </div>

            <div className="space-y-1">
              {headers.map((header, idx) => (
                <div key={idx} className="flex gap-1">
                  <Input
                    className={`${inputClass} flex-1 font-mono text-[11px]`}
                    value={header.key}
                    onChange={(e) => {
                      const newHeaders = [...headers];
                      newHeaders[idx] = { ...header, key: e.target.value };
                      handleChange("headers", newHeaders);
                    }}
                    placeholder="Key"
                    disabled={readonly}
                  />
                  <Input
                    className={`${inputClass} flex-1 font-mono text-[11px]`}
                    value={header.value}
                    onChange={(e) => {
                      const newHeaders = [...headers];
                      newHeaders[idx] = { ...header, value: e.target.value };
                      handleChange("headers", newHeaders);
                    }}
                    placeholder="Value"
                    disabled={readonly}
                  />
                  {!readonly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500"
                      onClick={() =>
                        handleChange(
                          "headers",
                          headers.filter((_, i) => i !== idx),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={labelClass}>Payload</span>
            <Select
              value={String(config.payloadTipo ?? "completo")}
              onValueChange={(v) => handleChange("payloadTipo", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completo">Lead + Sesion completo</SelectItem>
                <SelectItem value="minimo">Solo ID y etapa</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {config.payloadTipo === "custom" && (
            <label className="block">
              <span className={labelClass}>Payload personalizado (JSON)</span>
              <Textarea
                className={`${inputClass} h-auto min-h-[100px] resize-y font-mono text-[11px]`}
                value={String(config.payloadCustom ?? "{}")}
                onChange={(e) => handleChange("payloadCustom", e.target.value)}
                placeholder={`{
  "event": "lead_update",
  "data": { ... }
}`}
                disabled={readonly}
              />
            </label>
          )}
        </div>
      );
    }

    case "int_codigo":
      return (
        <div className="flex flex-col gap-3">
          <div className="text-ink-faint bg-surface-hover rounded-md p-2 text-[10px]">
            Variables disponibles: <code>lead</code>, <code>sesion</code>, <code>contexto</code>
          </div>

          <label className="block">
            <span className={labelClass}>Codigo JavaScript</span>
            <Textarea
              className={`${inputClass} h-auto min-h-[200px] resize-y font-mono text-[11px]`}
              value={String(config.codigo ?? "")}
              onChange={(e) => handleChange("codigo", e.target.value)}
              placeholder={`// Ejemplo: transformar datos
const resultado = {
  nombreCompleto: lead.nombre,
  piezas: sesion.pieza_buscada?.split(',') ?? []
};

return resultado;`}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Guardar resultado en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableSalida ?? "resultado_codigo")}
              onChange={(e) => handleChange("variableSalida", e.target.value)}
              placeholder="resultado_codigo"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Timeout (ms)</span>
            <Input
              type="number"
              min={100}
              max={10000}
              className={inputClass}
              value={Number(config.timeout ?? 5000)}
              onChange={(e) => handleChange("timeout", Number(e.target.value))}
              disabled={readonly}
            />
          </label>
        </div>
      );

    case "int_email":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Para</span>
            <TextareaConVariables
              value={String(config.para ?? "")}
              onChange={(v) => handleChange("para", v)}
              placeholder="{{lead.email}} o email@ejemplo.com"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Asunto</span>
            <TextareaConVariables
              value={String(config.asunto ?? "")}
              onChange={(v) => handleChange("asunto", v)}
              placeholder="Cotizacion para {{lead.nombre}}"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Cuerpo</span>
            <TextareaConVariables
              value={String(config.cuerpo ?? "")}
              onChange={(v) => handleChange("cuerpo", v)}
              placeholder="Hola {{lead.nombre}}..."
              rows={6}
              className={`${inputClass} h-auto min-h-[150px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>CC (opcional)</span>
            <Input
              className={inputClass}
              value={String(config.cc ?? "")}
              onChange={(e) => handleChange("cc", e.target.value)}
              placeholder="copia@empresa.com"
              disabled={readonly}
            />
          </label>
        </div>
      );

    case "int_sheets":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>ID de la hoja</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.sheetId ?? "")}
              onChange={(e) => handleChange("sheetId", e.target.value)}
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Nombre de la pestana</span>
            <Input
              className={inputClass}
              value={String(config.pestana ?? "")}
              onChange={(e) => handleChange("pestana", e.target.value)}
              placeholder="Leads"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Operacion</span>
            <Select
              value={String(config.operacion ?? "append")}
              onValueChange={(v) => handleChange("operacion", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">Agregar fila</SelectItem>
                <SelectItem value="read">Leer datos</SelectItem>
                <SelectItem value="update">Actualizar fila</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {config.operacion === "append" && (
            <label className="block">
              <span className={labelClass}>Columnas a escribir</span>
              <Input
                className={inputClass}
                value={String(config.columnas ?? "")}
                onChange={(e) => handleChange("columnas", e.target.value)}
                placeholder="{{lead.nombre}}, {{lead.telefono}}, {{sesion.pieza_buscada}}"
                disabled={readonly}
              />
              <span className="text-ink-faint mt-1 block text-[10px]">
                Separadas por coma, en orden de columnas
              </span>
            </label>
          )}

          {config.operacion === "read" && (
            <label className="block">
              <span className={labelClass}>Rango</span>
              <Input
                className={inputClass}
                value={String(config.rango ?? "")}
                onChange={(e) => handleChange("rango", e.target.value)}
                placeholder="A1:D100"
                disabled={readonly}
              />
            </label>
          )}
        </div>
      );

    case "int_db":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Consulta SQL</span>
            <Textarea
              className={`${inputClass} h-auto min-h-[120px] resize-y font-mono text-[11px]`}
              value={String(config.query ?? "")}
              onChange={(e) => handleChange("query", e.target.value)}
              placeholder={`SELECT * FROM productos
WHERE codigo = $1`}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Parametros (JSON array)</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.params ?? "[]")}
              onChange={(e) => handleChange("params", e.target.value)}
              placeholder='["{{contexto.codigo}}"]'
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Guardar resultado en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variableResultado ?? "resultado_db")}
              onChange={(e) => handleChange("variableResultado", e.target.value)}
              placeholder="resultado_db"
              disabled={readonly}
            />
          </label>

          <div className="border-l-2 border-yellow-500 bg-yellow-500/10 p-2">
            <p className="text-[10px] text-yellow-200">
              Solo SELECT permitido. Las consultas se ejecutan con permisos de solo lectura.
            </p>
          </div>
        </div>
      );

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo de integracion no tiene configuracion adicional
        </p>
      );
  }
}
