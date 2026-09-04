"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ConnectionStatusBanner from "@/components/ConnectionStatusBanner";
import ControlOperationsMessages from "@/components/ControlOperationsMessages";
import ControlSafetyDispatchStatus from "@/components/ControlSafetyDispatchStatus";

type Dashboard = {
  checkedAt: string;
  eventStatus: string;
  activeTeams: number;
  freshTrustedGps: number;
  staleOrMissingGps: number;
  openAssistance: number;
  acknowledgedAssistance: number;
  wavesTotal: number;
  wavesStarted: number;
  activeBroadcast: null | {
    id: string;
    title: string;
    acknowledgementCount: number;
    pendingAcknowledgements: number;
  };
};

type Assistance = {
  id: string;
  team_id: string;
  category: string;
  details: string | null;
  status:
    | "sent"
    | "acknowledged"
    | "resolved"
    | "cancelled";
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  requested_at: string;
  control_response: string | null;
  responded_at: string | null;
  teams: {
    team_number: number;
    team_name: string;
    contact_name: string | null;
    contact_phone: string | null;
  };
};

type BroadcastTeam = {
  teamId: string;
  teamNumber: number;
  teamName: string;
};

type Broadcast = {
  id: string;
  title: string;
  message: string;
  is_active: boolean;
  created_at: string;
  ended_at?: string | null;
  acknowledgementCount: number;
  unacknowledgedTeams: BroadcastTeam[];
  acknowledgements: Array<{
    teamId: string;
    teamNumber: number | null;
    teamName: string;
    acknowledgedAt: string;
  }>;
};

const templates = {
  lightning: {
    broadcastType: "lightning",
    title:
      "LIGHTNING ALERT — SEEK SHELTER",
    message:
      "Lightning Alert. Seek shelter immediately and remain sheltered until further instructions from Control Centre.",
  },
  stop: {
    broadcastType: "stop",
    title: "STOP ACTIVITY",
    message:
      "Stop all event activity immediately and await further instructions from Control Centre.",
  },
  return: {
    broadcastType: "return",
    title: "RETURN TO BASE",
    message:
      "Return to the designated End Point / Base immediately and report to event staff.",
  },
};

function formatClock(
  value: string | null
) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat(
    "en-SG",
    {
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }
  ).format(new Date(value));
}

function assistanceLabel(
  category: string
) {
  return category.replaceAll(
    "_",
    " / "
  );
}

function EmergencyBroadcastPanel({
  activeBroadcast,
  dashboard,
  broadcastType,
  title,
  message,
  working,
  resendingBroadcast,
  showPendingTeams,
  setShowPendingTeams,
  setTitle,
  setMessage,
  applyTemplate,
  sendBroadcast,
  resendUnacknowledged,
  endBroadcast,
  broadcasts,
  showBroadcastHistory,
  setShowBroadcastHistory,
  clearBroadcastHistory,
  clearingBroadcastHistory,
}: {
  activeBroadcast: Broadcast | null;
  dashboard: Dashboard | null;
  broadcastType: string;
  title: string;
  message: string;
  working: boolean;
  resendingBroadcast: boolean;
  showPendingTeams: boolean;
  setShowPendingTeams: (
    value: boolean | ((value: boolean) => boolean)
  ) => void;
  setTitle: (value: string) => void;
  setMessage: (value: string) => void;
  applyTemplate: (
    key: keyof typeof templates
  ) => void;
  sendBroadcast: (
    event: FormEvent
  ) => void;
  resendUnacknowledged: (
    id: string
  ) => void;
  endBroadcast: (id: string) => void;
  broadcasts: Broadcast[];
  showBroadcastHistory: boolean;
  setShowBroadcastHistory: (value: boolean | ((value: boolean) => boolean)) => void;
  clearBroadcastHistory: () => void;
  clearingBroadcastHistory: boolean;
}) {
  return (
    <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-500">
        Emergency Broadcast
      </p>
      <h2 className="mt-1 text-xl font-extrabold text-red-800">
        Prepared Alerts to All Teams
      </h2>

      {activeBroadcast && (
        <div className="mt-4 rounded-2xl border-2 border-red-400 bg-red-50 p-4">
          <p className="text-xs font-black uppercase text-red-600">
            ACTIVE NOW
          </p>

          <p className="mt-1 text-lg font-black text-red-900">
            {activeBroadcast.title}
          </p>

          <div className="mt-3">
            <div className="flex items-center justify-between gap-3 text-sm font-extrabold text-red-800">
              <span>
                Acknowledgements
              </span>
              <span>
                {
                  activeBroadcast.acknowledgementCount
                }{" "}
                /{" "}
                {dashboard?.activeTeams ??
                  "—"}
              </span>
            </div>

            <div className="mt-2 h-3 overflow-hidden rounded-full bg-red-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{
                  width: `${
                    dashboard?.activeTeams
                      ? Math.min(
                          100,
                          Math.round(
                            (activeBroadcast.acknowledgementCount /
                              dashboard.activeTeams) *
                              100
                          )
                        )
                      : 0
                  }%`,
                }}
              />
            </div>

            <p className="mt-2 text-xs font-bold text-red-700">
              {activeBroadcast
                .unacknowledgedTeams
                ?.length || 0}{" "}
              Team(s) still pending
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              setShowPendingTeams(
                (value) => !value
              )
            }
            className="mt-3 min-h-10 w-full rounded-xl border border-red-200 bg-white px-4 text-sm font-extrabold text-red-700"
          >
            {showPendingTeams
              ? "Hide Pending Teams"
              : "View Unacknowledged Teams"}
          </button>

          {showPendingTeams && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-red-200 bg-white p-3">
              {activeBroadcast
                .unacknowledgedTeams
                ?.length ? (
                <div className="space-y-2">
                  {activeBroadcast.unacknowledgedTeams.map(
                    (team) => (
                      <div
                        key={
                          team.teamId
                        }
                        className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm"
                      >
                        <span className="font-bold text-slate-800">
                          Team{" "}
                          {
                            team.teamNumber
                          }
                        </span>
                        <span className="truncate text-slate-600">
                          {
                            team.teamName
                          }
                        </span>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm font-bold text-emerald-700">
                  ✓ All active Teams
                  have acknowledged.
                </p>
              )}
            </div>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={
                resendingBroadcast ||
                !activeBroadcast
                  .unacknowledgedTeams
                  ?.length
              }
              onClick={() =>
                resendUnacknowledged(
                  activeBroadcast.id
                )
              }
              className="min-h-11 rounded-xl bg-red-600 px-4 font-extrabold text-white disabled:opacity-40"
            >
              {resendingBroadcast
                ? "RESENDING..."
                : "🔔 RESEND TO PENDING"}
            </button>

            <button
              type="button"
              disabled={working}
              onClick={() =>
                endBroadcast(
                  activeBroadcast.id
                )
              }
              className="min-h-11 rounded-xl border border-red-400 bg-white px-4 font-extrabold text-red-700 disabled:opacity-50"
            >
              {working
                ? "UPDATING..."
                : "END BROADCAST"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <button
          type="button"
          onClick={() =>
            applyTemplate(
              "lightning"
            )
          }
          className={`rounded-xl border-2 p-4 text-left transition ${
            broadcastType ===
            "lightning"
              ? "border-red-500 bg-red-50"
              : "border-red-200 bg-white"
          }`}
        >
          <p className="text-2xl">
            ⚡
          </p>
          <p className="mt-2 font-black text-red-700">
            LIGHTNING ALERT
          </p>
          <p className="mt-1 text-sm font-extrabold text-red-700">
            SEEK SHELTER
          </p>
          <span className="mt-3 inline-flex rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black text-red-700">
            URGENT / EMERGENCY
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            applyTemplate("stop")
          }
          className={`rounded-xl border-2 p-4 text-left transition ${
            broadcastType ===
            "stop"
              ? "border-red-500 bg-red-50"
              : "border-red-200 bg-white"
          }`}
        >
          <p className="text-2xl">
            🛑
          </p>
          <p className="mt-2 font-black text-red-700">
            STOP ACTIVITY
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Stop all event activity
            immediately.
          </p>
          <span className="mt-3 inline-flex rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black text-red-700">
            URGENT / EMERGENCY
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            applyTemplate("return")
          }
          className={`rounded-xl border-2 p-4 text-left transition ${
            broadcastType ===
            "return"
              ? "border-amber-500 bg-amber-50"
              : "border-amber-200 bg-white"
          }`}
        >
          <p className="text-2xl">
            🏁
          </p>
          <p className="mt-2 font-black text-amber-800">
            RETURN TO BASE
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Proceed to the
            designated End Point /
            Base.
          </p>
          <span className="mt-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800">
            IMPORTANT
          </span>
        </button>
      </div>

      <form
        onSubmit={sendBroadcast}
        className="mt-4"
      >
        <div
          className={`rounded-2xl border p-4 ${
            broadcastType ===
            "return"
              ? "border-amber-200 bg-amber-50"
              : broadcastType ===
                    "lightning" ||
                  broadcastType ===
                    "stop"
              ? "border-red-200 bg-red-50"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              Prepared Broadcast —
              Editable Before Sending
            </p>

            {title && (
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                  broadcastType ===
                  "return"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {broadcastType ===
                "return"
                  ? "IMPORTANT"
                  : "URGENT / EMERGENCY"}
              </span>
            )}
          </div>

          {title ? (
            <>
              <label className="mt-4 block text-sm font-extrabold text-slate-700">
                Title
              </label>
              <input
                value={title}
                onChange={(event) =>
                  setTitle(
                    event.target.value
                  )
                }
                maxLength={120}
                className="mt-2 min-h-12 w-full rounded-xl border bg-white px-4"
              />

              <label className="mt-4 block text-sm font-extrabold text-slate-700">
                Instruction
              </label>
              <textarea
                value={message}
                onChange={(event) =>
                  setMessage(
                    event.target.value
                  )
                }
                rows={5}
                maxLength={1500}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3"
              />

              <p className="mt-2 text-xs font-semibold text-slate-500">
                The prepared wording is
                pre-filled, but Control
                may edit the title or
                instruction before
                sending.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Select one of the three
              prepared alerts above.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={
            working ||
            !title.trim() ||
            !message.trim()
          }
          className={`mt-4 min-h-14 w-full rounded-xl px-4 text-lg font-black text-white disabled:opacity-40 ${
            broadcastType ===
            "return"
              ? "bg-amber-600"
              : "bg-red-600"
          }`}
        >
          {working
            ? "SENDING..."
            : "🚨 SEND PREPARED BROADCAST"}
        </button>
      </form>

      <div className="mt-5 border-t border-red-100 pt-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <button
            type="button"
            onClick={() => setShowBroadcastHistory((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between rounded-xl border border-red-200 bg-white px-4 text-left text-sm font-extrabold text-red-800"
          >
            <span>Broadcast History ({broadcasts.length})</span>
            <span>{showBroadcastHistory ? "Hide" : "Show"}</span>
          </button>

          <button
            type="button"
            onClick={clearBroadcastHistory}
            disabled={clearingBroadcastHistory || !broadcasts.some((row) => !row.is_active)}
            className="min-h-11 rounded-xl border border-red-300 bg-red-50 px-4 text-sm font-black text-red-700 disabled:opacity-40"
          >
            {clearingBroadcastHistory ? "CLEARING..." : "🗑️ CLEAR HISTORY"}
          </button>
        </div>

        {showBroadcastHistory&&<div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-red-100 bg-white">{broadcasts.length===0?<p className="p-4 text-sm text-slate-500">No Emergency Broadcasts have been sent yet.</p>:<div className="divide-y">{broadcasts.map(b=><div key={b.id} className="p-4"><div className="flex items-start justify-between gap-2"><p className="font-extrabold text-slate-900">{b.title}</p><span className={`rounded-full px-2 py-1 text-[10px] font-black ${b.is_active?"bg-red-100 text-red-700":"bg-slate-100 text-slate-600"}`}>{b.is_active?"ACTIVE":"ENDED"}</span></div><p className="mt-2 text-sm text-slate-600">{b.message}</p><p className="mt-2 text-xs font-bold text-slate-500">Sent {new Date(b.created_at).toLocaleString("en-SG")} • {b.acknowledgementCount} acknowledgement(s)</p></div>)}</div>}</div>}
      </div>
    </section>
  );
}

export default function OperationsDashboardPage() {
  const [dashboard, setDashboard] =
    useState<Dashboard | null>(
      null
    );
  const [assistance, setAssistance] =
    useState<Assistance[]>([]);
  const [broadcasts, setBroadcasts] =
    useState<Broadcast[]>([]);
  const [title, setTitle] =
    useState("");
  const [message, setMessage] =
    useState("");
  const [
    broadcastType,
    setBroadcastType,
  ] = useState("custom");
  const [working, setWorking] =
    useState(false);
  const [
    clearingBroadcastHistory,
    setClearingBroadcastHistory,
  ] = useState(false);
  const [status, setStatus] =
    useState("");
  const [
    lastUpdated,
    setLastUpdated,
  ] = useState<string | null>(
    null
  );
  const [
    refreshProblem,
    setRefreshProblem,
  ] = useState("");
  const [
    updatingRequestId,
    setUpdatingRequestId,
  ] = useState<string | null>(
    null
  );
  const [
    newRequestIds,
    setNewRequestIds,
  ] = useState<Set<string>>(
    new Set()
  );
  const [
    alertsEnabled,
    setAlertsEnabled,
  ] = useState(false);
  const [
    showPendingTeams,
    setShowPendingTeams,
  ] = useState(false);
  const [
    showBroadcastHistory,
    setShowBroadcastHistory,
  ] = useState(false);
  const [
    resendingBroadcast,
    setResendingBroadcast,
  ] = useState(false);
  const [
    responseDrafts,
    setResponseDrafts,
  ] = useState<
    Record<string, string>
  >({});
  const [
    showAssistanceHistory,
    setShowAssistanceHistory,
  ] = useState(false);
  const knownRequestIds =
    useRef<Set<string> | null>(
      null
    );
  const ambulanceAudioRef =
    useRef<HTMLAudioElement | null>(
      null
    );

  function playAlertTone() {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (
          window as unknown as {
            webkitAudioContext: typeof AudioContext;
          }
        ).webkitAudioContext;

      const context =
        new AudioContextClass();
      const gain =
        context.createGain();
      const oscillator =
        context.createOscillator();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(
        880,
        context.currentTime
      );
      oscillator.frequency.setValueAtTime(
        1040,
        context.currentTime + 0.16
      );
      gain.gain.setValueAtTime(
        0.0001,
        context.currentTime
      );
      gain.gain.exponentialRampToValueAtTime(
        0.18,
        context.currentTime + 0.02
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.42
      );
      oscillator.connect(gain);
      gain.connect(
        context.destination
      );
      oscillator.start();
      oscillator.stop(
        context.currentTime + 0.45
      );
    } catch {}
  }

  function playMedicalDispatchSound() {
    try {
      if (
        !ambulanceAudioRef.current
      ) {
        ambulanceAudioRef.current =
          new Audio(
            "/audio/ambulance-dispatch.mp3"
          );
        ambulanceAudioRef.current.preload =
          "auto";
        ambulanceAudioRef.current.volume =
          0.9;
      }

      const audio =
        ambulanceAudioRef.current;
      audio.pause();
      audio.currentTime = 0;
      void audio
        .play()
        .catch(() => {});
    } catch {}
  }

  function alertForNewRequests(
    rows: Assistance[]
  ) {
    const active = rows.filter(
      (row) =>
        row.status === "sent"
    );
    const current = new Set(
      rows.map((row) => row.id)
    );

    if (
      knownRequestIds.current ===
      null
    ) {
      knownRequestIds.current =
        current;
      return;
    }

    const newlyArrived =
      active.filter(
        (row) =>
          !knownRequestIds.current!.has(
            row.id
          )
      );

    knownRequestIds.current =
      current;

    if (!newlyArrived.length) {
      return;
    }

    setNewRequestIds(
      (previous) => {
        const next = new Set(
          previous
        );
        newlyArrived.forEach(
          (row) => next.add(row.id)
        );
        return next;
      }
    );

    if (alertsEnabled) {
      const hasMedical =
        newlyArrived.some(
          (row) =>
            row.category ===
            "medical"
        );

      if (hasMedical) {
        playMedicalDispatchSound();
      } else {
        playAlertTone();
      }

      if (
        "Notification" in
          window &&
        Notification.permission ===
          "granted"
      ) {
        const first =
          newlyArrived[0];

        new Notification(
          first.category ===
            "medical"
            ? "🚑 MEDICAL ASSISTANCE REQUEST"
            : "🆘 New Team Assistance Request",
          {
            body: `Team ${first.teams.team_number} — ${assistanceLabel(
              first.category
            )}`,
            tag: `control-help-${first.id}`,
          }
        );
      }
    }
  }

  const load =
    useCallback(async () => {
      if (!navigator.onLine) {
        setRefreshProblem(
          "Control device is offline. Keeping the last successfully loaded Operations data visible."
        );
        return;
      }

      try {
        const [d, a, b] =
          await Promise.all([
            fetch(
              "/api/control/operations-dashboard",
              {
                cache:
                  "no-store",
              }
            ),
            fetch(
              "/api/control/assistance",
              {
                cache:
                  "no-store",
              }
            ),
            fetch(
              "/api/control/emergency-broadcasts",
              {
                cache:
                  "no-store",
              }
            ),
          ]);

        if (
          [
            d.status,
            a.status,
            b.status,
          ].includes(401)
        ) {
          window.location.replace(
            "/control/login"
          );
          return;
        }

        const [dp, ap, bp] =
          await Promise.all([
            d.json(),
            a.json(),
            b.json(),
          ]);

        if (!d.ok) {
          throw new Error(
            dp?.error ||
              "Operations summary failed to refresh."
          );
        }

        if (!a.ok) {
          throw new Error(
            ap?.error ||
              "Team assistance failed to refresh."
          );
        }

        if (!b.ok) {
          throw new Error(
            bp?.error ||
              "Emergency broadcasts failed to refresh."
          );
        }

        const nextAssistance =
          (ap.requests ||
            []) as Assistance[];

        alertForNewRequests(
          nextAssistance
        );

        setDashboard(dp);
        setAssistance(
          nextAssistance
        );
        setBroadcasts(
          bp.broadcasts || []
        );
        setLastUpdated(
          dp.checkedAt ||
            ap.checkedAt ||
            new Date().toISOString()
        );
        setRefreshProblem("");
      } catch (error) {
        setRefreshProblem(
          error instanceof Error
            ? `Live refresh problem: ${error.message}. Last successful data remains visible.`
            : "Live refresh failed. Last successful data remains visible."
        );
      }
    }, [alertsEnabled]);

  useEffect(() => {
    void load();

    const timer =
      window.setInterval(
        load,
        10000
      );

    const reconnect = () =>
      void load();

    window.addEventListener(
      "online",
      reconnect
    );

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(
        "online",
        reconnect
      );
    };
  }, [load]);

  async function enableAlerts() {
    let notificationAllowed =
      false;

    if (
      "Notification" in window
    ) {
      const permission =
        Notification.permission ===
        "default"
          ? await Notification.requestPermission()
          : Notification.permission;

      notificationAllowed =
        permission === "granted";
    }

    try {
      if (
        !ambulanceAudioRef.current
      ) {
        ambulanceAudioRef.current =
          new Audio(
            "/audio/ambulance-dispatch.mp3"
          );
        ambulanceAudioRef.current.preload =
          "auto";
        ambulanceAudioRef.current.volume =
          0.9;
        ambulanceAudioRef.current.load();
      }
    } catch {}

    playAlertTone();
    setAlertsEnabled(true);

    setStatus(
      notificationAllowed
        ? "✓ Operations alerts enabled: sound + browser notifications."
        : "✓ Operations sound alerts enabled. Browser notifications are unavailable or not permitted."
    );
  }

  async function assistanceAction(
    requestId: string,
    action:
      | "acknowledge"
      | "resolve"
      | "reopen"
  ) {
    if (updatingRequestId) {
      return;
    }

    setUpdatingRequestId(
      requestId
    );
    setStatus("");

    try {
      const response =
        await fetch(
          "/api/control/assistance",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              requestId,
              action,
            }),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to update request."
        );
      }

      setNewRequestIds(
        (previous) => {
          const next =
            new Set(previous);
          next.delete(requestId);
          return next;
        }
      );

      await load();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to update request."
      );
      await load();
    } finally {
      setUpdatingRequestId(
        null
      );
    }
  }

  async function sendAssistanceResponse(
    requestId: string
  ) {
    const responseText = String(
      responseDrafts[requestId] ||
        ""
    ).trim();

    if (!responseText) {
      setStatus(
        "Type a response for the Team first."
      );
      return;
    }

    if (updatingRequestId) {
      return;
    }

    setUpdatingRequestId(
      requestId
    );
    setStatus("");

    try {
      const response =
        await fetch(
          "/api/control/assistance",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              requestId,
              action: "respond",
              response:
                responseText,
            }),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to send Team response."
        );
      }

      setResponseDrafts(
        (current) => ({
          ...current,
          [requestId]: "",
        })
      );
      setStatus(
        "✓ Response sent to Team."
      );
      await load();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to send Team response."
      );
    } finally {
      setUpdatingRequestId(
        null
      );
    }
  }

  async function resetAssistanceSystem() {
    const warning =
      window.confirm(
        "RESET ALL ASSISTANCE REQUESTS?\n\nThis permanently clears active, resolved and cancelled Team assistance requests for UACDC26. This cannot be undone."
      );

    if (!warning) return;

    const confirmation =
      window.prompt(
        "Type exactly: RESET ASSISTANCE"
      );

    if (
      confirmation !==
      "RESET ASSISTANCE"
    ) {
      if (
        confirmation !== null
      ) {
        setStatus(
          "Assistance reset cancelled — confirmation text did not match."
        );
      }
      return;
    }

    setWorking(true);
    setStatus("");

    try {
      const response =
        await fetch(
          "/api/control/assistance",
          {
            method: "DELETE",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              confirmation,
            }),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to reset Assistance Requests."
        );
      }

      knownRequestIds.current =
        null;
      setNewRequestIds(
        new Set()
      );
      setResponseDrafts({});
      setStatus(
        `✓ Assistance Request system reset. ${
          payload.deletedCount ||
          0
        } request(s) cleared.`
      );
      await load();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to reset Assistance Requests."
      );
    } finally {
      setWorking(false);
    }
  }

  function applyTemplate(
    key: keyof typeof templates
  ) {
    const template =
      templates[key];

    setBroadcastType(
      template.broadcastType
    );
    setTitle(template.title);
    setMessage(template.message);
  }

  async function sendBroadcast(
    event: FormEvent
  ) {
    event.preventDefault();

    if (
      !templates[
        broadcastType as keyof typeof templates
      ]
    ) {
      setStatus(
        "Select one of the prepared Emergency Broadcast alerts first."
      );
      return;
    }

    if (
      !title.trim() ||
      !message.trim()
    ) {
      setStatus(
        "Prepared Broadcast title and instruction are required."
      );
      return;
    }

    if (
      !window.confirm(
        `SEND EMERGENCY BROADCAST TO ALL TEAMS?\n\n${title.trim()}\n\nTeams will receive a prominent red alert and push notification where enabled.`
      )
    ) {
      return;
    }

    setWorking(true);
    setStatus("");

    try {
      const response =
        await fetch(
          "/api/control/emergency-broadcasts",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              broadcastType,
              title:
                title.trim(),
              message:
                message.trim(),
            }),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to send broadcast."
        );
      }

      setTitle("");
      setMessage("");
      setBroadcastType("");
      setStatus(
        "✓ Prepared Emergency Broadcast sent to all Teams."
      );
      await load();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to send broadcast."
      );
    } finally {
      setWorking(false);
    }
  }

  const activeBroadcast =
    broadcasts.find(
      (row) => row.is_active
    ) || null;

  async function resendUnacknowledged(
    id: string
  ) {
    if (resendingBroadcast) {
      return;
    }

    const pending =
      activeBroadcast
        ?.unacknowledgedTeams
        ?.length || 0;

    if (!pending) {
      setStatus(
        "All active Teams have acknowledged this Emergency Broadcast."
      );
      return;
    }

    if (
      !window.confirm(
        `Resend this Emergency Broadcast to ${pending} Team(s) that have not acknowledged?`
      )
    ) {
      return;
    }

    setResendingBroadcast(true);
    setStatus("");

    try {
      const response =
        await fetch(
          "/api/control/emergency-broadcasts",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              action:
                "resend-unacknowledged",
              broadcastId: id,
            }),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to resend broadcast."
        );
      }

      setStatus(
        `✓ Emergency Broadcast re-sent to unacknowledged Teams where push notifications are available (${payload.pendingTeams} Team(s) pending).`
      );
      await load();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to resend broadcast."
      );
    } finally {
      setResendingBroadcast(false);
    }
  }

  async function endBroadcast(
    id: string
  ) {
    if (working) return;

    if (
      !window.confirm(
        "End this Emergency Broadcast? It will disappear from Team App screens."
      )
    ) {
      return;
    }

    setWorking(true);

    try {
      const response =
        await fetch(
          "/api/control/emergency-broadcasts",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              broadcastId: id,
            }),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "Unable to end broadcast."
        );
      }

      await load();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to end broadcast."
      );
    } finally {
      setWorking(false);
    }
  }

  async function clearBroadcastHistory() {
    if (clearingBroadcastHistory) return;

    const endedCount = broadcasts.filter((row) => !row.is_active).length;

    if (!endedCount) {
      setStatus("There is no ended Emergency Broadcast history to clear.");
      return;
    }

    const confirmation = window.prompt(
      `Clear ${endedCount} ended Emergency Broadcast record(s)?\n\nActive broadcasts will NOT be deleted.\n\nType CLEAR BROADCASTS to continue.`
    );

    if (confirmation !== "CLEAR BROADCASTS") {
      return;
    }

    setClearingBroadcastHistory(true);
    setStatus("");

    try {
      const response = await fetch(
        "/api/control/emergency-broadcasts",
        { method: "DELETE" }
      );

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error || "Unable to clear Emergency Broadcast history."
        );
      }

      setStatus(`✓ Cleared ${payload.deleted || 0} Emergency Broadcast history record(s).`);
      await load();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to clear Emergency Broadcast history."
      );
    } finally {
      setClearingBroadcastHistory(false);
    }
  }

  const activeRequests =
    assistance
      .filter(
        (row) =>
          row.status ===
            "sent" ||
          row.status ===
            "acknowledged"
      )
      .sort((a, b) => {
        if (
          a.category ===
            "medical" &&
          b.category !==
            "medical"
        ) {
          return -1;
        }

        if (
          b.category ===
            "medical" &&
          a.category !==
            "medical"
        ) {
          return 1;
        }

        return (
          new Date(
            b.requested_at
          ).getTime() -
          new Date(
            a.requested_at
          ).getTime()
        );
      });

  const assistanceHistory =
    assistance.filter(
      (row) =>
        row.status ===
          "resolved" ||
        row.status ===
          "cancelled"
    );

  return (
    <main className="min-h-screen bg-[#fdf4e5] pb-10">
      <style>{`
        @keyframes medical-assistance-flash {
          0%, 100% { background:#fff1f2; box-shadow: inset 0 0 0 2px #ef4444, 0 0 0 rgba(239,68,68,0); }
          50% { background:#dc2626; color:#fff; box-shadow: inset 0 0 0 3px #991b1b, 0 0 28px rgba(220,38,38,.45); }
        }
        @keyframes navigation-assistance-flash {
          0%, 100% { background:#fffbeb; box-shadow: inset 0 0 0 2px #f59e0b; }
          50% { background:#fef3c7; box-shadow: inset 0 0 0 3px #d97706, 0 0 20px rgba(245,158,11,.28); }
        }
        @keyframes normal-assistance-flash {
          0%, 100% { background:#fff; box-shadow: inset 0 0 0 2px rgba(131,123,185,.35); }
          50% { background:#f3f0ff; box-shadow: inset 0 0 0 3px #837bb9, 0 0 18px rgba(131,123,185,.25); }
        }
        .medical-assistance-new { animation: medical-assistance-flash .85s ease-in-out infinite; }
        .navigation-assistance-new { animation: navigation-assistance-flash 1.15s ease-in-out infinite; }
        .normal-assistance-new { animation: normal-assistance-flash 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .medical-assistance-new,.navigation-assistance-new,.normal-assistance-new { animation:none; }
        }
      `}</style>

      <ConnectionStatusBanner />

      <header className="bg-[#23479A] text-white">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-blue-100">
              Control Centre
            </p>
            <h1 className="mt-1 text-2xl font-extrabold md:text-3xl">
              Operations Dashboard
            </h1>
            <p className="mt-2 text-xs font-semibold text-blue-100">
              Last successful update:{" "}
              {formatClock(
                lastUpdated
              )}{" "}
              • Auto refresh every 10
              seconds
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void load()
              }
              className="min-h-10 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-bold"
            >
              ↻ Refresh Now
            </button>

            {!alertsEnabled && (
              <button
                type="button"
                onClick={
                  enableAlerts
                }
                className="min-h-10 rounded-xl bg-white px-4 text-sm font-extrabold text-[#173A82]"
              >
                🔔 Enable Ops Alerts
              </button>
            )}

            <Link
              href="/control"
              className="flex min-h-10 items-center rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-bold"
            >
              Back
            </Link>
          </div>
        </div>
      </header>

      <div className="space-y-6 px-5 py-6 md:px-8">
        {refreshProblem && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
            ⚠ {refreshProblem}
          </div>
        )}

        {status && (
          <div className="rounded-xl border bg-white p-4 text-sm font-bold text-slate-700">
            {status}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {[
            [
              "Teams",
              dashboard?.activeTeams ??
                "—",
              "👥",
            ],
            [
              "Fresh GPS",
              dashboard?.freshTrustedGps ??
                "—",
              "📍",
            ],
            [
              "Stale / No GPS",
              dashboard?.staleOrMissingGps ??
                "—",
              "⚠️",
            ],
            [
              "Help Waiting",
              dashboard?.openAssistance ??
                "—",
              "🆘",
            ],
            [
              "Help Ack.",
              dashboard?.acknowledgedAssistance ??
                "—",
              "✓",
            ],
            [
              "Waves Started",
              dashboard
                ? `${dashboard.wavesStarted}/${dashboard.wavesTotal}`
                : "—",
              "🏁",
            ],
            [
              "Event",
              dashboard?.eventStatus?.toUpperCase() ??
                "—",
              "🟢",
            ],
          ].map(
            ([
              label,
              value,
              icon,
            ]) => (
              <div
                key={String(
                  label
                )}
                className="rounded-2xl border bg-white p-4 shadow-sm"
              >
                <div className="text-2xl">
                  {icon}
                </div>
                <p className="mt-2 text-xs font-bold uppercase text-slate-500">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-black text-[#173A82]">
                  {value}
                </p>
              </div>
            )
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-500">
                  Team Assistance
                </p>
                <h2 className="mt-1 text-xl font-extrabold text-[#173A82]">
                  Active Help Requests
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-extrabold text-red-700">
                  {
                    activeRequests.length
                  }{" "}
                  ACTIVE
                </span>

                <button
                  type="button"
                  disabled={working}
                  onClick={
                    resetAssistanceSystem
                  }
                  className="min-h-9 rounded-xl border border-red-300 bg-white px-3 text-xs font-extrabold text-red-700 disabled:opacity-40"
                >
                  RESET ASSISTANCE
                  SYSTEM
                </button>
              </div>
            </div>

            <div className="divide-y">
              {activeRequests.length ===
              0 ? (
                <p className="p-6 text-sm text-slate-500">
                  No active Team
                  assistance requests.
                </p>
              ) : (
                activeRequests.map(
                  (row) => {
                    const isNew =
                      newRequestIds.has(
                        row.id
                      );
                    const updating =
                      updatingRequestId ===
                      row.id;

                    return (
                      <div
                        key={
                          row.id
                        }
                        className={`p-5 ${
                          row.category ===
                          "medical"
                            ? "border-l-4 border-red-500 bg-red-50/70"
                            : ""
                        } ${
                          isNew
                            ? row.category ===
                              "medical"
                              ? "medical-assistance-new"
                              : row.category ===
                                "lost_navigation"
                              ? "navigation-assistance-new"
                              : "normal-assistance-new"
                            : ""
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            {isNew && (
                              <span className="mb-2 inline-flex rounded-full bg-red-600 px-3 py-1 text-[10px] font-black text-white">
                                NEW REQUEST
                              </span>
                            )}

                            <p className="text-lg font-black text-slate-900">
                              Team{" "}
                              {
                                row
                                  .teams
                                  .team_number
                              }{" "}
                              —{" "}
                              {
                                row
                                  .teams
                                  .team_name
                              }
                            </p>

                            {(row.teams.contact_name || row.teams.contact_phone) && (
                              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                                {row.teams.contact_name && (
                                  <span>👤 {row.teams.contact_name}</span>
                                )}
                                {row.teams.contact_phone && (
                                  <a
                                    href={`tel:${row.teams.contact_phone}`}
                                    className="text-[#173A82] underline"
                                  >
                                    📞 {row.teams.contact_phone}
                                  </a>
                                )}
                              </div>
                            )}

                            <p
                              className={`mt-1 font-bold capitalize ${
                                row.category ===
                                "medical"
                                  ? "text-red-700"
                                  : "text-[#173A82]"
                              }`}
                            >
                              {row.category ===
                              "medical"
                                ? "🚑 MEDICAL"
                                : row.category ===
                                  "lost_navigation"
                                ? "🧭 Lost / Navigation"
                                : assistanceLabel(
                                    row.category
                                  )}
                            </p>
                          </div>

                          <span
                            className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                              row.status ===
                              "acknowledged"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {row.status ===
                            "acknowledged"
                              ? "ACKNOWLEDGED"
                              : "WAITING"}
                          </span>
                        </div>

                        {row.details && (
                          <p className="mt-3 text-sm leading-6 text-slate-600">
                            {
                              row.details
                            }
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                          <span>
                            {new Date(
                              row.requested_at
                            ).toLocaleString(
                              "en-SG"
                            )}
                          </span>
                        </div>

                        {row.latitude !=
                          null &&
                        row.longitude !=
                          null ? (
                          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-blue-600">
                                  📍 Team Location
                                  at Request
                                </p>
                                <p className="mt-1 font-mono text-sm font-bold text-blue-900">
                                  {Number(
                                    row.latitude
                                  ).toFixed(
                                    6
                                  )}
                                  ,{" "}
                                  {Number(
                                    row.longitude
                                  ).toFixed(
                                    6
                                  )}
                                </p>
                                <p className="mt-1 text-xs font-semibold text-blue-700">
                                  {row.accuracy_m !=
                                  null
                                    ? `GPS accuracy ±${Math.round(
                                        row.accuracy_m
                                      )}m`
                                    : "GPS accuracy unavailable"}
                                </p>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <a
                                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                    `${row.latitude},${row.longitude}`
                                  )}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex min-h-10 items-center rounded-xl bg-[#23479A] px-4 text-xs font-extrabold text-white"
                                >
                                  OPEN GPS
                                  LOCATION
                                </a>

                                <Link
                                  href="/control/map"
                                  className="flex min-h-10 items-center rounded-xl border border-blue-300 bg-white px-4 text-xs font-extrabold text-[#173A82]"
                                >
                                  OPEN LIVE MAP
                                </Link>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">
                              📍 Team Location
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-600">
                              No recent GPS
                              location was
                              available when
                              this assistance
                              request was sent.
                            </p>
                            <Link
                              href="/control/map"
                              className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-xs font-extrabold text-[#173A82]"
                            >
                              CHECK LIVE MAP
                            </Link>
                          </div>
                        )}

                        {row.control_response && (
                          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                            <p className="text-xs font-extrabold uppercase text-blue-600">
                              Response Sent
                            </p>
                            <p className="mt-1 text-sm font-bold text-blue-900">
                              {
                                row.control_response
                              }
                            </p>
                          </div>
                        )}

                        <div className="mt-3">
                          <textarea
                            value={
                              responseDrafts[
                                row
                                  .id
                              ] ||
                              ""
                            }
                            onChange={(
                              event
                            ) =>
                              setResponseDrafts(
                                (
                                  current
                                ) => ({
                                  ...current,
                                  [row.id]:
                                    event
                                      .target
                                      .value,
                                })
                              )
                            }
                            rows={2}
                            maxLength={
                              800
                            }
                            placeholder="Reply to Team, e.g. Stay where you are, staff are on the way."
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                          />

                          <button
                            type="button"
                            disabled={
                              updating
                            }
                            onClick={() =>
                              sendAssistanceResponse(
                                row.id
                              )
                            }
                            className="mt-2 min-h-10 w-full rounded-xl bg-[#342e57] px-4 text-sm font-extrabold text-white disabled:opacity-50"
                          >
                            SEND RESPONSE TO
                            TEAM
                          </button>
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {row.status ===
                            "sent" && (
                            <button
                              type="button"
                              disabled={
                                updating
                              }
                              onClick={() =>
                                assistanceAction(
                                  row.id,
                                  "acknowledge"
                                )
                              }
                              className="min-h-11 rounded-xl bg-[#23479A] px-4 font-extrabold text-white disabled:opacity-50"
                            >
                              {updating
                                ? "UPDATING..."
                                : "ACKNOWLEDGE"}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={
                              updating
                            }
                            onClick={() =>
                              assistanceAction(
                                row.id,
                                "resolve"
                              )
                            }
                            className="min-h-11 rounded-xl bg-emerald-600 px-4 font-extrabold text-white disabled:opacity-50"
                          >
                            {updating
                              ? "UPDATING..."
                              : "RESOLVE"}
                          </button>
                        </div>
                      </div>
                    );
                  }
                )
              )}
            </div>
          </section>

          <ControlSafetyDispatchStatus
            embedded
          />
        </div>

        <section className="rounded-2xl border bg-white shadow-sm">
          <button
            type="button"
            onClick={() =>
              setShowAssistanceHistory(
                (value) =>
                  !value
              )
            }
            className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-left"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                Team Assistance
              </p>
              <h2 className="mt-1 text-lg font-extrabold text-[#173A82]">
                Resolved / Cancelled
                Request History
              </h2>
            </div>

            <span className="font-black text-[#23479A]">
              {showAssistanceHistory
                ? "Hide"
                : "Show"}
            </span>
          </button>

          {showAssistanceHistory && (
            <div className="divide-y border-t">
              {assistanceHistory.length ===
              0 ? (
                <p className="p-5 text-sm text-slate-500">
                  No resolved or
                  cancelled assistance
                  requests yet.
                </p>
              ) : (
                assistanceHistory
                  .slice(0, 30)
                  .map((row) => (
                    <div
                      key={
                        row.id
                      }
                      className="p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-extrabold text-slate-800">
                          Team{" "}
                          {
                            row
                              .teams
                              .team_number
                          }{" "}
                          —{" "}
                          {
                            row
                              .teams
                              .team_name
                          }
                        </p>

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                            row.status ===
                            "resolved"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {row.status.toUpperCase()}
                        </span>
                      </div>

                      <p className="mt-1 text-sm font-bold capitalize text-slate-600">
                        {row.category.replaceAll(
                          "_",
                          " / "
                        )}
                      </p>

                      {row.details && (
                        <p className="mt-2 text-sm text-slate-500">
                          {
                            row.details
                          }
                        </p>
                      )}

                      {row.control_response && (
                        <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs font-semibold text-blue-800">
                          Control response:{" "}
                          {
                            row.control_response
                          }
                        </p>
                      )}
                    </div>
                  ))
              )}
            </div>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
          <ControlOperationsMessages />

          <EmergencyBroadcastPanel
            activeBroadcast={
              activeBroadcast
            }
            dashboard={dashboard}
            broadcastType={
              broadcastType
            }
            title={title}
            message={message}
            working={working}
            resendingBroadcast={
              resendingBroadcast
            }
            showPendingTeams={
              showPendingTeams
            }
            setShowPendingTeams={
              setShowPendingTeams
            }
            setTitle={setTitle}
            setMessage={setMessage}
            applyTemplate={
              applyTemplate
            }
            sendBroadcast={
              sendBroadcast
            }
            resendUnacknowledged={
              resendUnacknowledged
            }
            endBroadcast={endBroadcast}
            broadcasts={broadcasts}
            showBroadcastHistory={showBroadcastHistory}
            setShowBroadcastHistory={setShowBroadcastHistory}
            clearBroadcastHistory={clearBroadcastHistory}
            clearingBroadcastHistory={clearingBroadcastHistory}
          />
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/control/event-timing"
            className="rounded-2xl border bg-white p-4 text-center font-extrabold text-[#173A82] shadow-sm"
          >
            🏁 Race Operations
          </Link>

          <Link
            href="/control/map"
            className="rounded-2xl border bg-white p-4 text-center font-extrabold text-[#173A82] shadow-sm"
          >
            🗺️ Live Map
          </Link>

          <Link
            href="/control/readiness"
            className="rounded-2xl border bg-white p-4 text-center font-extrabold text-[#173A82] shadow-sm"
          >
            ✅ Readiness
          </Link>
        </section>
      </div>
    </main>
  );
}
