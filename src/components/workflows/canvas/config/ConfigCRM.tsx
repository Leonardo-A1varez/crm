"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { SelectOpciones } from "@/components/shared/SelectOpciones";
import { X } from "lucide-react";
import { editorDeConfig } from "@/lib/workflows/config-nodos";
import { ETIQUETA_CAMPO_TWIN } from "@/lib/workflows/campo-twin";
import { CAMPOS_TWIN_EDITABLES, ETAPAS_EMBUDO } from "@/types/domain";
import { TextareaConVariables } from "./TextareaConVariables";
import { EditorConVariables } from "./EditorConVariables";
import { Badge } from "@/components/ui/badge";

/**
 * Un flujo sólo mueve entre los pasos del embudo: `perdido` lo decide una
 * persona y `requiere_humano` es el bloque de escalado. El contrato los rechaza
 * igual (`config-nodos.ts`); acá ni se ofrecen.
 */
function esPasoDelEmbudo(id: string): boolean {
  return (ETAPAS_EMBUDO as readonly string[]).includes(id);
}

interface ConfigCRMProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  tags: ReadonlyArray<{ id: string; nombre: string; color?: string }>;
  etapas: ReadonlyArray<{ id: string; nombre: string }>;
  vendedores: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

/**
 * Formularios de los bloques de CRM.
 *
 * Qué clave escribe cada campo, y con qué valor arranca uno que nadie tocó,
 * sale del contrato de config (`editorDeConfig`, `lib/workflows/config-nodos.ts`):
 * el mismo schema que revisa el validador y que leen las acciones
 * `poner_etiqueta` y `cambiar_etapa`. Una clave que el contrato no conoce no
 * compila.
 */
export function ConfigCRM({
  tipo,
  config,
  onChange,
  tags,
  etapas,
  vendedores,
  readonly,
}: ConfigCRMProps) {
  const idTope = useId();
  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "crm_etiqueta_add":
    case "crm_etiqueta_remove": {
      const c = editorDeConfig(tipo, config);
      const selectedTags = Array.isArray(c.valores.tagIds) ? (c.valores.tagIds as string[]) : [];
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
                          onChange(
                            c.con(
                              "tagIds",
                              selectedTags.filter((id) => id !== tagId),
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

            <SelectOpciones
              value=""
              onValueChange={(v) => {
                if (v && !selectedTags.includes(v)) {
                  onChange(c.con("tagIds", [...selectedTags, v]));
                }
              }}
              disabled={readonly}
              className={selectClass}
              placeholder="Agregar etiqueta..."
              opciones={[
                ...tags
                  .filter((t) => !selectedTags.includes(t.id))
                  .map((t) => ({ value: t.id, label: t.nombre })),
              ]}
            />
          </div>
        </div>
      );
    }

    case "crm_etapa": {
      const c = editorDeConfig("crm_etapa", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Mover a etapa</span>
            <SelectOpciones
              value={String(c.valores.etapaId ?? "")}
              onValueChange={(v) => onChange(c.con("etapaId", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Seleccionar etapa"
              opciones={[
                ...etapas
                  .filter((e) => esPasoDelEmbudo(e.id))
                  .map((e) => ({ value: e.id, label: e.nombre })),
              ]}
            />
          </label>
        </div>
      );
    }

    case "crm_vendedor": {
      const c = editorDeConfig("crm_vendedor", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Asignar a vendedor</span>
            <SelectOpciones
              value={String(c.valores.vendedorId ?? "")}
              onValueChange={(v) => onChange(c.con("vendedorId", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Seleccionar vendedor"
              opciones={vendedores.map((v) => ({ value: v.id, label: v.nombre }))}
            />
          </label>
        </div>
      );
    }

    case "crm_round_robin": {
      // Sin selector de modo: el reparto de `lib/round-robin.ts` es uno solo.
      // El tope cuenta sesiones abiertas a la vez por vendedor (decisión del
      // dueño). Vacío = `null` = sin tope. Un 0 o un decimal se guardan tal
      // cual para que el validador los marque en vez de perderlos en silencio.
      const c = editorDeConfig("crm_round_robin", config);
      const selectedVendedores = Array.isArray(c.valores.candidatos)
        ? (c.valores.candidatos as string[])
        : [];
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
                          onChange(
                            c.con(
                              "candidatos",
                              selectedVendedores.filter((id) => id !== vendedorId),
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

            <SelectOpciones
              value=""
              onValueChange={(v) => {
                if (v && !selectedVendedores.includes(v)) {
                  onChange(c.con("candidatos", [...selectedVendedores, v]));
                }
              }}
              disabled={readonly}
              className={selectClass}
              placeholder="Agregar vendedor..."
              opciones={[
                ...vendedores
                  .filter((v) => !selectedVendedores.includes(v.id))
                  .map((v) => ({ value: v.id, label: v.nombre })),
              ]}
            />
          </div>

          <div>
            <label htmlFor={`${idTope}-campo`} className={labelClass}>
              Tope de sesiones abiertas por vendedor
            </label>
            <Input
              id={`${idTope}-campo`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="Sin tope"
              aria-describedby={`${idTope}-ayuda`}
              className={`${inputClass} w-24`}
              value={
                typeof c.valores.topeSesionesAbiertasPorVendedor === "number"
                  ? String(c.valores.topeSesionesAbiertasPorVendedor)
                  : ""
              }
              onChange={(e) =>
                onChange(
                  c.con(
                    "topeSesionesAbiertasPorVendedor",
                    e.target.value === "" ? null : Number(e.target.value),
                  ),
                )
              }
              disabled={readonly}
            />
            <p id={`${idTope}-ayuda`} className="text-ink-secondary mt-1 text-[11px]">
              Cuántas sesiones abiertas a la vez puede tener cada vendedor antes de que la rotación
              lo saltee. Vacío: sin tope.
            </p>
          </div>
        </div>
      );
    }

    case "crm_escalar_humano": {
      const c = editorDeConfig("crm_escalar_humano", config);
      return (
        <div className="flex flex-col gap-3">
          <p className="text-ink-secondary text-[11px] leading-relaxed">
            Pausa la IA en esta conversación y la deja en «requiere humano» para que la tome una
            persona.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.valores.avisarAlCliente !== false}
              onChange={(e) => onChange(c.con("avisarAlCliente", e.target.checked))}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">
              Avisarle al cliente que lo va a atender una persona
            </span>
          </label>
        </div>
      );
    }

    case "crm_campo": {
      const c = editorDeConfig("crm_campo", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Campo del Twin</span>
            <SelectOpciones
              value={String(c.valores.campo ?? "")}
              onValueChange={(v) => onChange(c.con("campo", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Elegí un campo"
              opciones={CAMPOS_TWIN_EDITABLES.map((campo) => ({
                value: campo,
                label: ETIQUETA_CAMPO_TWIN[campo],
              }))}
            />
          </label>

          <EditorConVariables
            etiqueta="Nuevo valor"
            value={String(c.valores.valor ?? "")}
            onChange={(v) => onChange(c.con("valor", v))}
            placeholder="Un texto o un número. Las variables, con «+ Variable»."
            maxLength={2000}
            unaLinea
            readonly={readonly}
          />

          <p className="text-ink-faint text-[11px] text-pretty">
            Son los mismos campos que se corrigen con el lápiz del Twin. Queda anotado que lo
            escribió un flujo; si el cliente dice otra cosa en el turno siguiente, la IA lo puede
            volver a cambiar. Vacío borra el dato.
          </p>
        </div>
      );
    }

    case "crm_tarea": {
      const c = editorDeConfig("crm_tarea", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Titulo de la tarea</span>
            <TextareaConVariables
              value={String(c.valores.titulo ?? "")}
              onChange={(v) => onChange(c.con("titulo", v))}
              placeholder="Seguimiento con {{lead.nombre}}"
              rows={1}
              className={`${inputClass} h-auto`}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Descripcion</span>
            <TextareaConVariables
              value={String(c.valores.descripcion ?? "")}
              onChange={(v) => onChange(c.con("descripcion", v))}
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
                value={Number(c.valores.vencimiento)}
                onChange={(e) => onChange(c.con("vencimiento", Number(e.target.value)))}
                disabled={readonly}
              />
              <SelectOpciones
                value={String(c.valores.unidadVencimiento)}
                onValueChange={(v) => onChange(c.con("unidadVencimiento", v))}
                disabled={readonly}
                className={`${selectClass} flex-1`}
                opciones={[
                  { value: "minutos", label: "Minutos" },
                  { value: "horas", label: "Horas" },
                  { value: "dias", label: "Dias" },
                ]}
              />
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Asignar a</span>
            <SelectOpciones
              value={String(c.valores.asignarA)}
              onValueChange={(v) => onChange(c.con("asignarA", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "vendedor_actual", label: "Vendedor actual" },
                ...vendedores.map((v) => ({ value: v.id, label: v.nombre })),
              ]}
            />
          </label>
        </div>
      );
    }

    case "crm_nota": {
      const c = editorDeConfig("crm_nota", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Contenido de la nota</span>
            <TextareaConVariables
              value={String(c.valores.contenido ?? "")}
              onChange={(v) => onChange(c.con("contenido", v))}
              placeholder="Nota interna sobre {{lead.nombre}}"
              rows={3}
              className={`${inputClass} h-auto min-h-[80px] resize-y`}
            />
          </label>
        </div>
      );
    }

    case "crm_spam": {
      const c = editorDeConfig("crm_spam", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Razon (opcional)</span>
            <Input
              className={inputClass}
              value={String(c.valores.razon ?? "")}
              onChange={(e) => onChange(c.con("razon", e.target.value))}
              placeholder="Ej: Mensaje promocional"
              disabled={readonly}
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(c.valores.bloquear)}
              onChange={(e) => onChange(c.con("bloquear", e.target.checked))}
              disabled={readonly}
              className="h-4 w-4 rounded"
            />
            <span className="text-ink-secondary text-[11px]">Bloquear futuras conversaciones</span>
          </label>
        </div>
      );
    }

    case "crm_archivar": {
      const c = editorDeConfig("crm_archivar", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Motivo de archivo</span>
            <SelectOpciones
              value={String(c.valores.motivo)}
              onValueChange={(v) => onChange(c.con("motivo", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "sin_interes", label: "Sin interes" },
                { value: "no_calificado", label: "No calificado" },
                { value: "duplicado", label: "Duplicado" },
                { value: "sin_respuesta", label: "Sin respuesta" },
                { value: "otro", label: "Otro" },
              ]}
            />
          </label>
        </div>
      );
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">Este nodo CRM no tiene configuracion adicional</p>
      );
  }
}
