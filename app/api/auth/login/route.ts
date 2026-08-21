import { NextResponse } from "next/server";
import {
  clearFailedAttempts,
  fingerprint,
  hashPin,
  isRateLimited,
  recordFailedAttempt,
  setSessionCookie,
  validatePin,
  verifyPin,
} from "@/lib/server/access";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const FAILURE_MESSAGE = "Please check with the admin";

export async function POST(request: Request) {
  const key = fingerprint(request);

  if (await isRateLimited(key)) {
    return NextResponse.json(
      { ok: false, message: FAILURE_MESSAGE },
      { status: 401 }
    );
  }

  let pin: unknown = "";
  try {
    pin = (await request.json())?.pin;
  } catch {}

  if (!validatePin(pin)) {
    await recordFailedAttempt(key);
    return NextResponse.json(
      { ok: false, message: FAILURE_MESSAGE },
      { status: 401 }
    );
  }

  const db = supabaseAdmin();

  const { count } = await db
    .from("access_codes")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");

  if ((count ?? 0) === 0) {
    const initialPin = process.env.PARADE_ADMIN_INITIAL_PIN;

    if (
      initialPin &&
      validatePin(initialPin) &&
      pin === initialPin
    ) {
      const name =
        (process.env.PARADE_ADMIN_NAME || "Admin").trim() || "Admin";
      const { salt, hash } = hashPin(pin);

      const { data: created, error } = await db
        .from("access_codes")
        .insert({
          name,
          pin_salt: salt,
          pin_hash: hash,
          role: "admin",
          active: true,
          last_login: new Date().toISOString(),
        })
        .select("id, name, role")
        .single();

      if (!error && created) {
        await clearFailedAttempts(key);
        await setSessionCookie(created);
        return NextResponse.json({ ok: true, user: created });
      }
    }
  }

  const { data: users } = await db
    .from("access_codes")
    .select("id, name, role, pin_salt, pin_hash")
    .eq("active", true);

  const matched = users?.find((user) =>
    verifyPin(pin, user.pin_salt, user.pin_hash)
  );

  if (!matched) {
    await recordFailedAttempt(key);
    return NextResponse.json(
      { ok: false, message: FAILURE_MESSAGE },
      { status: 401 }
    );
  }

  await db
    .from("access_codes")
    .update({ last_login: new Date().toISOString() })
    .eq("id", matched.id);

  await clearFailedAttempts(key);
  await setSessionCookie({
    id: matched.id,
    name: matched.name,
    role: matched.role,
  });

  return NextResponse.json({
    ok: true,
    user: { id: matched.id, name: matched.name, role: matched.role },
  });
}
