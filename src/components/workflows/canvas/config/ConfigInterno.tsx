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
import { TextareaConVariables } from "./TextareaConVariables";

interface ConfigInternoProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  vendedores: ReadonlyArray<{ id: string; nombre: string }>;
  canales: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

export function ConfigInterno({
  tipo,
  config,
  onChange,
  vendedores,
  canales,
  readonly,
}: ConfigInternoProps) {
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
    case "int_notif_vendedor":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Notificar a</span>
            <Select
              value={String(config.destinatario ?? "vendedor_asignado")}
              onValueChange={(v) => handleChange("destinatario", v)}
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
              value={String(config.titulo ?? "")}
              onChange={(v) => handleChange("titulo", v)}
              placeholder="Nuevo lead: {{lead.nombre}}"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(config.mensaje ?? "")}
              onChange={(v) => handleChange("mensaje", v)}
              placeholder="{{lead.nombre}} busca {{sesion.pieza_buscada}}"
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Urgencia</span>
            <Select
              value={String(config.urgencia ?? "normal")}
              onValueChange={(v) => handleChange("urgencia", v)}
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
              checked={Boolean(config.enviarPush ?? true)}
              onChange={(e) => handleChange("enviarPush", e.target.checked)}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Enviar notificacion push</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(config.enviarEmail ?? false)}
              onChange={(e) => handleChange("enviarEmail", e.target.checked)}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Enviar tambien por email</span>
          </label>
        </div>
      );

    case "int_notif_grupo":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Canal/Grupo</span>
            <Select
              value={String(config.canalId ?? "")}
              onValueChange={(v) => handleChange("canalId", v)}
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
                  canales.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Mensaje</span>
            <TextareaConVariables
              value={String(config.mensaje ?? "")}
              onChange={(v) => handleChange("mensaje", v)}
              placeholder="Notificacion para el equipo..."
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(config.mencionarTodos ?? false)}
              onChange={(e) => handleChange("mencionarTodos", e.target.checked)}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Mencionar a todos (@todos)</span>
          </label>
        </div>
      );

    case "int_comentario":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Comentario interno</span>
            <TextareaConVariables
              value={String(config.comentario ?? "")}
              onChange={(v) => handleChange("comentario", v)}
              placeholder="Nota interna visible solo para el equipo..."
              rows={4}
              className={`${inputClass} h-auto min-h-[100px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Autor</span>
            <Select
              value={String(config.autor ?? "sistema")}
              onValueChange={(v) => handleChange("autor", v)}
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

    case "int_debug":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Nivel de log</span>
            <Select
              value={String(config.nivel ?? "info")}
              onValueChange={(v) => handleChange("nivel", v)}
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
              value={String(config.mensaje ?? "")}
              onChange={(v) => handleChange("mensaje", v)}
              placeholder="Lead {{lead.id}} en etapa {{sesion.current_stage}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Variables a loggear</span>
            <Input
              className={`${inputClass} font-mono text-[11px]`}
              value={String(config.variables ?? "")}
              onChange={(e) => handleChange("variables", e.target.value)}
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
              checked={Boolean(config.pausar ?? false)}
              onChange={(e) => handleChange("pausar", e.target.checked)}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">
              Pausar ejecucion aqui (modo debug)
            </span>
          </label>
        </div>
      );

    default:
      return (
        <p className="text-ink-faint text-[11px]">
          Este nodo interno no tiene configuracion adicional
        </p>
      );
  }
}
