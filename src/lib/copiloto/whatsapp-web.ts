import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";

/**
 * E.164 sin `+`, con el mismo rango que acepta `abrirChat` del puente de
 * escritorio (8 a 15 dígitos, `desktop/src/main/seguridad.ts`) y sin 0 inicial
 * (ningún código de país empieza con 0).
 */
const TELEFONO_ABRIBLE = /^[1-9][0-9]{7,14}$/;

/**
 * La URL que abre el chat en WhatsApp Web con el texto precargado (§5).
 *
 * El texto viaja solo en `send?text`: nunca se loguea ni va a un header. Que una
 * URL pueda terminar en el historial del navegador de la persona es una decisión
 * consciente del dueño para el contexto "navegador" (§6).
 *
 * `null` si el teléfono no es E.164 sin `+`: un lead de Instagram guarda
 * `ig:<id>` de relleno y eso no abre ningún chat. Se usa `encodeURIComponent` y
 * no `URLSearchParams` para que el espacio salga como `%20` y no como `+`.
 */
export function urlWhatsAppWeb(telefono: string, texto: string): string | null {
  if (!TELEFONO_ABRIBLE.test(telefono)) return null;
  return `https://web.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(texto)}`;
}

export type TextoEnviable =
  | { ok: true; texto: string }
  | { ok: false; motivo: "vacio" | "largo"; exceso: number };

/**
 * Lo que se puede mandar por cualquier camino: sin espacios de las puntas, no
 * vacío y de hasta `LARGO_MAXIMO_BORRADOR` (el tope de `abrirChat` y del
 * composer). Un borrador más largo se rechaza en vez de truncarse: cortar una
 * respuesta a mitad de frase sería mandarle algo que nadie escribió.
 */
export function textoEnviable(crudo: string): TextoEnviable {
  const texto = crudo.trim();
  if (texto.length === 0) return { ok: false, motivo: "vacio", exceso: 0 };
  if (texto.length > LARGO_MAXIMO_BORRADOR) {
    return { ok: false, motivo: "largo", exceso: texto.length - LARGO_MAXIMO_BORRADOR };
  }
  return { ok: true, texto };
}
