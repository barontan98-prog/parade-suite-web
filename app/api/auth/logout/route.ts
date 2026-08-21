import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/server/access";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
