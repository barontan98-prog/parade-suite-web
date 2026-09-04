import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isControlRequestAuthorized } from "@/lib/control-auth";

export const runtime = "nodejs";
const EVENT_CODE = "UACDC26";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase server environment variables are not configured."
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: NextRequest) {
  if (!isControlRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const confirmation = String(body.confirmation || "").trim();

    if (confirmation !== "RESET EVENT") {
      return NextResponse.json(
        { error: "Type RESET EVENT exactly to continue." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data, error } = await admin.rpc(
      "control_reset_event_v0655",
      {
        p_event_code: EVENT_CODE,
        p_confirmation: confirmation,
      }
    );

    if (error) throw error;

    return NextResponse.json({
      success: true,
      result: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset event.",
      },
      { status: 500 }
    );
  }
}
