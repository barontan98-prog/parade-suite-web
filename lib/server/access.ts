import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabaseAdmin";

export type AccessRole = "admin" | "user";
export type AccessSession = {
  userId: string;
  name: string;
  role: AccessRole;
  exp: number;
};

const COOKIE_NAME = "parade_access";
const SESSION_SECONDS = 60 * 60 * 12;

function secret() {
  const value = process.env.PARADE_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("PARADE_SESSION_SECRET must be at least 32 characters.");
  }
  return value;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(
  user: { id: string; name: string; role: AccessRole }
) {
  const value: AccessSession = {
    userId: user.id,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): AccessSession | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as AccessSession;

    if (
      !value.userId ||
      !value.name ||
      !["admin", "user"].includes(value.role) ||
      value.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function currentSession() {
  const jar = await cookies();
  return verifySessionToken(jar.get(COOKIE_NAME)?.value);
}

export async function setSessionCookie(
  user: { id: string; name: string; role: AccessRole }
) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, createSessionToken(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function validatePin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

export function hashPin(pin: string, salt?: string) {
  const useSalt = salt ?? crypto.randomBytes(16).toString("hex");
  return {
    salt: useSalt,
    hash: crypto.scryptSync(pin, useSalt, 64).toString("hex"),
  };
}

export function verifyPin(pin: string, salt: string, expected: string) {
  const actual = hashPin(pin, salt).hash;
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function fingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip =
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const ua = request.headers.get("user-agent") || "unknown";
  return crypto
    .createHash("sha256")
    .update(`${ip}|${ua}|${secret()}`)
    .digest("hex");
}

export async function isRateLimited(key: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("access_attempts")
    .select("attempt_count, window_started")
    .eq("fingerprint", key)
    .maybeSingle();

  if (!data) return false;
  const start = new Date(data.window_started).getTime();
  if (Date.now() - start > 15 * 60 * 1000) return false;
  return Number(data.attempt_count) >= 8;
}

export async function recordFailedAttempt(key: string) {
  const db = supabaseAdmin();
  const now = new Date();

  const { data } = await db
    .from("access_attempts")
    .select("attempt_count, window_started")
    .eq("fingerprint", key)
    .maybeSingle();

  if (
    !data ||
    Date.now() - new Date(data.window_started).getTime() > 15 * 60 * 1000
  ) {
    await db.from("access_attempts").upsert({
      fingerprint: key,
      attempt_count: 1,
      window_started: now.toISOString(),
      updated_at: now.toISOString(),
    });
    return;
  }

  await db.from("access_attempts").upsert({
    fingerprint: key,
    attempt_count: Number(data.attempt_count) + 1,
    window_started: data.window_started,
    updated_at: now.toISOString(),
  });
}

export async function clearFailedAttempts(key: string) {
  const db = supabaseAdmin();
  await db.from("access_attempts").delete().eq("fingerprint", key);
}

export async function requireAdmin() {
  const session = await currentSession();
  if (!session || session.role !== "admin") return null;

  const db = supabaseAdmin();
  const { data } = await db
    .from("access_codes")
    .select("id, role, active")
    .eq("id", session.userId)
    .maybeSingle();

  if (!data || !data.active || data.role !== "admin") return null;
  return session;
}
