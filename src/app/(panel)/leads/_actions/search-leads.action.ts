"use server";

import { SearchLeadsSchema } from "@/lib/validation/leads.schema";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { LeadListItem } from "@/types/leads";

export async function searchLeadsAction(
  raw: unknown,
): Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }> {
  const parsed = SearchLeadsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Escribí al menos 1 carácter para buscar." };
  }
  try {
    const svc = await getLeadsServiceForRequest();
    const page = await svc.listLeads({ q: parsed.data.q });
    return { ok: true, items: page.items.slice(0, 10) };
  } catch (e) {
    return toActionError(e, "search-leads");
  }
}
