"use client";

import { useEffect, useRef } from "react";

/**
 * El hueco donde la app de escritorio superpone la vista nativa de WhatsApp
 * Web. Mide su propio rect con `getBoundingClientRect` al montar, en cada
 * resize (ResizeObserver del contenedor + evento `resize` de la ventana, que
 * cubre el caso en que la ventana cambia pero este elemento no) y avisa por
 * `reportarAreaWhatsApp`. Al desmontar reporta `null`: sin eso la vista nativa
 * quedaría flotando sobre una pantalla que ya no es esta — al salir del lead,
 * al pasar al hilo del CRM o al cambiar a un chat que no es de WhatsApp.
 *
 * Solo se monta dentro de la app de escritorio, cuando la conversación abierta
 * se muestra en WhatsApp Web. Por defensa, sin `window.crmEscritorio` el efecto
 * se sale antes de tocar nada del contrato.
 *
 * Lo que se dibuja acá queda tapado por la vista nativa apenas aparece; es solo
 * el fondo mientras carga.
 */
export function AreaWhatsApp() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const crmEscritorio = typeof window !== "undefined" ? window.crmEscritorio : undefined;
    if (!el || !crmEscritorio) return;

    function reportar() {
      if (!el) return;
      const { x, y, width, height } = el.getBoundingClientRect();
      crmEscritorio?.reportarAreaWhatsApp({ x, y, width, height });
    }

    reportar();
    const observer = new ResizeObserver(reportar);
    observer.observe(el);
    window.addEventListener("resize", reportar);

    // Un scroll que mueve este hueco sin cambiarle el tamaño (el contenedor
    // horizontal del shell, por debajo de su ancho mínimo) no dispara el
    // ResizeObserver ni `resize`. Los scrolls no burbujean, por eso captura; y
    // se filtra a los que contienen al hueco para no reportar cada vez que se
    // desplaza la lista de conversaciones.
    function alScrollear(evento: Event) {
      if (evento.target instanceof Node && evento.target.contains(el)) reportar();
    }
    window.addEventListener("scroll", alScrollear, { capture: true, passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportar);
      window.removeEventListener("scroll", alScrollear, { capture: true });
      crmEscritorio.reportarAreaWhatsApp(null);
    };
  }, []);

  return (
    <div ref={ref} className="bg-surface-chat relative h-full w-full overflow-hidden">
      <p className="text-ink-ghost absolute inset-0 flex items-center justify-center text-[12px]">
        Cargando WhatsApp Web…
      </p>
    </div>
  );
}
