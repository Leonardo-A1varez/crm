"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SelectOpciones } from "@/components/shared/SelectOpciones";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { editorDeConfig } from "@/lib/workflows/config-nodos";

interface ConfigTriggerProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  etapas: ReadonlyArray<{ id: string; nombre: string }>;
  /** Las difusiones que salieron o van a salir: las que alguien puede responder. */
  difusiones?: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

/** Radix no admite `""` como valor de un ítem: "cualquiera" viaja con este. */
const CUALQUIER_DIFUSION = "__cualquiera__";

/**
 * Formularios de los disparadores.
 *
 * Qué clave escribe cada campo, y con qué valor arranca uno que nadie tocó,
 * sale del contrato de config (`editorDeConfig`, `lib/workflows/config-nodos.ts`):
 * el mismo schema que revisa el validador antes de publicar. Una clave que el
 * contrato no conoce no compila.
 */
export function ConfigTrigger({
  tipo,
  config,
  onChange,
  tags,
  etapas,
  difusiones = [],
  readonly,
}: ConfigTriggerProps) {
  const [showSecret, setShowSecret] = useState(false);

  const labelClass = "text-ink-secondary mb-1 block text-[11px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px]";
  const inputClass = "border-line-control bg-surface-root text-ink-primary w-full text-[12px] h-8";

  switch (tipo) {
    case "trigger_mensaje": {
      const c = editorDeConfig("trigger_mensaje", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Canal</span>
            <SelectOpciones
              value={String(c.valores.canal)}
              onValueChange={(v) => onChange(c.con("canal", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "todos", label: "Todos los canales" },
                { value: "whatsapp", label: "WhatsApp" },
                { value: "instagram", label: "Instagram" },
                { value: "messenger", label: "Messenger" },
              ]}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Filtro de mensaje</span>
            <SelectOpciones
              value={String(c.valores.filtro)}
              onValueChange={(v) => onChange(c.con("filtro", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "todos", label: "Todos los mensajes" },
                { value: "solo_texto", label: "Solo texto" },
                { value: "solo_media", label: "Solo media" },
                { value: "contiene", label: "Contiene palabra" },
              ]}
            />
          </label>

          {c.valores.filtro === "contiene" && (
            <label className="block">
              <span className={labelClass}>Palabra clave</span>
              <Input
                className={inputClass}
                value={String(c.valores.palabra ?? "")}
                onChange={(e) => onChange(c.con("palabra", e.target.value))}
                placeholder="Ej: promocion"
                disabled={readonly}
              />
            </label>
          )}

          <label className="border-line-card bg-surface-root flex items-start gap-2.5 rounded-[9px] border px-2.5 py-2.5">
            <input
              type="checkbox"
              checked={c.valores.interceptaLlm === true}
              onChange={(e) => onChange(c.con("interceptaLlm", e.target.checked))}
              disabled={readonly}
              className="accent-brand mt-[2px] h-4 w-4 shrink-0 rounded"
            />
            <span className="flex flex-col gap-1">
              <span className="text-ink-primary text-[11.5px] font-medium">
                Contestar en lugar del agente
              </span>
              <span className="text-ink-faint text-[10.5px] leading-snug text-pretty">
                Si el mensaje pasa este filtro y cumple las condiciones que siguen, contesta este
                flujo y el agente de IA no responde ese mensaje. Si no las cumple, contesta el
                agente como siempre. Si dos flujos lo hacen con el mismo mensaje, contesta el
                publicado hace más tiempo.
              </span>
            </span>
          </label>
        </div>
      );
    }

    case "trigger_cron": {
      const c = editorDeConfig("trigger_cron", config);
      const dias = Array.isArray(c.valores.dias) ? (c.valores.dias as number[]) : [];
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Frecuencia</span>
            <SelectOpciones
              value={String(c.valores.frecuencia)}
              onValueChange={(v) => onChange(c.con("frecuencia", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "cada_hora", label: "Cada hora" },
                { value: "diario", label: "Diario" },
                { value: "semanal", label: "Semanal" },
                { value: "mensual", label: "Mensual" },
                { value: "personalizado", label: "Personalizado" },
              ]}
            />
          </label>

          {c.valores.frecuencia !== "personalizado" && (
            <label className="block">
              <span className={labelClass}>Hora</span>
              <Input
                type="time"
                className={inputClass}
                value={String(c.valores.hora)}
                onChange={(e) => onChange(c.con("hora", e.target.value))}
                disabled={readonly}
              />
            </label>
          )}

          {c.valores.frecuencia === "semanal" && (
            <div className="block">
              <span className={labelClass}>Dias</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map((dia, idx) => {
                  const selected = dias.includes(idx);
                  return (
                    <button
                      key={dia}
                      type="button"
                      onClick={() => {
                        const newDias = selected ? dias.filter((d) => d !== idx) : [...dias, idx];
                        onChange(c.con("dias", newDias));
                      }}
                      disabled={readonly}
                      className={`rounded px-2 py-1 text-[10px] ${
                        selected
                          ? "bg-accent-blue text-white"
                          : "bg-surface-hover text-ink-secondary"
                      }`}
                    >
                      {dia}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {c.valores.frecuencia === "personalizado" && (
            <label className="block">
              <span className={labelClass}>Expresion cron</span>
              <Input
                className={`${inputClass} font-mono`}
                value={String(c.valores.cron)}
                onChange={(e) => onChange(c.con("cron", e.target.value))}
                placeholder="0 9 * * *"
                disabled={readonly}
              />
              <span className="text-ink-faint mt-1 block text-[10px]">
                Formato: minuto hora dia mes diaSemana
              </span>
            </label>
          )}

          <label className="block">
            <span className={labelClass}>Timezone</span>
            <SelectOpciones
              value={String(c.valores.timezone)}
              onValueChange={(v) => onChange(c.con("timezone", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "America/Mexico_City", label: "Mexico (CDMX)" },
                { value: "America/Bogota", label: "Colombia" },
                { value: "America/Santiago", label: "Chile" },
                { value: "America/Argentina/Buenos_Aires", label: "Argentina" },
                { value: "America/Sao_Paulo", label: "Brasil" },
                { value: "America/Lima", label: "Peru" },
              ]}
            />
          </label>
        </div>
      );
    }

    case "trigger_webhook": {
      // Sólo lectura: la URL y el secreto los genera el sistema, el panel no
      // los escribe.
      const c = editorDeConfig("trigger_webhook", config);
      const webhookUrl =
        c.valores.url ?? `https://api.crm.com/webhook/${String(c.valores.id ?? "nuevo")}`;
      const webhookSecret = c.valores.secret ?? "wh_xxxxxxxxxxxxx";
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>URL del webhook</span>
            <div className="flex gap-1">
              <Input
                className={`${inputClass} flex-1 font-mono text-[11px]`}
                value={String(webhookUrl)}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => navigator.clipboard.writeText(String(webhookUrl))}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </label>

          <label className="block">
            <span className={labelClass}>Secret (para verificar firma)</span>
            <div className="flex gap-1">
              <Input
                className={`${inputClass} flex-1 font-mono text-[11px]`}
                type={showSecret ? "text" : "password"}
                value={String(webhookSecret)}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </label>
        </div>
      );
    }

    case "trigger_etiqueta":
    case "trigger_etiqueta_removida": {
      const c = editorDeConfig(tipo, config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>
              {tipo === "trigger_etiqueta"
                ? "Cuando se asigna la etiqueta"
                : "Cuando se remueve la etiqueta"}
            </span>
            <SelectOpciones
              value={String(c.valores.tagId ?? "")}
              onValueChange={(v) => onChange(c.con("tagId", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Seleccionar etiqueta"
              opciones={tags.map((t) => ({ value: t.id, label: t.nombre }))}
            />
          </label>
        </div>
      );
    }

    case "trigger_etapa": {
      const c = editorDeConfig("trigger_etapa", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Etapa origen</span>
            <SelectOpciones
              value={String(c.valores.etapaOrigen)}
              onValueChange={(v) => onChange(c.con("etapaOrigen", v))}
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: "cualquiera", label: "Cualquiera" },
                ...etapas.map((e) => ({ value: e.id, label: e.nombre })),
              ]}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Etapa destino</span>
            <SelectOpciones
              value={String(c.valores.etapaDestino ?? "")}
              onValueChange={(v) => onChange(c.con("etapaDestino", v))}
              disabled={readonly}
              className={selectClass}
              placeholder="Seleccionar etapa"
              opciones={etapas.map((e) => ({ value: e.id, label: e.nombre }))}
            />
          </label>
        </div>
      );
    }

    case "trigger_inactividad": {
      const c = editorDeConfig("trigger_inactividad", config);
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Tiempo de inactividad</span>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                className={`${inputClass} w-20`}
                value={Number(c.valores.duracion)}
                onChange={(e) => onChange(c.con("duracion", Number(e.target.value)))}
                disabled={readonly}
              />
              <SelectOpciones
                value={String(c.valores.unidad)}
                onValueChange={(v) => onChange(c.con("unidad", v))}
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
        </div>
      );
    }

    case "trigger_difusion_respondida": {
      const c = editorDeConfig("trigger_difusion_respondida", config);
      const elegida = String(c.valores.difusionId ?? "");
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Cuando alguien responde</span>
            <SelectOpciones
              value={elegida === "" ? CUALQUIER_DIFUSION : elegida}
              onValueChange={(v) =>
                onChange(c.con("difusionId", v === CUALQUIER_DIFUSION ? "" : v))
              }
              disabled={readonly}
              className={selectClass}
              opciones={[
                { value: CUALQUIER_DIFUSION, label: "Cualquier difusión" },
                ...difusiones.map((d) => ({ value: d.id, label: d.nombre })),
              ]}
            />
          </label>
          <p className="text-ink-faint text-[11px] leading-snug text-pretty">
            Arranca con el primer mensaje que el lead manda después de recibir la difusión, hasta 7
            días después. Los mensajes siguientes de esa conversación no lo vuelven a disparar.
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">Este trigger no tiene configuracion adicional</p>
      );
  }
}
