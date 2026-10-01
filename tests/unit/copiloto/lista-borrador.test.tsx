import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InboxListItem } from "@/components/inbox/InboxListItem";
import type { InboxItem } from "@/types/inbox";

vi.mock("next/navigation", () => ({ usePathname: () => "/inbox" }));

afterEach(cleanup);

function item(parcial: Partial<InboxItem> = {}): InboxItem {
  return {
    leadId: "lead-1",
    sessionId: "s-1",
    nombre: "Ana Prueba",
    currentStage: "nuevo",
    iaPausada: false,
    ultimaActividad: new Date("2026-09-30T15:00:00Z"),
    ultimoMensaje: {
      body: "Busco filtro",
      direction: "in",
      createdAt: new Date("2026-09-30T15:00:00Z"),
    },
    canales: ["wa"],
    canalActivo: "wa",
    sinResponder: 1,
    esperandoDesde: null,
    urgencia: "media",
    motivo: null,
    recordatorio: null,
    borradorListo: false,
    ...parcial,
  };
}

describe.each(["completa", "compacta"] as const)(
  "InboxListItem (%s) y el borrador del copiloto",
  (variante) => {
    it("con un borrador listo muestra la marca Borrador listo", () => {
      render(<InboxListItem item={item({ borradorListo: true })} variante={variante} />);
      expect(screen.getByLabelText("Borrador listo")).toBeTruthy();
    });

    it("sin borrador no hay marca", () => {
      render(<InboxListItem item={item()} variante={variante} />);
      expect(screen.queryByLabelText("Borrador listo")).toBeNull();
    });
  },
);

describe("InboxListItem completa", () => {
  it("la marca se lee como texto, no solo como icono", () => {
    render(<InboxListItem item={item({ borradorListo: true })} variante="completa" />);
    expect(screen.getByText("Borrador listo")).toBeTruthy();
  });
});
