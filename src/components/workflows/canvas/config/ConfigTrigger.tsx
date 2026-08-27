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
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface ConfigTriggerProps {
  tipo: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  etapas: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}

export function ConfigTrigger({
  tipo,
  config,
  onChange,
  tags,
  etapas,
  readonly,
}: ConfigTriggerProps) {
  const [showSecret, setShowSecret] = useState(false);

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
    case "trigger_mensaje":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Canal</span>
            <Select
              value={String(config.canal ?? "todos")}
              onValueChange={(v) => handleChange("canal", v)}
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
              value={String(config.filtro ?? "todos")}
              onValueChange={(v) => handleChange("filtro", v)}
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

          {config.filtro === "contiene" && (
            <label className="block">
              <span className={labelClass}>Palabra clave</span>
              <Input
                className={inputClass}
                value={String(config.palabra ?? "")}
                onChange={(e) => handleChange("palabra", e.target.value)}
                placeholder="Ej: promocion"
                disabled={readonly}
              />
            </label>
          )}
        </div>
      );

    case "trigger_cron":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Frecuencia</span>
            <Select
              value={String(config.frecuencia ?? "diario")}
              onValueChange={(v) => handleChange("frecuencia", v)}
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

          {config.frecuencia !== "personalizado" && (
            <label className="block">
              <span className={labelClass}>Hora</span>
              <Input
                type="time"
                className={inputClass}
                value={String(config.hora ?? "09:00")}
                onChange={(e) => handleChange("hora", e.target.value)}
                disabled={readonly}
              />
            </label>
          )}

          {config.frecuencia === "semanal" && (
            <div className="block">
              <span className={labelClass}>Dias</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map((dia, idx) => {
                  const dias = (config.dias as number[]) ?? [];
                  const selected = dias.includes(idx);
                  return (
                    <button
                      key={dia}
                      type="button"
                      onClick={() => {
                        const newDias = selected ? dias.filter((d) => d !== idx) : [...dias, idx];
                        handleChange("dias", newDias);
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

          {config.frecuencia === "personalizado" && (
            <label className="block">
              <span className={labelClass}>Expresion cron</span>
              <Input
                className={`${inputClass} font-mono`}
                value={String(config.cron ?? "0 9 * * *")}
                onChange={(e) => handleChange("cron", e.target.value)}
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
              value={String(config.timezone ?? "America/Mexico_City")}
              onValueChange={(v) => handleChange("timezone", v)}
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

    case "trigger_webhook":
      const webhookUrl = config.url ?? `https://api.crm.com/webhook/${config.id ?? "nuevo"}`;
      const webhookSecret = config.secret ?? "wh_xxxxxxxxxxxxx";
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

    case "trigger_etiqueta":
    case "trigger_etiqueta_removida":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>
              {tipo === "trigger_etiqueta"
                ? "Cuando se asigna la etiqueta"
                : "Cuando se remueve la etiqueta"}
            </span>
            <Select
              value={String(config.tagId ?? "")}
              onValueChange={(v) => handleChange("tagId", v)}
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

    case "trigger_etapa":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Etapa origen</span>
            <Select
              value={String(config.etapaOrigen ?? "cualquiera")}
              onValueChange={(v) => handleChange("etapaOrigen", v)}
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
              value={String(config.etapaDestino ?? "")}
              onValueChange={(v) => handleChange("etapaDestino", v)}
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

    case "trigger_inactividad":
      return (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={labelClass}>Tiempo de inactividad</span>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                className={`${inputClass} w-20`}
                value={Number(config.duracion ?? 24)}
                onChange={(e) => handleChange("duracion", Number(e.target.value))}
                disabled={readonly}
              />
              <Select
                value={String(config.unidad ?? "horas")}
                onValueChange={(v) => handleChange("unidad", v)}
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

    default:
      return (
        <p className="text-ink-faint text-[11px]">Este trigger no tiene configuracion adicional</p>
      );
  }
}
