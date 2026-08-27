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
import { X } from "lucide-react";
import { TextareaConVariables } from "./TextareaConVariables";
import { Badge } from "@/components/ui/badge";

interface ConfigCRMProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  tags: ReadonlyArray<{ id: string; nombre: string; color?: string }>;
  etapas: ReadonlyArray<{ id: string; nombre: string }>;
  vendedores: ReadonlyArray<{ id: string; nombre: string }>;
  campos: ReadonlyArray<{ key: string; label: string; tipo: string }>;
  readonly?: boolean;
}

export function ConfigCRM({
  tipo,
  config,
  onChange,
  tags,
  etapas,
  vendedores,
  campos,
  readonly,
}: ConfigCRMProps) {
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
    case "crm_etiqueta_add":
    case "crm_etiqueta_remove": {
      const selectedTags = (config.tagIds as string[]) ?? [];
      const isAdd = tipo === "crm_etiqueta_add";
      return (
        <div className="flex flex-col gap-3">
          <div>
            <span className={labelClass}>
              {isAdd ? "Etiquetas a asignar" : "Etiquetas a remover"}
            </span>

            <div className="mb-2 flex flex-wrap gap-1">
              {selectedTags.map((tagId) => {
                const tag = tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <Badge
                    key={tagId}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                    style={{
                      backgroundColor: tag.color ? `${tag.color}20` : undefined,
                      borderColor: tag.color ?? undefined,
                    }}
                  >
                    <span className="text-[11px]">{tag.nombre}</span>
                    {!readonly && (
                      <button
                        type="button"
                        onClick={() =>
                          handleChange(
                            "tagIds",
                            selectedTags.filter((id) => id !== tagId),
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
                if (v && !selectedTags.includes(v)) {
                  handleChange("tagIds", [...selectedTags, v]);
                }
              }}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Agregar etiqueta..." />
              </SelectTrigger>
              <SelectContent>
                {tags
                  .filter((t) => !selectedTags.includes(t.id))
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }

    case "crm_etapa":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Mover a etapa</span>
            <Select
              value={String(config.etapaId ?? "")}
              onValueChange={(v) => handleChange("etapaId", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar etapa" />
              </SelectTrigger>
              <SelectContent>
                {etapas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      );

    case "crm_vendedor":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Asignar a vendedor</span>
            <Select
              value={String(config.vendedorId ?? "")}
              onValueChange={(v) => handleChange("vendedorId", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar vendedor" />
              </SelectTrigger>
              <SelectContent>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      );

    case "crm_round_robin": {
      const selectedVendedores = (config.vendedorIds as string[]) ?? [];
      return (
        <div className="flex flex-col gap-3">
          <div>
            <span className={labelClass}>Vendedores en rotacion</span>

            <div className="mb-2 flex flex-wrap gap-1">
              {selectedVendedores.map((vendedorId) => {
                const vendedor = vendedores.find((v) => v.id === vendedorId);
                if (!vendedor) return null;
                return (
                  <Badge
                    key={vendedorId}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                  >
                    <span className="text-[11px]">{vendedor.nombre}</span>
                    {!readonly && (
                      <button
                        type="button"
                        onClick={() =>
                          handleChange(
                            "vendedorIds",
                            selectedVendedores.filter((id) => id !== vendedorId),
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
                if (v && !selectedVendedores.includes(v)) {
                  handleChange("vendedorIds", [...selectedVendedores, v]);
                }
              }}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Agregar vendedor..." />
              </SelectTrigger>
              <SelectContent>
                {vendedores
                  .filter((v) => !selectedVendedores.includes(v.id))
                  .map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.nombre}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <label className="block">
            <span className={labelClass}>Modo de asignacion</span>
            <Select
              value={String(config.modo ?? "secuencial")}
              onValueChange={(v) => handleChange("modo", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="secuencial">Secuencial</SelectItem>
                <SelectItem value="aleatorio">Aleatorio</SelectItem>
                <SelectItem value="por_carga">Por carga</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      );
    }

    case "crm_campo":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo a actualizar</span>
            <Select
              value={String(config.campo ?? "")}
              onValueChange={(v) => handleChange("campo", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar campo" />
              </SelectTrigger>
              <SelectContent>
                {campos.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Nuevo valor</span>
            <TextareaConVariables
              value={String(config.valor ?? "")}
              onChange={(v) => handleChange("valor", v)}
              placeholder="Valor o variable {{lead.nombre}}"
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>
        </div>
      );

    case "crm_tarea":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Titulo de la tarea</span>
            <TextareaConVariables
              value={String(config.titulo ?? "")}
              onChange={(v) => handleChange("titulo", v)}
              placeholder="Seguimiento con {{lead.nombre}}"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Descripcion</span>
            <TextareaConVariables
              value={String(config.descripcion ?? "")}
              onChange={(v) => handleChange("descripcion", v)}
              placeholder="Notas adicionales..."
              rows={2}
              className={`${inputClass} h-auto min-h-[60px] resize-y`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Vence en</span>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                className={`${inputClass} w-20`}
                value={Number(config.vencimiento ?? 24)}
                onChange={(e) => handleChange("vencimiento", Number(e.target.value))}
                disabled={readonly}
              />
              <Select
                value={String(config.unidadVencimiento ?? "horas")}
                onValueChange={(v) => handleChange("unidadVencimiento", v)}
                disabled={readonly}
              >
                <SelectTrigger className={`${selectClass} flex-1`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutos">Minutos</SelectItem>
                  <SelectItem value="horas">Horas</SelectItem>
                  <SelectItem value="dias">Dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Asignar a</span>
            <Select
              value={String(config.asignarA ?? "vendedor_actual")}
              onValueChange={(v) => handleChange("asignarA", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vendedor_actual">Vendedor actual</SelectItem>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      );

    case "crm_nota":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Contenido de la nota</span>
            <TextareaConVariables
              value={String(config.contenido ?? "")}
              onChange={(v) => handleChange("contenido", v)}
              placeholder="Nota interna sobre {{lead.nombre}}"
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>
        </div>
      );

    case "crm_spam":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Razon (opcional)</span>
            <Input
              className={inputClass}
              value={String(config.razon ?? "")}
              onChange={(e) => handleChange("razon", e.target.value)}
              placeholder="Ej: Mensaje promocional"
              disabled={readonly}
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(config.bloquear ?? false)}
              onChange={(e) => handleChange("bloquear", e.target.checked)}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Bloquear futuras conversaciones</span>
          </label>
        </div>
      );

    case "crm_archivar":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Motivo de archivo</span>
            <Select
              value={String(config.motivo ?? "sin_interes")}
              onValueChange={(v) => handleChange("motivo", v)}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sin_interes">Sin interes</SelectItem>
                <SelectItem value="no_calificado">No calificado</SelectItem>
                <SelectItem value="duplicado">Duplicado</SelectItem>
                <SelectItem value="sin_respuesta">Sin respuesta</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      );

    default:
      return (
        <p className="text-ink-faint text-[11px]">Este nodo CRM no tiene configuracion adicional</p>
      );
  }
}
