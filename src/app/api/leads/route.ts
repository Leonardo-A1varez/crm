import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ todo: "GET /api/leads (Fase 5)" }, { status: 501 });
}

export async function POST() {
  return NextResponse.json({ todo: "POST /api/leads (Fase 5)" }, { status: 501 });
}
