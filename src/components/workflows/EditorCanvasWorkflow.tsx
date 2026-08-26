"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { CanvasWorkflow, CanvasToolbar, PaletaNodos, PanelConfigNodo } from "./canvas";
import { ProblemasDelGrafo } from "./ProblemasDelGrafo";
import { PasosDelGrafo } from "./PasosDelGrafo";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import type { Grafo } from "@/types/workflows";
import type { ActionResult } from "@/types/inbox";

interface EditorCanvasWorkflowProps {
  workflowId: string;
  grafoInicial: Grafo;
  maxPasosInicial: number;
  tags: ReadonlyArray<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  onGuardar: (input: {
    workflowId: string;
    grafo: Grafo;
    maxPasos: number;
  }) => Promise<ActionResult>;
}

export function EditorCanvasWorkflow({
  workflowId,
  grafoInicial,
  maxPasosInicial,
  tags,
  puedeEditar,
  onGuardar,
}: EditorCanvasWorkflowProps) {
  const [grafo, setGrafo] = useState<Grafo>(grafoInicial);
  const [maxPasos, setMaxPasos] = useState(maxPasosInicial);
  const [nodoSeleccionadoId, setNodoSeleccionadoId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, startGuardar] = useTransition();

  const problemas = useMemo(() => validarGrafo(grafo), [grafo]);
  const nodoSeleccionado = useMemo(
    () => grafo.nodos.find((n) => n.id === nodoSeleccionadoId) ?? null,
    [grafo.nodos, nodoSeleccionadoId],
  );

  const handleConfigChange = useCallback((nodoId: string, config: Record<string, unknown>) => {
    setGrafo((g) => ({
      ...g,
      nodos: g.nodos.map((n) => (n.id === nodoId ? { ...n, config } : n)),
    }));
  }, []);

  const handleGuardar = () => {
    setMensaje(null);
    startGuardar(async () => {
      const r = await onGuardar({ workflowId, grafo, maxPasos });
      setMensaje(
        r.ok
          ? { ok: true, texto: "Versión guardada. Publicala para que empiece a correr." }
          : { ok: false, texto: r.error },
      );
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Preview del flujo */}
      <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
        <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">Cómo queda el flujo</h2>
        <PasosDelGrafo grafo={grafo} />
      </section>

      {/* Validación */}
      <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
        <h2 className="text-ink-primary mb-2 text-[13px] font-[680]">Revisión</h2>
        <ProblemasDelGrafo problemas={problemas} />
      </section>

      {!puedeEditar ? (
        <p className="text-ink-faint text-[12px]">
          Solo un administrador puede modificar un flujo. Esto es de lectura.
        </p>
      ) : (
        <>
          {/* Paleta de nodos */}
          <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
            <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">Arrastrá para agregar</h2>
            <PaletaNodos onDragStart={() => {}} />
          </section>

          {/* Canvas + Panel lateral */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
            <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
              <CanvasWorkflow
                grafo={grafo}
                onChange={setGrafo}
                puedeEditar={puedeEditar}
                onNodoSeleccionado={setNodoSeleccionadoId}
              />
            </section>

            <aside>
              <PanelConfigNodo nodo={nodoSeleccionado} tags={tags} onChange={handleConfigChange} />
            </aside>
          </div>

          {/* Tope de pasos + Guardar */}
          <section className="border-line-layout bg-surface-panel rounded-[11px] border p-4">
            <div className="mb-3 flex items-center gap-3">
              <label className="text-ink-secondary flex items-center gap-2 text-[12px]">
                Tope de pasos por corrida
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={maxPasos}
                  onChange={(e) => setMaxPasos(Number(e.target.value))}
                  className="border-line-control bg-surface-root text-ink-primary w-20 rounded-md border px-2 py-1 text-[12px]"
                />
              </label>
            </div>
            <CanvasToolbar
              problemas={problemas}
              guardando={guardando}
              puedeGuardar={puedeEditar && grafo.nodos.length > 0}
              onGuardar={handleGuardar}
            />
          </section>

          {mensaje && (
            <p
              role="status"
              className={`text-[12px] ${mensaje.ok ? "text-emerald-600" : "text-red-600"}`}
            >
              {mensaje.texto}
            </p>
          )}
        </>
      )}
    </div>
  );
}
