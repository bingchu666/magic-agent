import { NextResponse } from "next/server";
import { readSession } from "@/features/auth/session.server";

export async function GET() {
  const user = readSession();
  return NextResponse.json({ user });
}
