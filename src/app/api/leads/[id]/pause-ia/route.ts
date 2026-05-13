import { NextResponse } from "next/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ todo: `POST /api/leads/${id}/pause-ia (Fase 5)` }, { status: 501 });
}
