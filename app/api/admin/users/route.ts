import { NextResponse } from "next/server";
import {
  hashPin,
  requireAdmin,
  validatePin,
  verifyPin,
} from "@/lib/server/access";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

function cleanName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 80)
    : "";
}

async function pinExists(pin: string, excludeId?: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("access_codes")
    .select("id, pin_salt, pin_hash");

  return Boolean(
    data?.some(
      (row) =>
        row.id !== excludeId &&
        verifyPin(pin, row.pin_salt, row.pin_hash)
    )
  );
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("access_codes")
    .select("id, name, role, active, created_at, last_login")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { message: "Unable to load users." },
      { status: 500 }
    );
  }

  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const name = cleanName(body?.name);
  const pin = body?.pin;

  if (!name || !validatePin(pin)) {
    return NextResponse.json(
      { message: "Enter a name and a 4-digit passcode." },
      { status: 400 }
    );
  }

  if (await pinExists(pin)) {
    return NextResponse.json(
      { message: "That passcode is already in use." },
      { status: 409 }
    );
  }

  const { salt, hash } = hashPin(pin);
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("access_codes")
    .insert({
      name,
      pin_salt: salt,
      pin_hash: hash,
      role: "user",
      active: true,
    })
    .select("id, name, role, active, created_at, last_login")
    .single();

  if (error) {
    return NextResponse.json(
      { message: "Unable to create user." },
      { status: 500 }
    );
  }

  return NextResponse.json({ user: data });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ message: "Missing user." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) {
      return NextResponse.json(
        { message: "Name cannot be empty." },
        { status: 400 }
      );
    }
    updates.name = name;
  }

  if (body.active !== undefined) {
    if (id === admin.userId && body.active === false) {
      return NextResponse.json(
        { message: "You cannot disable your own admin access." },
        { status: 400 }
      );
    }
    updates.active = Boolean(body.active);
  }

  if (body.pin !== undefined) {
    const pin = body.pin;
    if (!validatePin(pin)) {
      return NextResponse.json(
        { message: "Passcode must be exactly 4 digits." },
        { status: 400 }
      );
    }
    if (await pinExists(pin, id)) {
      return NextResponse.json(
        { message: "That passcode is already in use." },
        { status: 409 }
      );
    }
    const { salt, hash } = hashPin(pin);
    updates.pin_salt = salt;
    updates.pin_hash = hash;
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("access_codes")
    .update(updates)
    .eq("id", id)
    .select("id, name, role, active, created_at, last_login")
    .single();

  if (error) {
    return NextResponse.json(
      { message: "Unable to update user." },
      { status: 500 }
    );
  }

  return NextResponse.json({ user: data });
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ message: "Missing user." }, { status: 400 });
  }

  if (id === admin.userId) {
    return NextResponse.json(
      { message: "You cannot delete your own admin account." },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { error } = await db.from("access_codes").delete().eq("id", id);

  if (error) {
    return NextResponse.json(
      { message: "Unable to delete user." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
