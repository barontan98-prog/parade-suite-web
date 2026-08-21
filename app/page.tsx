"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTrack,
  deleteSequenceItem,
  listSequence,
  listTracks,
  saveSequenceItem,
  updateTrackTiming,
  uploadAudioFile,
} from "@/lib/data";
import { AudioEngine } from "@/lib/audio";
import {
  beatContextForPosition,
  loadWindowsTimingMap,
  nextPhraseBoundaryMs,
  nextQuantizedHalfBeatMs,
  nextQuantizedBeatMs,
  normalizeTrackName,
  repeatStartMsForTrack,
} from "@/lib/timing";
import type { SequenceItem, Track, TrackAction } from "@/lib/types";
import { windowsMetadataForFile } from "@/lib/windowsLibrary";

const CATEGORIES = [
  "Salutes",
  "Fast March",
  "Slow March",
  "Inspection Tunes",
  "Drum Solo",
  "Bugle Calls",
  "Fanfares",
  "Interlude Music",
  "Others",
];

type AccessUser = {
  id: string;
  name: string;
  role: "admin" | "user";
};

type AdminUser = AccessUser & {
  active: boolean;
  created_at: string;
  last_login: string | null;
};


function allowedActions(track: Track): TrackAction[] {
  if (track.category === "Interlude Music") return ["Interlude"];
  return ["Repeat", "End"];
}

function defaultAction(track: Track): TrackAction {
  if (track.category === "Interlude Music") return "Interlude";

  if (
    ["Salutes", "Bugle Calls", "Fanfares"].includes(track.category) ||
    track.title.trim().toLowerCase() === "dressing roll"
  ) return "End";

  return "Repeat";
}





type ParadeSequenceFile = {
  type: "parade-suite-sequence";
  version: 2;
  name?: string;
  sequence: Array<{
    track: string;
    action: TrackAction;
  }>;
};

function basenameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const raw = url.pathname.split("/").pop() || "";
    return decodeURIComponent(raw).replace(/^[0-9a-f-]{30,}-/i, "");
  } catch {
    return value.split("/").pop() || value;
  }
}

function musicFileName(track: Track | null | undefined) {
  if (!track) return "";
  const source = (track.source_name || "").trim();
  if (source) return source;
  const fromUrl = basenameFromUrl(track.file_url || "").trim();
  return fromUrl || track.title;
}

function normalizedMusicFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export default function Home() {
  const audio = useRef<AudioEngine | null>(null);
  const scheduledTimers = useRef<number[]>([]);
  const endingGeneration = useRef(0);
  const pendingEndingRef = useRef(false);
  const paradeFileInput = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<"editor" | "manager">("editor");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState("Beat Sync: waiting for track");

  const [interludeDefault, setInterludeDefault] = useState(60);
  const [interludeLive, setInterludeLive] = useState(60);
  const [musicVolume, setMusicVolume] = useState(80);
  const [cueVolume, setCueVolume] = useState(100);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [endingQueued, setEndingQueued] = useState(false);

  const [authChecked, setAuthChecked] = useState(false);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [loginPin, setLoginPin] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminMessage, setAdminMessage] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPin, setNewUserPin] = useState("");

  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadCurrent, setUploadCurrent] = useState("");
  const [uploadOverall, setUploadOverall] = useState({ done: 0, total: 0 });
  const [uploadFilePercent, setUploadFilePercent] = useState(0);
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const [uploadSuccesses, setUploadSuccesses] = useState<string[]>([]);
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);

  useEffect(() => {
    audio.current = new AudioEngine();
    audio.current.setMusicVolume(0.8);
    audio.current.setCueVolume(1.0);

    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const result = await response.json();
        if (result.authenticated && result.user) {
          setAccessUser(result.user);
        }
      } catch {
        setAccessUser(null);
      } finally {
        setAuthChecked(true);
      }
    })();

    return () => clearScheduledTimers();
  }, []);

  useEffect(() => {
    if (!accessUser) return;

    Promise.all([listTracks(), listSequence()]).then(async ([t, s]) => {
      const builtInTracks = await refreshTracksFromBuiltInLIBs(t);
      setTracks(builtInTracks);
      setSequence(s);
      if (s.length) setSelectedIndex(0);
    });
  }, [accessUser?.id]);

  useEffect(() => {
    audio.current?.setInterludeVolume(interludeLive / 100);
  }, [interludeLive]);

  useEffect(() => {
    audio.current?.setMusicVolume(musicVolume / 100);
  }, [musicVolume]);

  useEffect(() => {
    audio.current?.setCueVolume(cueVolume / 100);
  }, [cueVolume]);

  async function submitPasscode(e?: React.FormEvent) {
    e?.preventDefault();

    if (!/^\d{4}$/.test(loginPin)) {
      setLoginMessage("Please check with the admin");
      return;
    }

    setLoginBusy(true);
    setLoginMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: loginPin }),
      });
      const result = await response.json();

      if (!response.ok || !result.user) {
        setLoginMessage("Please check with the admin");
        setLoginPin("");
        return;
      }

      setAccessUser(result.user);
      setLoginPin("");
      setLoginMessage("");
    } catch {
      setLoginMessage("Please check with the admin");
      setLoginPin("");
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearScheduledTimers();
    audio.current?.hardStopMain();
    audio.current?.stopInterludeImmediately();
    audio.current?.stopPreview();
    setAccessUser(null);
    setTracks([]);
    setSequence([]);
    setSelectedIndex(null);
    setAdminOpen(false);
    setLoginPin("");
  }

  async function loadAdminUsers() {
    setAdminMessage("");
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const result = await response.json();

    if (!response.ok) {
      setAdminMessage("Unable to load users.");
      return;
    }

    setAdminUsers(result.users ?? []);
  }

  async function openAdmin() {
    setAdminOpen(true);
    await loadAdminUsers();
  }

  async function addAccessUser(e: React.FormEvent) {
    e.preventDefault();
    setAdminMessage("");

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newUserName, pin: newUserPin }),
    });
    const result = await response.json();

    if (!response.ok) {
      setAdminMessage(result.message || "Unable to create user.");
      return;
    }

    setNewUserName("");
    setNewUserPin("");
    setAdminMessage(`${result.user.name} added.`);
    await loadAdminUsers();
  }

  async function updateAccessUser(
    id: string,
    update: { name?: string; pin?: string; active?: boolean }
  ) {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...update }),
    });
    const result = await response.json();

    if (!response.ok) {
      setAdminMessage(result.message || "Unable to update user.");
      return;
    }

    setAdminMessage(`${result.user.name} updated.`);
    await loadAdminUsers();
  }

  async function resetUserPin(user: AdminUser) {
    const pin = window.prompt(`Enter a new 4-digit passcode for ${user.name}:`);
    if (pin === null) return;

    if (!/^\d{4}$/.test(pin)) {
      setAdminMessage("Passcode must be exactly 4 digits.");
      return;
    }

    await updateAccessUser(user.id, { pin });
  }

  async function renameAccessUser(user: AdminUser) {
    const name = window.prompt("Name:", user.name);
    if (name === null || !name.trim()) return;
    await updateAccessUser(user.id, { name: name.trim() });
  }

  async function deleteAccessUser(user: AdminUser) {
    if (!window.confirm(`Delete ${user.name}'s access?`)) return;

    const response = await fetch(
      `/api/admin/users?id=${encodeURIComponent(user.id)}`,
      { method: "DELETE" }
    );
    const result = await response.json();

    if (!response.ok) {
      setAdminMessage(result.message || "Unable to delete user.");
      return;
    }

    setAdminMessage(`${user.name} deleted.`);
    await loadAdminUsers();
  }

  async function refreshTracksFromBuiltInLIBs(inputTracks: Track[]) {
    const refreshed: Track[] = [];

    for (const track of inputTracks) {
      const sourceName = track.source_name || `${track.title}.wav`;
      const windowsMap = await loadWindowsTimingMap(sourceName);
      const builtIn = windowsMap?.parsed;

      if (!windowsMap) {
        console.warn(
          `[Parade Suite] No built-in LIB match for "${sourceName}". ` +
          `Expected normalized key from a file in public/legacy_timing_maps.`
        );
      }

      const desired = {
        has_lib: Boolean(windowsMap),
        has_timing_map: Boolean(builtIn?.beatMap?.length),
        timing_map: builtIn?.beatMap ?? [],
        repeat_start_ms: builtIn?.repeatStartMs ?? null,
        repeat_end_ms: builtIn?.repeatEndMs ?? null,
        repeat_mode: builtIn?.repeatMode ?? null,
        lib_name: windowsMap?.libName ?? null,
      };

      const changed =
        Boolean(track.has_lib) !== desired.has_lib ||
        Boolean(track.has_timing_map) !== desired.has_timing_map ||
        JSON.stringify(track.timing_map ?? []) !== JSON.stringify(desired.timing_map) ||
        (track.repeat_start_ms ?? null) !== desired.repeat_start_ms ||
        (track.repeat_end_ms ?? null) !== desired.repeat_end_ms ||
        (track.repeat_mode ?? null) !== desired.repeat_mode ||
        (track.lib_name ?? null) !== desired.lib_name;

      if (changed) {
        try {
          const updated = await updateTrackTiming(track.id, desired);
          refreshed.push(updated);
          continue;
        } catch (error) {
          console.error("Built-in LIB sync failed", error);
        }
      }

      refreshed.push({ ...track, ...desired });
    }

    return refreshed;
  }

  function isInterludeTrack(track: Track | null | undefined) {
    if (!track) return false;
    const title = track.title.toLowerCase();
    const category = (track.category || "").toLowerCase();

    return (
      category.includes("interlude") ||
      title.startsWith("interlude") ||
      title.includes("interlude -")
    );
  }

  async function previewMusic(track: Track) {
    try {
      if (previewTrackId === track.id && audio.current?.isPreviewPlaying()) {
        audio.current.stopPreview();
        setPreviewTrackId(null);
        return;
      }

      audio.current?.stopPreview();
      await audio.current?.playPreview(track.file_url, musicVolume / 100);
      setPreviewTrackId(track.id);
    } catch (error) {
      console.error("Preview playback failed", error);
      setPreviewTrackId(null);
      setStatus(`PREVIEW FAILED • ${musicFileName(track)}`);
    }
  }

  function saveParadeSequence() {
    const entries = sequence
      .map((item) => {
        const track = tracks.find((candidate) => candidate.id === item.track_id);
        if (!track) return null;
        return {
          track: musicFileName(track),
          action: item.action,
        };
      })
      .filter(
        (entry): entry is { track: string; action: TrackAction } =>
          Boolean(entry?.track)
      );

    const payload: ParadeSequenceFile = {
      type: "parade-suite-sequence",
      version: 2,
      sequence: entries,
    };

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "parade.parade.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setStatus(`SAVED PARADE SEQUENCE • ${entries.length} tracks`);
  }

  async function openParadeSequence(file: File | null | undefined) {
    if (!file) return;

    try {
      const raw = JSON.parse(await file.text()) as Partial<ParadeSequenceFile>;

      if (
        raw.type !== "parade-suite-sequence" ||
        raw.version !== 2 ||
        !Array.isArray(raw.sequence)
      ) {
        throw new Error(
          "This is not a Parade Suite sequence-only file (version 2)."
        );
      }

      const trackByName = new Map<string, Track>();
      for (const track of tracks) {
        const filename = musicFileName(track);
        const key = normalizedMusicFileName(filename);
        if (key && !trackByName.has(key)) {
          trackByName.set(key, track);
        }
      }

      const resolved: SequenceItem[] = [];
      const missing: string[] = [];

      for (let position = 0; position < raw.sequence.length; position += 1) {
        const entry = raw.sequence[position];
        if (!entry || typeof entry.track !== "string") continue;

        const key = normalizedMusicFileName(entry.track);
        const track = trackByName.get(key);

        if (!track) {
          missing.push(entry.track);
          continue;
        }

        const requestedAction = entry.action;
        const actions = allowedActions(track);
        const action: TrackAction =
          requestedAction && actions.includes(requestedAction)
            ? requestedAction
            : defaultAction(track);

        resolved.push({
          id: crypto.randomUUID(),
          track_id: track.id,
          action,
          position: resolved.length,
        });
      }

      // Replace only the Parade Sequence. Music/library records are untouched.
      await Promise.all(sequence.map((item) => deleteSequenceItem(item.id)));

      const saved: SequenceItem[] = [];
      for (const item of resolved) {
        saved.push(await saveSequenceItem(item));
      }

      setSequence(saved);
      setSelectedIndex(saved.length ? 0 : null);

      if (missing.length) {
        setStatus(
          `PARADE LOADED • ${saved.length} ready • ${missing.length} missing: ${missing.join(", ")}`
        );
      } else {
        setStatus(`PARADE READY • ${saved.length} tracks matched automatically`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to open parade file.";
      setStatus(`OPEN PARADE FAILED • ${message}`);
    }
  }

  const filteredTracks = useMemo(() => {
    return tracks.filter((track) => {
      const textOk =
        !search || track.title.toLowerCase().includes(search.toLowerCase());
      const categoryOk =
        category === "All Categories" || track.category === category;
      return textOk && categoryOk;
    });
  }, [tracks, search, category]);

  const selected =
    selectedIndex === null ? null : sequence[selectedIndex] ?? null;

  const selectedTrack = selected
    ? tracks.find((track) => track.id === selected.track_id) ?? null
    : null;

  const nextItem =
    selectedIndex !== null && selectedIndex + 1 < sequence.length
      ? sequence[selectedIndex + 1]
      : null;

  const nextTrack = nextItem
    ? tracks.find((track) => track.id === nextItem.track_id) ?? null
    : null;

  function clearScheduledTimers() {
    for (const timer of scheduledTimers.current) window.clearTimeout(timer);
    scheduledTimers.current = [];
  }

  function schedule(delayMs: number, callback: () => void) {
    const timer = window.setTimeout(() => {
      scheduledTimers.current = scheduledTimers.current.filter((x) => x !== timer);
      callback();
    }, Math.max(0, delayMs));
    scheduledTimers.current.push(timer);
  }

  async function importMusic(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || uploadBusy) return;

    const files = Array.from(fileList).filter(
      (file) => !file.name.toLowerCase().endsWith(".lib")
    );
    if (!files.length) return;

    setUploadBusy(true);
    setUploadFailures([]);
    setUploadSuccesses([]);
    setUploadOverall({ done: 0, total: files.length });
    setUploadFilePercent(0);
    setStatus(`Preparing ${files.length} music file${files.length === 1 ? "" : "s"}…`);

    const successes: string[] = [];
    const failures: string[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const title = file.name.replace(/\.[^.]+$/, "");

      setUploadCurrent(file.name);
      setUploadFilePercent(0);
      setStatus(`Uploading ${index + 1} / ${files.length}: ${file.name}`);

      try {
        if (file.size > 50 * 1024 * 1024) {
          setStatus(
            `Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB). ` +
            `Supabase Free projects cannot accept files over 50 MB.`
          );
        }

        const publicUrl = await uploadAudioFile(
          file,
          (uploadedBytes, totalBytes) => {
            const percent =
              totalBytes > 0
                ? Math.round((uploadedBytes / totalBytes) * 100)
                : 0;
            setUploadFilePercent(Math.max(0, Math.min(100, percent)));
          }
        );

        const windowsMeta = await windowsMetadataForFile(file.name);
        const windowsMap = await loadWindowsTimingMap(file.name);
        const builtIn = windowsMap?.parsed;

        const track = await createTrack({
          title: windowsMeta.record?.title || builtIn?.title || title,
          category:
            windowsMeta.category ||
            builtIn?.category ||
            guessCategory(file.name),
          file_url: publicUrl,
          source_name: file.name,
          has_lib: Boolean(windowsMap),
          has_timing_map: Boolean(builtIn?.beatMap?.length),
          timing_map: builtIn?.beatMap ?? [],
          repeat_start_ms: builtIn?.repeatStartMs ?? null,
          repeat_end_ms: builtIn?.repeatEndMs ?? null,
          repeat_mode: builtIn?.repeatMode ?? null,
          lib_name: windowsMap?.libName ?? null,
        });

        setTracks((old) => [...old, track]);
        successes.push(file.name);
        setUploadSuccesses([...successes]);
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Unknown upload error";
        const failure = `${file.name} — ${message}`;
        failures.push(failure);
        setUploadFailures([...failures]);
        console.error("Music upload failed", file.name, error);
      } finally {
        setUploadOverall({ done: index + 1, total: files.length });
      }
    }

    setUploadBusy(false);
    setUploadCurrent("");
    setUploadFilePercent(0);

    if (failures.length === 0) {
      setStatus(
        `Music import complete: ${successes.length} / ${files.length} uploaded successfully.`
      );
    } else {
      setStatus(
        `Music import complete: ${successes.length} succeeded, ${failures.length} failed. See Upload Results.`
      );
    }
  }


  async function addTrackToSequence(track: Track) {
    const item = await saveSequenceItem({
      id: crypto.randomUUID(),
      track_id: track.id,
      action: defaultAction(track),
      position: sequence.length,
    });

    setSequence((old) => [...old, item]);
    if (selectedIndex === null) setSelectedIndex(0);
  }

  async function changeAction(item: SequenceItem, action: TrackAction) {
    const updated = { ...item, action };
    setSequence((old) => old.map((x) => x.id === item.id ? updated : x));
    await saveSequenceItem(updated);
  }

  async function removeItem(index: number) {
    const item = sequence[index];
    await deleteSequenceItem(item.id);

    const next = sequence
      .filter((_, i) => i !== index)
      .map((x, i) => ({ ...x, position: i }));

    setSequence(next);
    for (const x of next) await saveSequenceItem(x);

    if (!next.length) setSelectedIndex(null);
    else setSelectedIndex(Math.min(selectedIndex ?? 0, next.length - 1));
  }

  async function reorder(from: number, to: number) {
    if (from === to) return;

    const next = [...sequence];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    const normalized = next.map((x, i) => ({ ...x, position: i }));
    setSequence(normalized);

    for (const item of normalized) await saveSequenceItem(item);
    setSelectedIndex(to);
  }

  async function playIndex(index: number) {
    const item = sequence[index];
    const track = item ? tracks.find((x) => x.id === item.track_id) : null;
    if (!item || !track) return;

    setSelectedIndex(index);

    if (item.action === "Interlude") {
      setStatus("INTERLUDE LOADED • use Play / Loop");
      return;
    }

    clearScheduledTimers();
    endingGeneration.current += 1;
    setEndingQueued(false);
    audio.current?.setRepeatSuppressed(false);

    await audio.current?.playMain(track.file_url, {
      action: item.action,
      repeatStartMs: repeatStartMsForTrack(track),
      repeatEndMs: track.repeat_end_ms,
      repeatMode: track.repeat_mode,
      onNaturalEnd: () => handleNaturalEnd(index),
    });

    setStatus(`Sequence action: ${item.action.toUpperCase()}`);

    if (track.timing_map?.length) {
      setSyncStatus(
        `Beat Sync: ACTIVE • ${track.lib_name || "timing map"} • ${track.timing_map.length} timing markers`
      );
    } else {
      setSyncStatus("Beat Sync: no matching .lib found");
    }
  }

  async function playSelected() {
    if (selectedTrack && isInterludeTrack(selectedTrack)) {
      await playInterlude();
      return;
    }

    if (selectedIndex === null) return;

    // Direct user gesture unlock for iOS/iPadOS Safari cue playback.
    await audio.current?.prepareCueAudio();
    await playIndex(selectedIndex);
 
  }

  function handleNaturalEnd(index: number) {
    const item = sequence[index];
    if (!item) return;

    if (item.action === "End") {
      audio.current?.stopMain();

      if (index + 1 < sequence.length) {
        setSelectedIndex(index + 1);
        const next = sequence[index + 1];
        setStatus(
          next.action === "Interlude"
            ? "PREVIOUS SONG ENDED • interlude loaded • use Interlude Play / Loop"
            : "PREVIOUS SONG ENDED • next track selected • press Play when ready"
        );
      } else {
        setStatus("PARADE MUSIC ENDED");
      }
    }
  }

  async function scheduleManualCue(kind: "single" | "double" | "doubleDouble") {
    const engine = audio.current;
    if (!engine) return;

    // This tap unlocks and prepares the exact uploaded cue files.
    await engine.prepareCueAudio();

    const filename =
      kind === "single"
        ? "singlebeat.wav"
        : "doublebeat.wav";

    const repeats = kind === "doubleDouble" ? 2 : 1;

    // Exact Windows v0.104 behavior when no march is playing:
    // play one cue immediately.
    if (!engine.isMainPlaying()) {
      await engine.playCueFile(filename, 950, 0.30);
      setSyncStatus("Cue played immediately");
      return;
    }

    const beatMap = selectedTrack?.timing_map ?? [];
    const position = engine.getMainPositionMs();

    // Exact Windows fallback when there is no timing map:
    // play one cue immediately.
    if (!beatMap.length) {
      await engine.playCueFile(filename, 950, 0.30);
      setSyncStatus("Beat Sync: no timing map — cue played immediately");
      return;
    }

    // Exact Windows timing rule:
    // phrase boundary +250 ms lead, full-beat fallback +120 ms,
    // cue starts 45 ms before target.
    let target = nextPhraseBoundaryMs(beatMap, position, 250);
    if (target === null) {
      target = nextQuantizedBeatMs(beatMap, position, 120);
    }

    if (target === null) {
      await engine.playCueFile(filename, 950, 0.30);
      return;
    }

    const delay = Math.max(0, target - position - 45);

    // IMPORTANT iOS fix:
    // schedule the AudioBufferSourceNode NOW on the WebAudio clock.
    // Do not wait until the cue time and then call play().
    const firstScheduled = await engine.scheduleCueFile(
      filename,
      delay,
      950,
      0.30
    );

    if (!firstScheduled) {
      // Fallback only if WebAudio scheduling itself is unavailable.
      schedule(
        delay,
        () => void engine.playCueFile(filename, 950, 0.30)
      );
    }

    if (repeats > 1) {
      const row = beatContextForPosition(beatMap, target);
      const fullInterval = row?.full_ms ?? 500;
      const secondDelay = delay + (2 * fullInterval);

      const secondScheduled = await engine.scheduleCueFile(
        filename,
        secondDelay,
        950,
        0.30
      );

      if (!secondScheduled) {
        schedule(
          secondDelay,
          () => void engine.playCueFile(filename, 950, 0.30)
        );
      }
    }

    setSyncStatus(
      `Beat Sync: ${kind === "doubleDouble" ? "2x Double" : kind === "double" ? "Double" : "Single"} queued at ${(target / 1000).toFixed(2)}s`
    );
  }

  function requestMusicalEnding(action: "end" | "next") {
    const engine = audio.current;

    // Interlude End Song intentionally behaves like the Interlude Stop button:
    // fade to silence over 5 seconds, stop, reset to Default %, then select
    // the next playlist item without auto-playing it.
    if (
      action === "end" &&
      engine &&
      selectedIndex !== null &&
      selectedTrack &&
      isInterludeTrack(selectedTrack)
    ) {
      void stopInterlude();
      return;
    }

    void engine?.prepareCueAudio();

    if (
      !engine ||
      !engine.isMainPlaying() ||
      selectedIndex === null ||
      !selectedTrack
    ) return;

    const beatMap = selectedTrack.timing_map ?? [];
    const position = engine.getMainPositionMs();

    if (!beatMap.length) {
      setStatus(
        "Beat map required • this track has no matching timing map, so Parade Suite cannot perform a beat-synchronised ending."
      );
      return;
    }

    // Exact Windows request_musical_ending values.
    let target = nextPhraseBoundaryMs(beatMap, position, 500);
    if (target === null) {
      target = nextQuantizedBeatMs(beatMap, position, 250);
    }
    if (target === null) return;

    const cueStart = Math.max(position, target - 110);
    const delay = Math.max(0, cueStart - position);

    const requestIndex = selectedIndex;
    const generation = ++endingGeneration.current;

    clearScheduledTimers();
    setEndingQueued(true);
    pendingEndingRef.current = true;
    engine.setRepeatSuppressed(true);

    const isKnights =
      normalizeTrackName(selectedTrack.title) ===
      normalizeTrackName("Knights of St John");

    setStatus(
      `${isKnights ? "KNIGHTS ENDING" : "ORIGINAL ENDING"} QUEUED • ${
        action === "end" ? "STOP" : "START NEXT SONG"
      } when Ending Beat finishes`
    );

    setSyncStatus(
      `Ending sync: sequence starts at ${(cueStart / 1000).toFixed(2)}s • target phrase ${(target / 1000).toFixed(2)}s`
    );

    schedule(delay, () => {
      void (async () => {
        if (generation !== endingGeneration.current) return;

        // Exact Windows authoritative trigger: wait for the actual ending WAV
        // to reach EndOfMedia, then hard-stop/unload the march.
        await engine.playEndingCue(isKnights);

        if (generation !== endingGeneration.current) return;

        engine.hardStopMain();
        pendingEndingRef.current = false;
        setEndingQueued(false);

        if (action === "next" && requestIndex + 1 < sequence.length) {
          setStatus("CURRENT SONG ENDED • starting next track");
          schedule(220, () => void playIndex(requestIndex + 1));
          return;
        }

        if (action === "end") {
          if (requestIndex + 1 < sequence.length) {
            const nextIndex = requestIndex + 1;
            setSelectedIndex(nextIndex);

            const next = sequence[nextIndex];
            setStatus(
              next.action === "Interlude"
                ? "SONG ENDED • next Interlude selected • use Interlude Play / Loop"
                : "SONG ENDED • next track selected • press Play when ready"
            );
          } else {
            setStatus("SONG ENDED • end of playlist");
          }
        }
      })();
    });

    // Same Windows fallback watchdog: 12 s after cue delay.
    schedule(delay + 12000, () => {
      if (
        generation === endingGeneration.current &&
        pendingEndingRef.current
      ) {
        pendingEndingRef.current = false;
        engine.hardStopMain();
        setEndingQueued(false);
      }
    });
  }

  function cancelEnding() {
    endingGeneration.current += 1;
    pendingEndingRef.current = false;
    clearScheduledTimers();
    setEndingQueued(false);
    audio.current?.cancelEndingCue();
    audio.current?.setRepeatSuppressed(false);
    setStatus("Ending cancelled");
  }

  async function stopSelected() {
    if (selectedTrack && isInterludeTrack(selectedTrack)) {
      await stopInterlude();
      return;
    }

    audio.current?.stopMain();
    setStatus("STOPPED");
  }

  async function fadeSelected() {
    if (selectedTrack && isInterludeTrack(selectedTrack)) {
      if (!audio.current?.isInterludePlaying()) {
        setStatus("INTERLUDE NOT PLAYING");
        return;
      }

      setStatus("INTERLUDE FADING TO 10% • 5 seconds");
      await audio.current.fadeInterludeToLevel(
        0.10,
        5000,
        (value) => setInterludeLive(Math.round(value * 100))
      );
      setStatus("INTERLUDE AT 10%");
      return;
    }

    clearScheduledTimers();
    endingGeneration.current += 1;
    setEndingQueued(false);
    audio.current?.setRepeatSuppressed(true);
    setStatus("FADING • 5 seconds • music will stop");
    await audio.current?.fadeMainToStop(5000);
    audio.current?.setRepeatSuppressed(false);
    setStatus("FADED OUT • stopped");
  }

  async function restoreInterludeDefault() {
    if (!selectedTrack || !isInterludeTrack(selectedTrack)) {
      setStatus("SELECT AN INTERLUDE TRACK");
      return;
    }

    const target = interludeDefault / 100;
    setStatus(`INTERLUDE RESTORING TO ${interludeDefault}% • 5 seconds`);
    await audio.current?.restoreInterludeVolume(
      target,
      5000,
      (value) => setInterludeLive(Math.round(value * 100))
    );
    setInterludeLive(interludeDefault);
    setStatus(`INTERLUDE RESTORED TO ${interludeDefault}%`);
  }

  async function playInterlude() {
    if (!selectedTrack || !isInterludeTrack(selectedTrack)) {
      setStatus("SELECT AN INTERLUDE TRACK FROM THE PLAYLIST");
      return;
    }

    try {
      setInterludeLive(interludeDefault);
      audio.current?.setInterludeVolume(interludeDefault / 100);
      await audio.current?.playInterlude(
        selectedTrack.file_url,
        interludeDefault / 100
      );
      setStatus("INTERLUDE PLAYING • LOOP ACTIVE");
    } catch (error) {
      console.error("Interlude playback failed", error);
      setStatus("INTERLUDE PLAYBACK FAILED");
    }
  }

  async function stopInterlude() {
    const currentIndex = selectedIndex;

    if (currentIndex === null) {
      setStatus("NO PLAYLIST TRACK SELECTED");
      return;
    }

    if (!audio.current?.isInterludePlaying()) {
      // Even if the Interlude has already stopped, End Song / Stop should
      // still prepare the next playlist item.
      if (currentIndex + 1 < sequence.length) {
        const nextIndex = currentIndex + 1;
        setSelectedIndex(nextIndex);
        setStatus(
          "INTERLUDE STOPPED • next track selected • press Play when ready"
        );
      } else {
        setStatus("INTERLUDE STOPPED • end of playlist");
      }
      return;
    }

    setStatus("INTERLUDE FADING • 5 seconds");

    // Capture the playlist position before the asynchronous 5-second fade.
    // This prevents a stale React state value from stopping the next-row move.
    await audio.current.fadeInterludeToStop(
      5000,
      (value) => setInterludeLive(Math.round(value * 100))
    );

    setInterludeLive(interludeDefault);
    audio.current.setInterludeVolume(interludeDefault / 100);

    if (currentIndex + 1 < sequence.length) {
      const nextIndex = currentIndex + 1;
      setSelectedIndex(nextIndex);
      setStatus(
        "INTERLUDE STOPPED • next track selected • press Play when ready"
      );
    } else {
      setStatus("INTERLUDE STOPPED • end of playlist");
    }
  }

  if (!authChecked) {
    return (
      <main className="access-shell">
        <div className="access-card">
          <h1>PARADE SUITE</h1>
          <p className="hint">Checking access…</p>
        </div>
      </main>
    );
  }

  if (!accessUser) {
    return (
      <main className="access-shell">
        <form className="access-card" onSubmit={submitPasscode}>
          <h1>PARADE SUITE</h1>
          <p>Enter your 4-digit passcode</p>

          <input
            className="pin-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={4}
            value={loginPin}
            onChange={(e) =>
              setLoginPin(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            autoFocus
            aria-label="4-digit passcode"
          />

          <button
            className="button primary access-button"
            type="submit"
            disabled={loginBusy || loginPin.length !== 4}
          >
            {loginBusy ? "Checking…" : "Unlock"}
          </button>

          {loginMessage && (
            <div className="access-error">{loginMessage}</div>
          )}
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Parade Suite</h1>
          <span className="version">Web v0.137 • Interlude Next Selection Fix + Sequence Files</span>
        </div>

        <div className="topbar-access">
          <span className="signed-in-name">{accessUser.name}</span>
          {accessUser.role === "admin" && (
            <button className="button" onClick={() => void openAdmin()}>
              Admin
            </button>
          )}
          <button className="button" onClick={() => void logout()}>
            Log Out
          </button>
        </div>

        <nav className="tabs">
          <button
            className={tab === "editor" ? "active" : ""}
            onClick={() => setTab("editor")}
          >
            Parade Editor
          </button>
          <button
            className={tab === "manager" ? "active" : ""}
            onClick={() => setTab("manager")}
          >
            Parade Manager
          </button>
        </nav>
      </header>

      {tab === "editor" ? (
        <section className="editor-grid">
          <div className="panel">
            <div className="panel-header">
              <h2>Music Library</h2>
              <div className="hint lib-source-note">
                Timing maps: root legacy_timing_maps → generated runtime copy
              </div>

              <div className="import-buttons">
                <button className="button" onClick={saveParadeSequence}>
                  Save Parade
                </button>
                <button
                  className="button"
                  onClick={() => paradeFileInput.current?.click()}
                >
                  Open Parade
                </button>
                <input
                  ref={paradeFileInput}
                  hidden
                  type="file"
                  accept=".json,.parade.json,application/json"
                  onChange={(e) => {
                    void openParadeSequence(e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />

                <label className={`button primary ${uploadBusy ? "disabled" : ""}`}>
                  {uploadBusy ? "Uploading…" : "+ Import Music"}
                  <input
                    hidden
                    multiple
                    type="file"
                    accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"
                    disabled={uploadBusy}
                    onChange={(e) => {
                      void importMusic(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>


              </div>
            </div>

            {(uploadBusy || uploadSuccesses.length > 0 || uploadFailures.length > 0) && (
              <div className="upload-results">
                <div className="upload-results-header">
                  <strong>Upload Results</strong>
                  <span className="hint">
                    {uploadOverall.done} / {uploadOverall.total || uploadSuccesses.length + uploadFailures.length}
                  </span>
                </div>

                {uploadBusy && uploadCurrent && (
                  <>
                    <div className="upload-current" title={uploadCurrent}>
                      {uploadCurrent}
                    </div>
                    <div className="upload-progress-track">
                      <div
                        className="upload-progress-fill"
                        style={{ width: `${uploadFilePercent}%` }}
                      />
                    </div>
                    <div className="hint">{uploadFilePercent}%</div>
                  </>
                )}

                {uploadSuccesses.length > 0 && (
                  <details>
                    <summary>Uploaded successfully ({uploadSuccesses.length})</summary>
                    <div className="upload-result-list">
                      {uploadSuccesses.map((name) => (
                        <div key={`ok-${name}`}>✅ {name}</div>
                      ))}
                    </div>
                  </details>
                )}

                {uploadFailures.length > 0 && (
                  <details open>
                    <summary>Failed ({uploadFailures.length})</summary>
                    <div className="upload-result-list upload-errors">
                      {uploadFailures.map((message) => (
                        <div key={`err-${message}`}>❌ {message}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            <input
              className="input"
              placeholder="Search music track…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option>All Categories</option>
              {CATEGORIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>

            <div className="list">
              {filteredTracks.map((track) => (
                <div className="library-row" key={track.id}>
                  <div>
                    <strong>{musicFileName(track)}</strong>
                    <small>{track.category}</small>
                  </div>

                  <div className="row-actions">
                    <span title={track.lib_name || "Timing map"}>
                      {(track.has_lib || track.has_timing_map) ? "✅" : "❌"}
                    </span>
                    <button
                      className={`preview-btn ${previewTrackId === track.id ? "previewing" : ""}`}
                      onClick={() => void previewMusic(track)}
                      title="Preview music"
                    >
                      {previewTrackId === track.id ? "■ Stop" : "▶ Preview"}
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => addTrackToSequence(track)}
                      title="Add to parade sequence"
                    >
                      ＋
                    </button>
                  </div>
                </div>
              ))}

              {!filteredTracks.length && (
                <div className="empty">No tracks yet.</div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Parade Sequence</h2>
              <span className="hint">Drag rows to reorder</span>
            </div>

            <div className="sequence-list">
              {sequence.map((item, index) => {
                const track = tracks.find((x) => x.id === item.track_id);
                if (!track) return null;

                return (
                  <div
                    key={item.id}
                    className="sequence-row"
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) void reorder(dragIndex, index);
                      setDragIndex(null);
                    }}
                  >
                    <span className="drag">☰</span>
                    <span className="num">
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <div className="seq-title">
                      <strong>{musicFileName(track)}</strong>
                      <small>{track.category}</small>
                    </div>

                    <select
                      className={`action-select ${item.action.toLowerCase()}`}
                      value={item.action}
                      onChange={(e) =>
                        changeAction(item, e.target.value as TrackAction)
                      }
                    >
                      {allowedActions(track).map((action) => (
                        <option key={action}>{action}</option>
                      ))}
                    </select>

                    <button
                      className="delete-btn"
                      onClick={() => removeItem(index)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {!sequence.length && (
                <div className="empty">Add music from the library.</div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="manager-layout">
          <div className="manager-main">
            <div className="panel manager-playlist-panel">
              <h2>Playlist</h2>

              <div className="playlist">
                {sequence.map((item, index) => {
                  const track = tracks.find((x) => x.id === item.track_id);
                  if (!track) return null;

                  return (
                    <button
                      key={item.id}
                      className={`playlist-row ${
                        selectedIndex === index ? "selected" : ""
                      }`}
                      onClick={() => setSelectedIndex(index)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}.</span>
                      <span className="grow">{musicFileName(track)}</span>
                      <span
                        className={`action-tag ${item.action.toLowerCase()}`}
                      >
                        [{item.action}]
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          <aside className="manager-controls">
            <div className="panel interlude-panel">
            <h2>Interlude Music</h2>

            <p className="hint center">
              Uses the main Play / Stop controls. Play loops continuously; Stop fades out over 5 seconds. Fade lowers Interlude to 10%.
            </p>

            <div className="interlude-name">
              {isInterludeTrack(selectedTrack)
                ? musicFileName(selectedTrack)
                : "Select an Interlude track from the playlist"}
            </div>

            <label className="default-box">
              <strong>Default %</strong>
              <input
                type="number"
                min={0}
                max={100}
                value={interludeDefault}
                onChange={(e) =>
                  setInterludeDefault(
                    Math.max(0, Math.min(100, Number(e.target.value)))
                  )
                }
              />
            </label>

            <h3>Interlude Volume</h3>

            <div className="scale">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>

            <input
              className="volume-slider"
              type="range"
              min="0"
              max="100"
              value={interludeLive}
              onChange={(e) => setInterludeLive(Number(e.target.value))}
            />

            <div className="live-value">{interludeLive}%</div>
            </div>
            <div className="action-grid">
              <div className="panel">
                <h2>Actions</h2>
                <div className="stack">
                  <button
                    className="big-btn primary"
                    onClick={() => requestMusicalEnding("next")}
                  >
                    Next Song
                  </button>

                  <button
                    className="big-btn primary"
                    onClick={() => requestMusicalEnding("end")}
                  >
                    End Song
                  </button>

                  <button
                    className="big-btn primary"
                    onClick={() => void fadeSelected()}
                  >
                    Fade
                  </button>

                  {selectedTrack && isInterludeTrack(selectedTrack) && (
                    <button
                      className="big-btn interlude-restore-btn"
                      onClick={() => void restoreInterludeDefault()}
                    >
                      Restore Interlude to {interludeDefault}%
                    </button>
                  )}

                  {endingQueued && (
                    <button className="big-btn" onClick={cancelEnding}>
                      Cancel Ending
                    </button>
                  )}
                </div>
              </div>

              <div className="panel">
                <h2>Drum Cues</h2>
                <div className="stack">
                  <button
                    className="big-btn"
                    onClick={() => scheduleManualCue("single")}
                  >
                    Single Beat
                  </button>
                  <button
                    className="big-btn"
                    onClick={() => scheduleManualCue("double")}
                  >
                    Double Beat
                  </button>
                  <button
                    className="big-btn"
                    onClick={() => scheduleManualCue("doubleDouble")}
                  >
                    2x Double Beat
                  </button>

                </div>
              </div>
            </div>

            <div className="panel now-playing">
              <h2>Now Playing</h2>
              <div className="counter">
                {selectedIndex !== null
                  ? `${selectedIndex + 1} / ${sequence.length}`
                  : `0 / ${sequence.length}`}
              </div>

              <div className="current-title">
                {selectedTrack
                  ? musicFileName(selectedTrack)
                  : (sequence.length ? "Ready" : "No Parade Music Loaded")}
              </div>

              <div className="status">
                {status ||
                  (selected
                    ? `Sequence action: ${selected.action.toUpperCase()}`
                    : "")}
              </div>

              <div className="next-track">
                {nextTrack
                  ? `Next: ${musicFileName(nextTrack)}`
                  : "Next: End of parade"}
              </div>

              <div className="sync-status">{syncStatus}</div>
            </div>

            <div className="transport">
              <button
                onClick={() =>
                  selectedIndex !== null &&
                  setSelectedIndex(Math.max(0, selectedIndex - 1))
                }
              >
                ⏮ Previous
              </button>
              <button className="play" onClick={playSelected}>
                ▶ Play
              </button>
              <button onClick={() => void stopSelected()}>
                ■ Stop
              </button>
              <button
                onClick={() =>
                  selectedIndex !== null &&
                  setSelectedIndex(
                    Math.min(sequence.length - 1, selectedIndex + 1)
                  )
                }
              >
                ⏭ Immediate Skip
              </button>
            </div>

            <div className="volume-grid">
              <label>
                <span>Music Volume</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(Number(e.target.value))}
                />
                <strong>{musicVolume}%</strong>
              </label>

              <label>
                <span>Cue Volume</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={cueVolume}
                  onChange={(e) => setCueVolume(Number(e.target.value))}
                />
                <strong>{cueVolume}%</strong>
              </label>
            </div>
          </aside>
        </section>
      )}

      {adminOpen && accessUser.role === "admin" && (
        <div className="modal-backdrop" onMouseDown={() => setAdminOpen(false)}>
          <section
            className="admin-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <h2>Admin Panel</h2>
                <div className="hint">Manage Parade Suite passcodes</div>
              </div>
              <button className="button" onClick={() => setAdminOpen(false)}>
                Close
              </button>
            </div>

            <form className="admin-add-form" onSubmit={addAccessUser}>
              <input
                className="input"
                placeholder="Name"
                maxLength={80}
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
              />
              <input
                className="input"
                placeholder="4-digit passcode"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={newUserPin}
                onChange={(e) =>
                  setNewUserPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
              />
              <button
                className="button primary"
                type="submit"
                disabled={!newUserName.trim() || newUserPin.length !== 4}
              >
                + Add User
              </button>
            </form>

            {adminMessage && (
              <div className="admin-message">{adminMessage}</div>
            )}

            <div className="admin-user-list">
              {adminUsers.map((user) => (
                <div className="admin-user-row" key={user.id}>
                  <div className="admin-user-info">
                    <strong>{user.name}</strong>
                    <small>
                      {user.role === "admin" ? "Admin" : "User"}
                      {" • "}
                      {user.active ? "Active" : "Disabled"}
                      {user.last_login
                        ? ` • Last login ${new Date(user.last_login).toLocaleString()}`
                        : ""}
                    </small>
                  </div>

                  <div className="admin-user-actions">
                    <button
                      className="button"
                      onClick={() => void renameAccessUser(user)}
                    >
                      Rename
                    </button>
                    <button
                      className="button"
                      onClick={() => void resetUserPin(user)}
                    >
                      Reset PIN
                    </button>

                    {user.id !== accessUser.id && (
                      <>
                        <button
                          className="button"
                          onClick={() =>
                            void updateAccessUser(user.id, {
                              active: !user.active,
                            })
                          }
                        >
                          {user.active ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="button danger"
                          onClick={() => void deleteAccessUser(user)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {!adminUsers.length && (
                <div className="empty">No users yet.</div>
              )}
            </div>
          </section>
        </div>
      )}

    </main>
  );
}

function guessCategory(fileName: string): string {
  const text = fileName.toLowerCase();
  if (text.includes("fanfare")) return "Fanfares";
  if (
    text.includes("bugle") ||
    text.includes("advance call") ||
    text.includes("last post") ||
    text.includes("rouse")
  ) return "Bugle Calls";
  if (
    text.includes("salute") ||
    text.includes("anthem") ||
    text.includes("majulah")
  ) return "Salutes";
  if (text.includes("interlude")) return "Interlude Music";
  if (text.includes("slow march")) return "Slow March";
  if (text.includes("march")) return "Fast March";
  return "Others";
}
