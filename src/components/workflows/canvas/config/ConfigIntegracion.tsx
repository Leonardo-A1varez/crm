"use client";

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
import { editorDeConfig, type ConfigDeTipo } from "@/lib/workflows/config-nodos";
import { TextareaConVariables } from "./TextareaConVariables";

interface ConfigIntegracionProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readonly?: boolean;
}

type Header = ConfigDeTipo<"int_http">["headers"][number];

/**
 * Formularios de los bloques de integración.
 *
 * Qué clave escribe cada campo, y con qué valor arranca uno que nadie tocó,
 * sale del contrato de config (`editorDeConfig`, `lib/workflows/config-nodos.ts`):
 * el mismo schema que revisa el validador. Una clave que el contrato no conoce
 * no compila.
 */
export function ConfigIntegracion({ tipo, config, onChange, readonly }: ConfigIntegracionProps) {
  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "int_http": {
      const c = editorDeConfig("int_http", config);
      const headers = Array.isArray(c.valores.headers) ? (c.valores.headers as Header[]) : [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Metodo</span>
            <Select
              value={String(c.valores.metodo)}
              onValueChange={(v) => onChange(c.con("metodo", v))}
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
              value={String(c.valores.url ?? "")}
              onChange={(v) => onChange(c.con("url", v))}
              placeholder="https://api.example.com/endpoint?tel={{lead.telefono}}"
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
                  onClick={() => onChange(c.con("headers", [...headers, { key: "", value: "" }]))}
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
                      onChange(c.con("headers", newHeaders));
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
                      onChange(c.con("headers", newHeaders));
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
                        onChange(
                          c.con(
                            "headers",
                            headers.filter((_, i) => i !== idx),
                          ),
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

          {["POST", "PUT", "PATCH"].includes(String(c.valores.metodo)) && (
            <label className="block">
              <span className={labelClass}>Body (JSON)</span>
              <Textarea
                className={`${inputClass} h-auto min-h-[120px] resize-y font-mono text-[11px]`}
                value={String(c.valores.body)}
                onChange={(e) => onChange(c.con("body", e.target.value))}
                placeholder={`{
  "telefono": "{{lead.telefono}}",
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
              value={String(c.valores.variableRespuesta)}
              onChange={(e) => onChange(c.con("variableRespuesta", e.target.value))}
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
              value={Number(c.valores.timeout)}
              onChange={(e) => onChange(c.con("timeout", Number(e.target.value)))}
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "int_webhook_out": {
      const c = editorDeConfig("int_webhook_out", config);
      const headers = Array.isArray(c.valores.headers) ? (c.valores.headers as Header[]) : [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>URL del webhook</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(c.valores.url ?? "")}
              onChange={(e) => onChange(c.con("url", e.target.value))}
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
                  onClick={() => onChange(c.con("headers", [...headers, { key: "", value: "" }]))}
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
                      onChange(c.con("headers", newHeaders));
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
                      onChange(c.con("headers", newHeaders));
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
                        onChange(
                          c.con(
                            "headers",
                            headers.filter((_, i) => i !== idx),
                          ),
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
              value={String(c.valores.payloadTipo)}
              onValueChange={(v) => onChange(c.con("payloadTipo", v))}
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

          {c.valores.payloadTipo === "custom" && (
            <label className="block">
              <span className={labelClass}>Payload personalizado (JSON)</span>
              <Textarea
                className={`${inputClass} h-auto min-h-[100px] resize-y font-mono text-[11px]`}
                value={String(c.valores.payloadCustom)}
                onChange={(e) => onChange(c.con("payloadCustom", e.target.value))}
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

    case "int_codigo": {
      const c = editorDeConfig("int_codigo", config);
      return (
        <div className="flex flex-col gap-3">
          <div className="text-ink-faint bg-surface-hover rounded-md p-2 text-[10px]">
            Variables disponibles: <code>lead</code>, <code>sesion</code>, <code>contexto</code>
          </div>

          <label className="block">
            <span className={labelClass}>Codigo JavaScript</span>
            <Textarea
              className={`${inputClass} h-auto min-h-[200px] resize-y font-mono text-[11px]`}
              value={String(c.valores.codigo ?? "")}
              onChange={(e) => onChange(c.con("codigo", e.target.value))}
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
              value={String(c.valores.variableSalida)}
              onChange={(e) => onChange(c.con("variableSalida", e.target.value))}
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
              value={Number(c.valores.timeout)}
              onChange={(e) => onChange(c.con("timeout", Number(e.target.value)))}
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "int_email": {
      const c = editorDeConfig("int_email", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Para</span>
            <TextareaConVariables
              value={String(c.valores.para ?? "")}
              onChange={(v) => onChange(c.con("para", v))}
              placeholder="{{lead.email}} o email@ejemplo.com"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Asunto</span>
            <TextareaConVariables
              value={String(c.valores.asunto ?? "")}
              onChange={(v) => onChange(c.con("asunto", v))}
              placeholder="Cotizacion para {{lead.nombre}}"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Cuerpo</span>
            <TextareaConVariables
              value={String(c.valores.cuerpo ?? "")}
              onChange={(v) => onChange(c.con("cuerpo", v))}
              placeholder="Hola {{lead.nombre}}..."
              rows={6}
              className={`${inputClass} h-auto min-h-[150px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>CC (opcional)</span>
            <Input
              className={inputClass}
              value={String(c.valores.cc ?? "")}
              onChange={(e) => onChange(c.con("cc", e.target.value))}
              placeholder="copia@empresa.com"
              disabled={readonly}
            />
          </label>
        </div>
      );
    }

    case "int_sheets": {
      const c = editorDeConfig("int_sheets", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>ID de la hoja</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(c.valores.sheetId ?? "")}
              onChange={(e) => onChange(c.con("sheetId", e.target.value))}
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Nombre de la pestana</span>
            <Input
              className={inputClass}
              value={String(c.valores.pestana ?? "")}
              onChange={(e) => onChange(c.con("pestana", e.target.value))}
              placeholder="Leads"
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Operacion</span>
            <Select
              value={String(c.valores.operacion)}
              onValueChange={(v) => onChange(c.con("operacion", v))}
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

          {c.valores.operacion === "append" && (
            <label className="block">
              <span className={labelClass}>Columnas a escribir</span>
              <Input
                className={inputClass}
                value={String(c.valores.columnas ?? "")}
                onChange={(e) => onChange(c.con("columnas", e.target.value))}
                placeholder="{{lead.nombre}}, {{lead.telefono}}, {{lead.etapa}}"
                disabled={readonly}
              />
              <span className="text-ink-faint mt-1 block text-[10px]">
                Separadas por coma, en orden de columnas
              </span>
            </label>
          )}

          {c.valores.operacion === "read" && (
            <label className="block">
              <span className={labelClass}>Rango</span>
              <Input
                className={inputClass}
                value={String(c.valores.rango ?? "")}
                onChange={(e) => onChange(c.con("rango", e.target.value))}
                placeholder="A1:D100"
                disabled={readonly}
              />
            </label>
          )}
        </div>
      );
    }

    case "int_db": {
      const c = editorDeConfig("int_db", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Consulta SQL</span>
            <Textarea
              className={`${inputClass} h-auto min-h-[120px] resize-y font-mono text-[11px]`}
              value={String(c.valores.query ?? "")}
              onChange={(e) => onChange(c.con("query", e.target.value))}
              placeholder={`SELECT * FROM productos
WHERE codigo = $1`}
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Parametros (JSON array)</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(c.valores.params)}
              onChange={(e) => onChange(c.con("params", e.target.value))}
              placeholder='["{{lead.telefono}}"]'
              disabled={readonly}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Guardar resultado en</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(c.valores.variableResultado)}
              onChange={(e) => onChange(c.con("variableResultado", e.target.value))}
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
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo de integracion no tiene configuracion adicional
        </p>
      );
  }
}
