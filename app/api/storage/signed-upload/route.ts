import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/access";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

function safeFilename(name: unknown) {
  if (typeof name !== "string" || !name.trim()) return "";
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
}

export async function POST(request: Request) {
  const session = await currentSession();

  if (!session) {
    return NextResponse.json(
      { message: "Please check with the admin" },
      { status: 401 }
    );
  }

  let body: { filename?: string } = {};
  try {
    body = await request.json();
  } catch {}

  const filename = safeFilename(body.filename);
  if (!filename) {
    return NextResponse.json(
      { message: "Invalid filename." },
      { status: 400 }
    );
  }

  const objectName = `${crypto.randomUUID()}-${filename}`;
  const db = supabaseAdmin();

  const { data, error } = await db.storage
    .from("music")
    .createSignedUploadUrl(objectName, {
      upsert: false,
    });

  if (error || !data?.token) {
    return NextResponse.json(
      {
        message:
          error?.message ||
          "Unable to create a signed upload token.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    objectName,
    token: data.token,
  });
}
