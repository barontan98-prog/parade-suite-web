"use client";

import {
  useState,
} from "react";
import Link from "next/link";

type DeleteMode =
  | "delete_teams"
  | "delete_game_masters"
  | "reset_event"
  | null;

export default function ResetRosterPage() {
  const [mode, setMode] =
    useState<DeleteMode>(
      null
    );

  const [
    confirmation,
    setConfirmation,
  ] = useState("");

  const [working, setWorking] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const expected =
    mode === "delete_teams"
      ? "DELETE TEAMS"
      : mode ===
        "delete_game_masters"
      ? "DELETE GAME MASTERS"
      : mode === "reset_event"
      ? "RESET EVENT"
      : "";

  const title =
    mode === "delete_teams"
      ? "Delete All Teams"
      : mode ===
        "delete_game_masters"
      ? "Delete All Game Masters"
      : mode === "reset_event"
      ? "Reset Event"
      : "";

  const description =
    mode === "delete_teams"
      ? "This permanently deletes all Teams and related Team operational data for UACDC26. Game Masters and Game Stations will be kept."
      : mode ===
        "delete_game_masters"
      ? "This permanently deletes all Game Masters assigned to UACDC26. Teams, Game Stations and existing station score history will be kept."
      : mode === "reset_event"
      ? "This resets UACDC26 operational data back to a fresh event-day state. Team and Station Master rosters, Game Stations, Bonus Game setup, Safety Team accounts and published map coordinates are kept."
      : "";

  async function submit() {
    if (
      !mode ||
      confirmation !== expected
    ) {
      return;
    }

    setWorking(true);
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          mode === "reset_event"
            ? "/api/control/reset-event"
            : "/api/control/reset-roster",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                mode === "reset_event"
                  ? { confirmation }
                  : {
                      action: mode,
                      confirmation,
                    }
              ),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Delete failed."
        );
      }

      const result =
        payload.result || {};

      if (mode === "delete_teams") {
        setMessage(
          `Deleted ${result.teams_deleted ?? 0} Teams. Game Masters were kept.`
        );
      } else if (mode === "delete_game_masters") {
        setMessage(
          `Deleted ${result.game_masters_deleted ?? 0} Game Masters. Teams were kept.`
        );
      } else {
        setMessage(
          "✓ Event reset complete. Timing, scores/attempts, GPS, assistance, dispatches, messages, broadcasts and Team contact details were returned to a fresh event state."
        );
      }

      setConfirmation("");
      setMode(null);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Delete failed."
      );
    } finally {
      setWorking(false);
    }
  }

  function openModal(
    nextMode:
      Exclude<
        DeleteMode,
        null
      >
  ) {
    setMode(nextMode);
    setConfirmation("");
    setMessage("");
    setError("");
  }

  function closeModal() {
    if (working) return;

    setMode(null);
    setConfirmation("");
  }

  return (
    <main className="min-h-screen bg-[#F4F6FB]">
      <div className="mx-auto min-h-screen w-full max-w-3xl">
        <header className="bg-red-700 px-5 py-7 text-white md:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-100">
            Control Centre • Danger Zone
          </p>

          <h1 className="mt-2 text-3xl font-extrabold">
            Delete Event Roster
          </h1>

          <p className="mt-2 text-sm text-red-100">
            Teams and Game Masters are deleted separately.
          </p>
        </header>

        <div className="space-y-5 p-5 md:p-8">
          <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
            <div className="text-4xl">
              🏫
            </div>

            <h2 className="mt-3 text-xl font-extrabold text-red-800">
              Delete All Teams
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Permanently deletes every Team for UACDC26.
              Team station scores, Team push subscriptions and Team-specific messages are also removed so the Team roster can be imported again cleanly.
            </p>

            <p className="mt-2 text-sm font-bold text-slate-700">
              Game Masters and Game Stations will NOT be deleted.
            </p>

            <button
              type="button"
              onClick={() =>
                openModal(
                  "delete_teams"
                )
              }
              className="mt-4 min-h-12 w-full rounded-xl bg-red-700 px-4 font-bold text-white sm:w-auto"
            >
              Delete All Teams
            </button>
          </section>

          <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
            <div className="text-4xl">
              🪪
            </div>

            <h2 className="mt-3 text-xl font-extrabold text-red-800">
              Delete All Game Masters
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Permanently deletes every Game Master assigned to UACDC26 Game Stations.
            </p>

            <p className="mt-2 text-sm font-bold text-slate-700">
              Teams, Game Stations and existing station score history will NOT be deleted.
            </p>

            <button
              type="button"
              onClick={() =>
                openModal(
                  "delete_game_masters"
                )
              }
              className="mt-4 min-h-12 w-full rounded-xl bg-red-700 px-4 font-bold text-white sm:w-auto"
            >
              Delete All Game Masters
            </button>
          </section>

          <section className="rounded-2xl border-2 border-red-500 bg-red-50 p-5 shadow-sm">
            <div className="text-4xl">🔄</div>

            <h2 className="mt-3 text-xl font-extrabold text-red-900">
              Reset Entire Event
            </h2>

            <p className="mt-2 text-sm leading-6 text-red-900">
              Returns operational data to a fresh event-day state: all Wave flag-off times,
              Game Station scores/attempts, Bonus Game attempts, Team GPS, Safety Team GPS,
              assistance requests, Safety dispatch/arrival records, Messages & Alerts,
              Emergency Broadcast history and Team contact details are cleared.
            </p>

            <p className="mt-3 text-sm font-bold text-slate-800">
              Kept: Teams and Wave assignments, Station Masters, Game Stations, Bonus Game setup,
              Safety Team accounts and published map/station coordinates.
            </p>

            <button
              type="button"
              onClick={() => openModal("reset_event")}
              className="mt-4 min-h-12 w-full rounded-xl bg-red-800 px-4 font-black text-white sm:w-auto"
            >
              🔄 RESET EVENT
            </button>
          </section>

          {message && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-800">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-700">
              {error}
            </div>
          )}

          <Link
            href="/control"
            className="block text-center text-sm font-bold text-[#23479A]"
          >
            ← Back to Control Centre
          </Link>
        </div>
      </div>

      {mode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirmation-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-4xl">
                  ⚠️
                </div>

                <h2
                  id="delete-confirmation-title"
                  className="mt-3 text-2xl font-extrabold text-red-800"
                >
                  Confirm {title}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={working}
                className="rounded-lg px-3 py-2 text-xl font-bold text-slate-400 hover:bg-slate-100 disabled:opacity-40"
                aria-label="Close confirmation"
              >
                ×
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-700">
              {description}
            </p>

            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800">
                {mode === "reset_event"
                  ? "This clears live event operational records and cannot be undone."
                  : "This action cannot be undone."}
              </p>

              <p className="mt-2 text-sm text-red-700">
                Type{" "}
                <strong className="font-mono">
                  {expected}
                </strong>{" "}
                exactly to continue.
              </p>
            </div>

            <input
              autoFocus
              value={
                confirmation
              }
              onChange={(
                event
              ) =>
                setConfirmation(
                  event.target
                    .value
                )
              }
              placeholder={
                expected
              }
              className="mt-4 min-h-12 w-full rounded-xl border border-red-300 px-4 font-mono font-bold outline-none focus:border-red-600"
            />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={closeModal}
                disabled={working}
                className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 font-bold text-slate-700 disabled:opacity-40"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  submit
                }
                disabled={
                  working ||
                  confirmation !==
                    expected
                }
                className="min-h-12 flex-1 rounded-xl bg-red-700 px-4 font-bold text-white disabled:opacity-40"
              >
                {working
                  ? "Deleting..."
                  : title}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
