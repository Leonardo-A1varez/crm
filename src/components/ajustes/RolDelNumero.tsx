"use client";

import { useRef, useState, useTransition } from "react";
import { Edit } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { KeyboardEvent } from "react";

/** El largo que acepta la base (`whatsapp_numeros_rol_rol_largo`). */
const ROL_MAX = 40;

export type GuardarRolDeNumero = (input: {
  phoneNumberId: string;
  rol: string;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * El rol de un número ("Casilla principal", "Posventa"), editable en el lugar
 * por un admin. Es una etiqueta para saber qué es cada línea: no cambia por
 * qué número sale nada.
 *
 * Sin `guardar` es sólo lectura: la página no pasa la acción a un vendedor. La
 * RLS de `whatsapp_numeros_rol` igual rechaza su escritura; esto evita ofrecer
 * un botón que siempre falla.
 *
 * Sin animación de apertura: se abre cada vez que alguien corrige una
 * etiqueta, y un campo que aparece al instante se siente más rápido que uno
 * que se desliza.
 */
export function RolDelNumero({
  phoneNumberId,
  numero,
  rol,
  guardar,
}: {
  phoneNumberId: string;
  /** Como se muestra, para los nombres accesibles. */
  numero: string;
  rol: string | null;
  guardar: GuardarRolDeNumero | null;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(rol ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const disparador = useRef<HTMLButtonElement>(null);

  function cerrar() {
    setEditando(false);
    setError(null);
    // El foco vuelve al lápiz: sin esto un teclado queda en el principio de la página.
    requestAnimationFrame(() => disparador.current?.focus());
  }

  function enviar() {
    setError(null);
    iniciar(async () => {
      const r = await guardar?.({ phoneNumberId, rol: valor.trim() });
      if (r?.ok) cerrar();
      else setError(r?.error ?? "No se pudo guardar el rol.");
    });
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setValor(rol ?? "");
      cerrar();
    }
  }

  if (editando && guardar !== null) {
    return (
      <form
        className="flex min-w-0 flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <Input
          autoFocus
          value={valor}
          maxLength={ROL_MAX}
          placeholder="Ej.: Posventa"
          aria-label={`Rol de ${numero}`}
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? `rol-error-${phoneNumberId}` : undefined}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={alTeclear}
          disabled={pendiente}
          className="h-7 text-[12px]"
        />
        <div className="flex items-center gap-1">
          <Button type="submit" size="xs" disabled={pendiente}>
            {pendiente ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pendiente}
            onClick={() => {
              setValor(rol ?? "");
              cerrar();
            }}
          >
            Cancelar
          </Button>
        </div>
        {error !== null ? (
          <p
            id={`rol-error-${phoneNumberId}`}
            role="alert"
            className="text-[11px] leading-snug text-pretty"
            style={{ color: "var(--color-danger)" }}
          >
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <span className="group flex min-w-0 items-center gap-1">
      <span
        className={cn(
          "min-w-0 truncate text-[11.5px]",
          rol === null ? "text-ink-ghost" : "text-ink-primary font-medium",
        )}
      >
        {rol ?? "sin rol"}
      </span>
      {guardar !== null ? (
        <Button
          ref={disparador}
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Editar el rol de ${numero}`}
          className="text-ink-faint hover:text-ink-primary shrink-0"
          onClick={() => {
            setValor(rol ?? "");
            setEditando(true);
          }}
        >
          <Edit size={12} strokeWidth={2.25} aria-hidden />
        </Button>
      ) : null}
    </span>
  );
}
