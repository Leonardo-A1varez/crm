"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { UUID } from "@/types/entities";

const NOMBRE_MAX = 80;
const DESCRIPCION_MAX = 500;

type Crear = (input: {
  nombre: string;
  descripcion: string | null;
  plantillaId: string | null;
}) => Promise<{ ok: true; workflowId: UUID } | { ok: false; error: string }>;

/**
 * El paso entre elegir una plantilla y estar dentro del lienzo: cómo se va a
 * llamar el flujo.
 *
 * Existe porque la action necesita un nombre y `workflows.nombre` tiene un
 * CHECK de 80 chars: pedirlo acá evita crear seis flujos llamados "Responder
 * automático" que nadie distingue después. Viene precargado con el nombre de la
 * plantilla, así que aceptar es un Enter.
 *
 * La action devuelve el id del flujo creado —a diferencia de
 * `crearWorkflowAction`, que devuelve sólo `ok`— y con eso se navega al editor.
 * Sin el id habría que volver a la lista y buscarlo, que es exactamente el
 * momento en que alguien pierde el hilo de lo que estaba haciendo.
 */
export function FormularioNuevoFlujo({
  nombreSugerido,
  descripcionSugerida,
  plantillaId,
  onCrear,
}: {
  nombreSugerido: string;
  descripcionSugerida: string;
  /** `null` cuando se arrancó en blanco. */
  plantillaId: string | null;
  onCrear: Crear;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(nombreSugerido);
  const [descripcion, setDescripcion] = useState(descripcionSugerida);
  const [error, setError] = useState<string | null>(null);
  const [enviando, startEnviar] = useTransition();

  const nombreVacio = nombre.trim() === "";

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (nombreVacio || enviando) return;
    setError(null);
    startEnviar(async () => {
      const r = await onCrear({
        nombre,
        descripcion: descripcion.trim() === "" ? null : descripcion,
        plantillaId,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/workflows/${r.workflowId}`);
    });
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-ink-secondary text-[11.5px] font-semibold">Nombre del flujo</span>
        <input
          name="nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          maxLength={NOMBRE_MAX}
          required
          autoFocus
          className="border-line-input bg-surface-input text-ink-primary rounded-[9px] border px-3 py-2 text-[12.5px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-solid"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-ink-secondary text-[11.5px] font-semibold">
          Qué hace <span className="text-ink-ghost font-normal">(opcional)</span>
        </span>
        <textarea
          name="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          maxLength={DESCRIPCION_MAX}
          rows={3}
          className="border-line-input bg-surface-input text-ink-primary resize-y rounded-[9px] border px-3 py-2 text-[12.5px] leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] focus-visible:outline-solid"
        />
      </label>

      {/* El error de la action se muestra donde ocurrió, no en un toast que se
          va solo: si el nombre está repetido o falta un permiso, el texto tiene
          que seguir en pantalla mientras se corrige. */}
      {error !== null ? (
        <p role="alert" className="text-danger text-[11.5px] leading-relaxed">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={nombreVacio || enviando}
          className="bg-brand text-brand-ink hover:bg-brand-deep flex h-8 items-center rounded-[9px] px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-50"
        >
          {enviando ? "Creando…" : "Crear y abrir el lienzo"}
        </button>
        <span className="text-ink-ghost text-[11px]">
          Nace apagado. No dispara nada hasta que lo publiques.
        </span>
      </div>
    </form>
  );
}
