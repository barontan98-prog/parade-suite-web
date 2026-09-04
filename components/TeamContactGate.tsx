"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Contact = {
  contactName: string;
  contactPhone: string;
  complete: boolean;
};

export default function TeamContactGate() {
  const pathname = usePathname();
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (pathname === "/team/login") {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/team/contact", {
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/team/login");
        return;
      }

      if (response.status === 423) {
        router.replace("/team/login?eventEnded=1");
        return;
      }

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to load Team contact.");
      }

      const next = payload.contact as Contact;
      setContact(next);
      setName(next.contactName || "");
      setPhone(next.contactPhone || "");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to load Team contact."
      );
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanPhone = phone.trim();

    if (!cleanName) {
      setError("Enter the name of your Team's main contact person.");
      return;
    }

    const digits = cleanPhone.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      setError("Enter a valid contact number with 8 to 15 digits.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/team/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contactName: cleanName,
          contactPhone: cleanPhone,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to save Team contact.");
      }

      setContact({
        contactName: payload.contact.contactName,
        contactPhone: payload.contact.contactPhone,
        complete: true,
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to save Team contact."
      );
    } finally {
      setSaving(false);
    }
  }

  if (pathname === "/team/login") {
    return null;
  }

  if (contact?.complete) {
    return null;
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/65 p-4">
        <div className="w-full max-w-sm rounded-3xl border bg-[#fdf4e5] p-6 text-center shadow-2xl">
          <div className="text-4xl">📞</div>
          <p className="mt-3 font-black text-[#342e57]">
            Checking Safety Contact Details...
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Team access will continue after your contact details are confirmed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/65 p-4"
      onContextMenu={(event) => event.preventDefault()}
    >
      <form
        onSubmit={save}
        className="w-full max-w-lg rounded-3xl border bg-[#fdf4e5] p-6 shadow-2xl"
      >
        <div className="text-center">
          <div className="text-4xl">📞</div>
          <h2 className="mt-3 text-2xl font-black text-[#342e57]">
            Safety Contact Details
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Before continuing, enter one main contact person for your Team.
            Control Centre and a dispatched Safety Team will use this only for
            event safety communication.
          </p>
        </div>

        <label className="mt-5 block text-sm font-extrabold text-slate-700">
          Main Contact Name
        </label>
        <input
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Baron Tan"
          maxLength={120}
          className="mt-2 min-h-12 w-full rounded-xl border bg-white px-4 outline-none focus:border-[#342e57]"
        />

        <label className="mt-4 block text-sm font-extrabold text-slate-700">
          Phone Number
        </label>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="e.g. 91234567"
          maxLength={24}
          className="mt-2 min-h-12 w-full rounded-xl border bg-white px-4 outline-none focus:border-[#342e57]"
        />

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        {error && !contact && (
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              void load();
            }}
            className="mt-3 min-h-11 w-full rounded-xl border border-[#342e57] bg-white px-4 font-black text-[#342e57]"
          >
            RETRY
          </button>
        )}

        <button
          type="submit"
          disabled={saving}
          className="mt-5 min-h-12 w-full rounded-xl bg-[#342e57] px-4 font-black text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "SAVE & CONTINUE"}
        </button>
      </form>
    </div>
  );
}
