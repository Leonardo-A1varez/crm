"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { editorDeConfig } from "@/lib/workflows/config-nodos";
import { TextareaConVariables } from "./TextareaConVariables";

interface ConfigInternoProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  vendedores: ReadonlyArray<{ id: string; nombre: string }>;
  canales: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

/**
 * Formularios de los bloques internos.
 *
 * Qué clave escribe cada campo, y con qué valor arranca uno que nadie tocó,
 * sale del contrato de config (`editorDeConfig`, `lib/workflows/config-nodos.ts`):
 * el mismo schema que revisa el validador. Una clave que el contrato no conoce
 * no compila.
 */
export function ConfigInterno({
  tipo,
  config,
  onChange,
  vendedores,
  canales,
  readonly,
}: ConfigInternoProps) {
  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "int_notif_vendedor": {
      const c = editorDeConfig("int_notif_vendedor", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Notificar a</span>
            <Select
              value={String(c.valores.destinatario)}
              onValueChange={(v) => onChange(c.con("destinatario", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendedor_asignado">Vendedor asignado</SelectItem>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Titulo</span>
            <TextareaConVariables
              value={String(c.valores.titulo ?? "")}
              onChange={(v) => onChange(c.con("titulo", v))}
              placeholder="Nuevo lead: {{lead.nombre}}"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(c.valores.mensaje ?? "")}
              onChange={(v) => onChange(c.con("mensaje", v))}
              placeholder="{{lead.nombre}} está en la etapa {{lead.etapa}}"
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Urgencia</span>
            <Select
              value={String(c.valores.urgencia)}
              onValueChange={(v) => onChange(c.con("urgencia", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="baja">Baja</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="urgente">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(c.valores.enviarPush)}
              onChange={(e) => onChange(c.con("enviarPush", e.target.checked))}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Enviar notificacion push</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(c.valores.enviarEmail)}
              onChange={(e) => onChange(c.con("enviarEmail", e.target.checked))}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Enviar tambien por email</span>
          </label>
        </div>
      );
    }

    case "int_notif_grupo": {
      const c = editorDeConfig("int_notif_grupo", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Canal/Grupo</span>
            <Select
              value={String(c.valores.canalId ?? "")}
              onValueChange={(v) => onChange(c.con("canalId", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar canal" />
              </SelectTrigger>
              <SelectContent>
                {canales.length === 0 ? (
                  <SelectItem value="" disabled>
                    No hay canales configurados
                  </SelectItem>
                ) : (
                  canales.map((canal) => (
                    <SelectItem key={canal.id} value={canal.id}>
                      {canal.nombre}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(c.valores.mensaje ?? "")}
              onChange={(v) => onChange(c.con("mensaje", v))}
              placeholder="Notificacion para el equipo..."
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(c.valores.mencionarTodos)}
              onChange={(e) => onChange(c.con("mencionarTodos", e.target.checked))}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Mencionar a todos (@todos)</span>
          </label>
        </div>
      );
    }

    case "int_comentario": {
      const c = editorDeConfig("int_comentario", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Comentario interno</span>
            <TextareaConVariables
              value={String(c.valores.comentario ?? "")}
              onChange={(v) => onChange(c.con("comentario", v))}
              placeholder="Nota interna visible solo para el equipo..."
              rows={4}
              className={`${inputClass} h-auto min-h-[100px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Autor</span>
            <Select
              value={String(c.valores.autor)}
              onValueChange={(v) => onChange(c.con("autor", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sistema">Sistema (Workflow)</SelectItem>
                <SelectItem value="vendedor_asignado">Vendedor asignado</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <div className="text-ink-faint bg-surface-hover rounded-md p-2 text-[10px]">
            Los comentarios internos no son visibles para el cliente
          </div>
        </div>
      );
    }

    case "int_debug": {
      const c = editorDeConfig("int_debug", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Nivel de log</span>
            <Select
              value={String(c.valores.nivel)}
              onValueChange={(v) => onChange(c.con("nivel", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(c.valores.mensaje ?? "")}
              onChange={(v) => onChange(c.con("mensaje", v))}
              placeholder="Lead {{lead.nombre}} en etapa {{sesion.current_stage}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Variables a loggear</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(c.valores.variables ?? "")}
              onChange={(e) => onChange(c.con("variables", e.target.value))}
              placeholder="lead, sesion.pieza_buscada"
              disabled={readonly}
            />
            <span className="text-ink-faint mt-1 block text-[10px]">
              Separadas por coma. Se incluiran en el log como JSON.
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(c.valores.pausar)}
              onChange={(e) => onChange(c.con("pausar", e.target.checked))}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">
              Pausar ejecucion aqui (modo debug)
            </span>
          </label>
        </div>
      );
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo interno no tiene configuracion adicional
        </p>
      );
  }
}
