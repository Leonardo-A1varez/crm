"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Contexto de tema para toda la app.
 *
 * `attribute="class"` porque `globals.css` discrimina con
 * `@custom-variant dark (&:is(.dark *))`, que es una clase y no un atributo.
 *
 * `enableSystem={false}` es deliberado: el panel nació oscuro y esa sigue
 * siendo la cara por defecto del producto. Seguir al sistema operativo le
 * cambiaría el tema a quien nunca lo pidió.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
