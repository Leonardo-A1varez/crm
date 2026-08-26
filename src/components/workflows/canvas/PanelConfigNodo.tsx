"use client";

import {
  DISPARADORES,
  ACCIONES,
  ETIQUETA_DISPARADOR,
  ETIQUETA_ACCION,
} from "@/lib/workflows/catalogo";
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";
import type { Nodo } from "@/types/workflows";

interface PanelConfigNodoProps {
  nodo: Nodo | null;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  onChange: (nodoId: string, config: Record<string, unknown>) => void;
}

export function PanelConfigNodo({ nodo, tags, onChange }: PanelConfigNodoProps) {
  if (!nodo) {
    return (
      <div className="border-line-layout bg-surface-panel rounded-lg border p-4">
        <p className="text-ink-faint text-[12px]">Seleccioná un nodo para configurarlo</p>
      </div>
    );
  }

  const select =
    "border-line-control bg-surface-root text-ink-primary w-full rounded-md border px-2 py-1.5 text-[12px]";
  const input = select;

  const handleChange = (campo: string, valor: unknown) => {
    onChange(nodo.id, { ...nodo.config, [campo]: valor });
  };

  return (
    <div className="border-line-layout bg-surface-panel rounded-lg border p-4">
      <h3 className="text-ink-primary mb-3 text-[13px] font-semibold">Configurar {nodo.tipo}</h3>

      {nodo.tipo === "disparador" && (
        <label className="block">
          <span className="text-ink-secondary mb-1 block text-[11px]">Evento</span>
          <select
            className={select}
            value={String(nodo.config["disparador"] ?? "")}
            onChange={(e) => handleChange("disparador", e.target.value)}
          >
            {DISPARADORES.map((d) => (
              <option key={d} value={d}>
                {ETIQUETA_DISPARADOR[d]}
              </option>
            ))}
          </select>
        </label>
      )}

      {nodo.tipo === "accion" && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Acción</span>
            <select
              className={select}
              value={String(nodo.config["accion"] ?? "")}
              onChange={(e) => handleChange("accion", e.target.value)}
            >
              {ACCIONES.map((a) => (
                <option key={a} value={a}>
                  {ETIQUETA_ACCION[a]}
                </option>
              ))}
            </select>
          </label>

          {nodo.config["accion"] === "enviar_mensaje" && (
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-[11px]">
                Mensaje (usa {"{{lead.nombre}}"} para variables)
              </span>
              <textarea
                className={`${input} min-h-[80px] resize-y`}
                value={String(nodo.config["texto"] ?? "")}
                onChange={(e) => handleChange("texto", e.target.value)}
                placeholder="Hola {{lead.nombre}}, ..."
              />
            </label>
          )}

          {nodo.config["accion"] === "poner_etiqueta" && (
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-[11px]">Etiqueta</span>
              <select
                className={select}
                value={String(nodo.config["tagId"] ?? "")}
                onChange={(e) => handleChange("tagId", e.target.value)}
              >
                <option value="">— elegí una etiqueta —</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {nodo.tipo === "condicion" && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Campo</span>
            <select
              className={select}
              value={String(nodo.config["campo"] ?? "")}
              onChange={(e) => handleChange("campo", e.target.value)}
            >
              {CAMPOS_CONDICION.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Operador</span>
            <select
              className={select}
              value={String(nodo.config["operador"] ?? "")}
              onChange={(e) => handleChange("operador", e.target.value)}
            >
              {OPERADORES.map((o) => (
                <option key={o} value={o}>
                  {o.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-[11px]">Valor</span>
            <input
              className={input}
              value={String(nodo.config["valor"] ?? "")}
              onChange={(e) => handleChange("valor", e.target.value)}
            />
          </label>
        </div>
      )}

      {nodo.tipo === "espera" && (
        <label className="block">
          <span className="text-ink-secondary mb-1 block text-[11px]">Minutos</span>
          <input
            type="number"
            min={1}
            className={input}
            value={Number(nodo.config["minutos"] ?? 60)}
            onChange={(e) => handleChange("minutos", Number(e.target.value))}
          />
        </label>
      )}

      {nodo.tipo === "fin" && (
        <p className="text-ink-faint text-[11px]">Este nodo no tiene configuración</p>
      )}
    </div>
  );
}
