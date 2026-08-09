/**
 * Re-export. La fuente de verdad vive en `src/lib/agente/modelos.ts`: el
 * schema Zod de configuración del agente necesita `OPENAI_PRICING` y las
 * zonas de ESLint prohíben que `lib/**` importe de `server-services`. Este
 * archivo se mantiene para no tocar a los consumidores actuales.
 */
export { OPENAI_PRICING, DEFAULT_OPENAI_MODEL } from "@/lib/agente/modelos";
