import { describe, expect, test, vi } from "vitest";
import type { AppClient } from "@/server/db/client";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";

describe("SupabaseMessagesRepository.listRecentBySessionIds", () => {
  test("invoca rpc conservando el contexto del cliente Supabase", async () => {
    const row = {
      conversacion_id: crypto.randomUUID(),
      lead_session_id: crypto.randomUUID(),
      direction: "in" as const,
      sender: "lead" as const,
      contenido: "Necesito pastillas",
      created_at: "2026-08-12T15:00:00.000Z",
    };

    const fake = {
      rest: { ready: true },
      rpc: vi.fn(function (this: { rest?: { ready: boolean } }) {
        if (!this.rest?.ready) throw new TypeError("rpc perdió el contexto del cliente");
        return Promise.resolve({ data: [row], error: null });
      }),
    } as unknown as AppClient;

    const repo = new SupabaseMessagesRepository(fake);
    const result = await repo.listRecentBySessionIds([row.lead_session_id], 50);

    expect(result).toEqual([{ ...row, created_at: new Date(row.created_at) }]);
    expect(fake.rpc).toHaveBeenCalledWith("inbox_recent_messages", {
      p_session_ids: [row.lead_session_id],
      p_limit: 50,
    });
  });
});
