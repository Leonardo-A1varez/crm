import { NextResponse } from "next/server";

// Verificación webhook Meta (GET) + recepción mensajes (POST).
// Fase 12: validar signature, parsear payload, emitir event Inngest, responder 200 inmediato.

export async function GET() {
  return NextResponse.json({ todo: "verify webhook Meta (Fase 12)" }, { status: 501 });
}

export async function POST() {
  return NextResponse.json({ todo: "receive webhook Meta (Fase 12)" }, { status: 501 });
}
