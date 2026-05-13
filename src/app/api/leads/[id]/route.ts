import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ todo: `GET /api/leads/${id} (Fase 5)` }, { status: 501 });
}

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ todo: `PATCH /api/leads/${id} (Fase 5)` }, { status: 501 });
}
