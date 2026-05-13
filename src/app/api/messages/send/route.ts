import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ todo: "POST /api/messages/send (Fase 5/12)" }, { status: 501 });
}
