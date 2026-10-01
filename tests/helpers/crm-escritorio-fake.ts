import { vi } from "vitest";
import type { CrmEscritorio } from "@/types/crm-escritorio";

/**
 * jsdom no implementa ResizeObserver. Este mock guarda el callback que recibió
 * para poder disparar un resize a mano desde el test.
 */
export const resizeObserver: { callback: (() => void) | null } = { callback: null };

export class ResizeObserverMock {
  constructor(cb: () => void) {
    resizeObserver.callback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Un `window.crmEscritorio` de prueba: todo resuelve bien salvo que se pise. */
export function crmEscritorioFake(overrides: Partial<CrmEscritorio> = {}): CrmEscritorio {
  return {
    abrirChat: vi.fn().mockResolvedValue({ ok: true, ms: 10, mostrada: true }),
    reportarAreaWhatsApp: vi.fn(),
    mostrarWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
    obtenerVistaWhatsApp: vi.fn().mockResolvedValue({ recorteIzquierdo: 0, completo: false }),
    configurarVistaWhatsApp: vi
      .fn()
      .mockImplementation((cambios: { recorteIzquierdo?: number; completo?: boolean }) =>
        Promise.resolve({ ok: true, recorteIzquierdo: 0, completo: false, ...cambios }),
      ),
    alCambiarVistaWhatsApp: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}
