"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { DarkMode, LightMode } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * Alterna claro/oscuro. Vive en el pie del SideNav, al lado del logout.
 *
 * El `montado` no es ceremonia: en el render del server no existe `document`,
 * así que `resolvedTheme` viene `undefined` y pintar un ícono ahí adivina el
 * tema. Adivinar mal muestra el sol cuando corresponde la luna hasta que
 * hidrata. Se reserva el espacio y el ícono aparece cuando el dato es real.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [montado, setMontado] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMontado(true), []);

  const esOscuro = resolvedTheme === "dark";

  if (!montado) {
    return <span aria-hidden className="h-7 w-7 shrink-0" />;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={esOscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      title={esOscuro ? "Tema claro" : "Tema oscuro"}
      className="text-ink-dim hover:text-ink-primary h-7 w-7 shrink-0"
      onClick={() => setTheme(esOscuro ? "light" : "dark")}
    >
      {esOscuro ? <LightMode size={16} /> : <DarkMode size={16} />}
    </Button>
  );
}
