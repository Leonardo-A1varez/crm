import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";

// Fase 10: poblar functions[] con makeCrmInngestFunctions(realDeps)
// donde realDeps usa Supabase repos + AI SDK LLMs + Meta client real.
// Hasta entonces el endpoint expone el handler sin funciones registradas.

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
