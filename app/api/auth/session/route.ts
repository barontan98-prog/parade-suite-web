import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/access";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ authenticated: false });

  const db = supabaseAdmin();
  const { data } = await db
    .from("access_codes")
    .select("id, name, role, active")
    .eq("id", session.userId)
    .eq("active", true)
    .maybeSingle();

  if (!data) return NextResponse.json({ authenticated: false });

  return NextResponse.json({
    authenticated: true,
    user: { id: data.id, name: data.name, role: data.role },
  });
}
