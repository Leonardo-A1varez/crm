import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ todo: "POST /api/productos/import CSV (Fase 5)" }, { status: 501 });
}
