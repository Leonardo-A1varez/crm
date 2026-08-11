"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditoriaTurno } from "@/components/inbox/AuditoriaTurno";
import { BuscadorHilo } from "@/components/inbox/BuscadorHilo";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { EmptyState } from "@/components/shared/EmptyState";
import { indexarHilo } from "@/lib/ui/busqueda-hilo";
import type { AuditoriaTurnoInput } from "@/lib/validation/inbox.schema";
import type { Mensaje } from "@/types/entities";
import type { ResultadoAuditoria } from "@/types/inbox";

/**
 * Thread de mensajes anclado al fondo sin JS: `flex-col-reverse` + array
 * invertido (recibe ASC).
 *
 * Es client component desde que existe el buscador, y no por gusto: el
 * resaltado parte el texto de cada burbuja según lo que se está escribiendo, y
 * eso no se puede decidir en el server. El anclaje al fondo no depende de JS
 * igual que antes —lo sigue haciendo el `flex-col-reverse` sobre el array
 * invertido—, así que la primera pintura cae en el mismo lugar.
 */
export function ChatThread({
  messages,
  onAuditoria,
}: {
  messages: Mensaje[];
  /**
   * Lectura de la auditoría de un turno. Se dispara al desplegar una burbuja
   * del agente, nunca al abrir la conversación. `null` deja las burbujas sin
   * el control, para los callers que no la cablean.
   */
  onAuditoria?: ((input: AuditoriaTurnoInput) => Promise<ResultadoAuditoria>) | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  // Ordinal 0-based de la coincidencia enfocada. El buscador muestra 1..total.
  const [activo, setActivo] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // Solo lo que la burbuja dibuja resaltado. Los mensajes de sistema pintan su
  // contenido por otra rama de `MessageBubble`, sin `<mark>`: contarlos daría
  // ordinales que ninguna flecha puede alcanzar.
  const textos = useMemo(
    () => messages.map((m) => (m.sender === "sistema" ? "" : (m.contenido ?? ""))),
    [messages],
  );

  const { ordinalInicial, total } = useMemo(
    () => indexarHilo(textos, consulta),
    [textos, consulta],
  );

  // El hilo puede crecer mientras la búsqueda está abierta (el poller refresca
  // cada 5 s). Clamp en vez de resetear: la coincidencia enfocada sigue siendo
  // la misma salvo que haya desaparecido.
  const ordinalActivo = total === 0 ? null : Math.min(activo, total - 1);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setConsulta("");
    setActivo(0);
  }, []);

  const cambiarConsulta = useCallback(
    (valor: string) => {
      setConsulta(valor);
      // Arranca por la coincidencia más reciente y no por la más vieja: el hilo
      // está anclado abajo, así que la primera es la que ya está en pantalla.
      // Se recuenta acá en vez de esperar al memo porque el total nuevo hace
      // falta ahora, y recorrer el hilo es lo mismo que hará el render.
      setActivo(Math.max(0, indexarHilo(textos, valor).total - 1));
    },
    [textos],
  );

  const siguiente = useCallback(() => {
    if (total > 0) setActivo((a) => (Math.min(a, total - 1) + 1) % total);
  }, [total]);

  const anterior = useCallback(() => {
    if (total > 0) setActivo((a) => (Math.min(a, total - 1) + total - 1) % total);
  }, [total]);

  // Trae la coincidencia enfocada a la vista. Se busca por `data-coincidencia`
  // dentro del scroller y no con un `ref` por tramo: son hasta 200 mensajes y
  // colgar un ref de cada `<mark>` costaría más que una query puntual.
  useEffect(() => {
    if (ordinalActivo === null) return;
    const nodo = scroller.current?.querySelector(`[data-coincidencia="${ordinalActivo}"]`);
    // `block: center` mueve solo el scroll vertical del hilo; el
    // `flex-col-reverse` no se entera, porque el orden visual no cambia.
    nodo?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [ordinalActivo, consulta]);

  // Escape cierra desde cualquier lado y no solo con el foco en el input: quien
  // clickea una burbuja para leerla sigue esperando que Escape cierre la barra.
  // `defaultPrevented` respeta a cualquier diálogo que ya lo haya consumido.
  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) cerrar();
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [abierto, cerrar]);

  if (messages.length === 0) {
    return (
      <EmptyState
        title="Sin mensajes"
        description="Esta sesión todavía no tiene mensajes registrados."
      />
    );
  }

  const reversed = [...messages].reverse();

  return (
    // El buscador es hermano del scroller y no vive adentro: abierto empuja el
    // hilo hacia abajo, que es lo que `BuscadorHilo` documenta. Flotando encima
    // taparía la última burbuja, justo donde caen las coincidencias recientes.
    <div className="bg-surface-chat flex h-full flex-col">
      <BuscadorHilo
        abierto={abierto}
        consulta={consulta}
        total={total}
        posicion={ordinalActivo === null ? 0 : ordinalActivo + 1}
        onAbrir={() => setAbierto(true)}
        onCerrar={cerrar}
        onConsulta={cambiarConsulta}
        onAnterior={anterior}
        onSiguiente={siguiente}
      />
      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col-reverse gap-[9px] overflow-y-auto px-[26px] py-5"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,.03) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      >
        {reversed.map((m, iRev) => {
          // Índice en el array original: `ordinalInicial` se calculó en
          // cronológico y acá se recorre al revés.
          const i = messages.length - 1 - iRev;
          return (
            <div key={m.id} className="flex flex-col gap-[5px]">
              <MessageBubble
                message={m}
                resaltado={
                  consulta.trim() === ""
                    ? null
                    : {
                        consulta,
                        ordinalInicial: ordinalInicial[i] ?? 0,
                        ordinalActivo,
                      }
                }
              />
              {onAuditoria && m.sender === "ia" ? (
                <AuditoriaTurno mensajeId={m.id} onCargar={onAuditoria} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
