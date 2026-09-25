"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { editorDeConfig } from "@/lib/workflows/config-nodos";

interface ConfigTriggerProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  etapas: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

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
            <Select
              value={String(c.valores.canal)}
              onValueChange={(v) => onChange(c.con("canal", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los canales</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="messenger">Messenger</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Filtro de mensaje</span>
            <Select
              value={String(c.valores.filtro)}
              onValueChange={(v) => onChange(c.con("filtro", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los mensajes</SelectItem>
                <SelectItem value="solo_texto">Solo texto</SelectItem>
                <SelectItem value="solo_media">Solo media</SelectItem>
                <SelectItem value="contiene">Contiene palabra</SelectItem>
              </SelectContent>
            </Select>
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
            <Select
              value={String(c.valores.frecuencia)}
              onValueChange={(v) => onChange(c.con("frecuencia", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cada_hora">Cada hora</SelectItem>
                <SelectItem value="diario">Diario</SelectItem>
                <SelectItem value="semanal">Semanal</SelectItem>
                <SelectItem value="mensual">Mensual</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>
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
            <Select
              value={String(c.valores.timezone)}
              onValueChange={(v) => onChange(c.con("timezone", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Mexico_City">Mexico (CDMX)</SelectItem>
                <SelectItem value="America/Bogota">Colombia</SelectItem>
                <SelectItem value="America/Santiago">Chile</SelectItem>
                <SelectItem value="America/Argentina/Buenos_Aires">Argentina</SelectItem>
                <SelectItem value="America/Sao_Paulo">Brasil</SelectItem>
                <SelectItem value="America/Lima">Peru</SelectItem>
              </SelectContent>
            </Select>
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
            <Select
              value={String(c.valores.tagId ?? "")}
              onValueChange={(v) => onChange(c.con("tagId", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue placeholder="Seleccionar etiqueta" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Select
              value={String(c.valores.etapaOrigen)}
              onValueChange={(v) => onChange(c.con("etapaOrigen", v))}
              disabled={readonly}
            >
              <SelectTrigger className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cualquiera">Cualquiera</SelectItem>
                {etapas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block">
            <span className={labelClass}>Etapa destino</span>
            <Select
              value={String(c.valores.etapaDestino ?? "")}
              onValueChange={(v) => onChange(c.con("etapaDestino", v))}
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
              <Select
                value={String(c.valores.unidad)}
                onValueChange={(v) => onChange(c.con("unidad", v))}
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
        </div>
      );
    }

    default:
      return (
        <p className="text-ink-faint text-[11px]">Este trigger no tiene configuracion adicional</p>
      );
  }
}
