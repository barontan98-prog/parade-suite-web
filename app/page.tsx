"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTrack,
  deleteTrack,
  listTracks,
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
  legacyRepeatStartFromBeatMap,
  pairUploadedLIBToTrack,
  parseLegacyLIB,
  storeImportedLIB,
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

function normalizeLIBCategory(value?: string | null): string | undefined {
  const raw = (value || "").trim();
  if (!raw) return undefined;
  if (raw.toLowerCase() === "interlude") return "Interlude Music";
  return CATEGORIES.includes(raw) ? raw : undefined;
}

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

  const normalizedTitle = track.title.trim().toLowerCase();

  if (
    ["Salutes", "Bugle Calls", "Fanfares"].includes(track.category) ||
    normalizedTitle === "dressing roll" ||
    normalizedTitle.startsWith("dressing roll -")
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

function displayMusicName(track: Track | null | undefined) {
  const filename = musicFileName(track);
  return filename.replace(/\.(wav|mp3|mp4|m4a|aac|flac|ogg)$/i, "");
}

function formatTimeMs(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
  const libFileInput = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<"editor" | "manager">("editor");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [guidebookOpen, setGuidebookOpen] = useState(false);
  const [guidebookTab, setGuidebookTab] = useState<"toolbar" | "editor" | "manager" | "interlude">("toolbar");
  const [guideTopic, setGuideTopic] = useState<{ title: string; functionText: string; whenText: string; notes: string } | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [mainPositionMs, setMainPositionMs] = useState(0);
  const [mainDurationMs, setMainDurationMs] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState("Beat Sync: waiting for track");

  const [interludeDefault, setInterludeDefault] = useState(60);
  const [interludeFadeTarget, setInterludeFadeTarget] = useState(10);
  const [interludeLive, setInterludeLive] = useState(60);
  const [musicVolume, setMusicVolume] = useState(80);
  const [cueVolume, setCueVolume] = useState(100);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const touchDragIndex = useRef<number | null>(null);
  const [endingQueued, setEndingQueued] = useState(false);
  const [endingAction, setEndingAction] = useState<"end" | "next" | null>(null);
  const [activeButtons, setActiveButtons] = useState<Set<string>>(
    () => new Set()
  );

  function setButtonActive(name: string, active: boolean) {
    setActiveButtons((current) => {
      const next = new Set(current);
      if (active) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function buttonClass(base: string, name: string) {
    return `${base}${activeButtons.has(name) ? " action-active" : ""}`;
  }

  const [authChecked, setAuthChecked] = useState(false);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);

  // Parade Sequences are private per logged-in user.
  // Music Library / audio / LIB timing maps remain shared.
  function userSequenceStorageKey(userId: string) {
    return `parade-suite-sequence:${userId}`;
  }

  function readUserSequence(userId: string): SequenceItem[] {
    try {
      const raw = window.localStorage.getItem(userSequenceStorageKey(userId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.track_id === "string" &&
            ["Repeat", "End", "Interlude"].includes(item.action) &&
            Number.isFinite(Number(item.position))
        )
        .map((item) => ({
          id: item.id,
          track_id: item.track_id,
          action: item.action as TrackAction,
          position: Number(item.position),
        }))
        .sort((a, b) => a.position - b.position);
    } catch {
      return [];
    }
  }

  function writeUserSequence(userId: string, items: SequenceItem[]) {
    const normalized = [...items]
      .sort((a, b) => a.position - b.position)
      .map((item, index) => ({ ...item, position: index }));
    window.localStorage.setItem(
      userSequenceStorageKey(userId),
      JSON.stringify(normalized)
    );
    return normalized;
  }

  async function saveUserSequenceItem(item: SequenceItem) {
    if (!accessUser) return item;

    const current = readUserSequence(accessUser.id);
    const index = current.findIndex((x) => x.id === item.id);

    if (index >= 0) current[index] = item;
    else current.push(item);

    writeUserSequence(accessUser.id, current);
    return item;
  }

  async function deleteUserSequenceItem(itemId: string) {
    if (!accessUser) return;

    const next = readUserSequence(accessUser.id).filter(
      (item) => item.id !== itemId
    );
    writeUserSequence(accessUser.id, next);
  }

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

    let cancelled = false;

    // Load the Music Library independently and display it as soon as Supabase
    // returns it. Do not make the operator wait for LIB/GitHub processing.
    void listTracks()
      .then((t) => {
        if (cancelled) return;

        setTracks(t);

        // Timing maps, green ticks and LIB-derived categories are refreshed in
        // the background after the visible library is already usable.
        void refreshTracksFromBuiltInLIBs(t).then((refreshed) => {
          if (!cancelled) setTracks(refreshed);
        });
      })
      .catch((error) => {
        console.error("Unable to load Music Library", error);
      });

    // Each logged-in user gets an independent Parade Sequence.
    // This is deliberately not loaded from the shared Supabase sequence table.
    try {
      const s = readUserSequence(accessUser.id);
      if (!cancelled) {
        setSequence(s);
        setSelectedIndex(s.length ? 0 : null);
        if (s.length) {
          setStatus(`PRIVATE PARADE SEQUENCE • ${s.length} track${s.length === 1 ? "" : "s"}`);
        }
      }
    } catch (error) {
      console.error("Unable to load private Parade Sequence", error);
    }

    return () => {
      cancelled = true;
    };
  }, [accessUser?.id]);

  useEffect(() => {
    audio.current?.setInterludeVolume(interludeLive / 100);
  }, [interludeLive]);

  useEffect(() => {
    audio.current?.setMusicVolume(musicVolume / 100);
  }, [musicVolume]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMainPositionMs(audio.current?.getMainPositionMs() ?? 0);
      setMainDurationMs(audio.current?.getMainDurationMs() ?? 0);
    }, 150);
    return () => window.clearInterval(timer);
  }, []);


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
    audio.current?.stopInterludeImmediately(interludeDefault / 100);
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
    // Keep background LIB synchronisation from creating a long serial queue.
    // Four workers is fast enough for a large library without flooding the
    // private GitHub/Vercel API routes.
    const refreshed = [...inputTracks];
    const workerCount = Math.min(4, Math.max(1, inputTracks.length));
    let nextIndex = 0;

    async function refreshOne(track: Track): Promise<Track> {
      const sourceName = track.source_name || `${track.title}.wav`;
      const windowsMap = await loadWindowsTimingMap(sourceName);
      const builtIn = windowsMap?.parsed;

      const libCategory = normalizeLIBCategory(builtIn?.category);
      const desired = {
        has_lib: Boolean(windowsMap),
        has_timing_map: Boolean(builtIn?.beatMap?.length),
        timing_map: builtIn?.beatMap ?? [],
        repeat_start_ms: builtIn?.repeatStartMs ?? null,
        repeat_end_ms: builtIn?.repeatEndMs ?? null,
        repeat_mode: builtIn?.repeatMode ?? null,
        lib_name: windowsMap?.libName ?? null,
        ...(libCategory ? { category: libCategory } : {}),
      };

      const changed =
        Boolean(track.has_lib) !== desired.has_lib ||
        Boolean(track.has_timing_map) !== desired.has_timing_map ||
        JSON.stringify(track.timing_map ?? []) !==
          JSON.stringify(desired.timing_map) ||
        (track.repeat_start_ms ?? null) !== desired.repeat_start_ms ||
        (track.repeat_end_ms ?? null) !== desired.repeat_end_ms ||
        (track.repeat_mode ?? null) !== desired.repeat_mode ||
        (track.lib_name ?? null) !== desired.lib_name ||
        (desired.category !== undefined && track.category !== desired.category);

      if (!changed) return { ...track, ...desired };

      try {
        return await updateTrackTiming(track.id, desired);
      } catch (error) {
        console.error("Background LIB sync failed", error);
        return { ...track, ...desired };
      }
    }

    async function worker() {
      while (true) {
        const index = nextIndex++;
        if (index >= inputTracks.length) return;
        refreshed[index] = await refreshOne(inputTracks[index]);
      }
    }

    await Promise.all(
      Array.from({ length: workerCount }, () => worker())
    );

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
      await Promise.all(sequence.map((item) => deleteUserSequenceItem(item.id)));

      const saved: SequenceItem[] = [];
      for (const item of resolved) {
        saved.push(await saveUserSequenceItem(item));
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
    return tracks
      .filter((track) => {
        const textOk =
          !search ||
          displayMusicName(track).toLowerCase().includes(search.toLowerCase());
        const categoryOk =
          category === "All Categories" || track.category === category;
        return textOk && categoryOk;
      })
      .sort((a, b) =>
        displayMusicName(a).localeCompare(displayMusicName(b), undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );
  }, [tracks, search, category]);

  const selected =
    selectedIndex === null ? null : sequence[selectedIndex] ?? null;

  const selectedTrack = selected
    ? tracks.find((track) => track.id === selected.track_id) ?? null
    : null;

  const fadeEndsAndAdvances =
    selectedTrack !== null &&
    ["Fanfares", "Inspection Tunes"].includes(selectedTrack.category);

  const nextItem =
    selectedIndex !== null && selectedIndex + 1 < sequence.length
      ? sequence[selectedIndex + 1]
      : null;

  const nextTrack = nextItem
    ? tracks.find((track) => track.id === nextItem.track_id) ?? null
    : null;

  // Keep Now Playing clean: show only the sequence action itself.
  const currentActionLabel = selected ? selected.action : "";
  const currentActionClass =
    currentActionLabel === "Repeat"
      ? "action-repeat"
      : currentActionLabel === "End"
        ? "action-end"
        : currentActionLabel === "Interlude"
          ? "action-interlude"
          : "";

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
            normalizeLIBCategory(builtIn?.category) ||
            windowsMeta.category ||
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


  async function newParade() {
    for (const item of sequence) {
      await deleteUserSequenceItem(item.id);
    }
    setSequence([]);
    setSelectedIndex(null);
    setStatus("NEW PARADE");
  }

  async function clearParadeSequence() {
    for (const item of sequence) {
      await deleteUserSequenceItem(item.id);
    }
    setSequence([]);
    setSelectedIndex(null);
    setStatus("PARADE SEQUENCE CLEARED");
  }

  function selectedLibraryTrack() {
    return tracks.find((track) => track.id === selectedLibraryId) ?? null;
  }

  async function previewSelectedLibraryTrack() {
    const track = selectedLibraryTrack();
    if (!track) {
      setStatus("SELECT A MUSIC TRACK TO PREVIEW");
      return;
    }
    await previewMusic(track);
  }

  async function addSelectedLibraryTrack() {
    const track = selectedLibraryTrack();
    if (!track) {
      setStatus("SELECT A MUSIC TRACK TO ADD");
      return;
    }
    await addTrackToSequence(track);
  }

  async function deleteSelectedLibraryTrack() {
    const track = selectedLibraryTrack();
    if (!track) {
      setStatus("SELECT A MUSIC TRACK TO DELETE");
      return;
    }

    if (
      !window.confirm(
        `Delete ${musicFileName(track)} and remove it from Parade Suite?`
      )
    ) return;

    const attached = sequence.filter((item) => item.track_id === track.id);
    for (const item of attached) {
      await deleteUserSequenceItem(item.id);
    }

    await deleteTrack(track.id, track.file_url);

    setSequence((current) =>
      current
        .filter((item) => item.track_id !== track.id)
        .map((item, index) => ({ ...item, position: index }))
    );
    setTracks((current) => current.filter((item) => item.id !== track.id));
    setSelectedLibraryId(null);
    setStatus(`DELETED • ${displayMusicName(track)}`);
  }

  async function importLIBFiles(fileList: FileList | null) {
    if (!fileList?.length) return;

    let imported = 0;
    let matched = 0;
    let unmatched = 0;
    const updatedTracks = [...tracks];

    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith(".lib")) continue;

      const text = await file.text();
      const parsed = parseLegacyLIB(text);
      const match = pairUploadedLIBToTrack(updatedTracks, file.name, parsed);

      // Browser/Vercel cannot modify the deployed source folder at runtime.
      // Store the imported map in Parade Suite's persistent browser legacy-map
      // store; loadWindowsTimingMap checks this before the bundled folder.
      storeImportedLIB(
        match ? `${displayMusicName(match)}.lib` : file.name,
        text,
        parsed
      );

      if (match) {
        // Imported LIB metadata should update the matched music-library row as
        // well as its timing map.  Previously the browser import only persisted
        // timing fields, so changing a LIB category (for example to
        // "Interlude Music") did not update the Music Library UI.
        const importedCategory = normalizeLIBCategory(parsed.category);

        const patch = {
          has_lib: true,
          has_timing_map: parsed.beatMap.length > 0,
          timing_map: parsed.beatMap,
          repeat_start_ms:
            parsed.repeatStartMs ??
            legacyRepeatStartFromBeatMap(parsed.beatMap),
          repeat_end_ms: parsed.repeatEndMs ?? null,
          repeat_mode: parsed.repeatMode ?? null,
          lib_name: `${displayMusicName(match)}.lib`,
          ...(importedCategory ? { category: importedCategory } : {}),
        };

        try {
          const updated = await updateTrackTiming(match.id, patch);
          const index = updatedTracks.findIndex((x) => x.id === match.id);
          if (index >= 0) updatedTracks[index] = updated;
        } catch {
          const index = updatedTracks.findIndex((x) => x.id === match.id);
          if (index >= 0) {
            updatedTracks[index] = { ...updatedTracks[index], ...patch };
          }
        }
        matched += 1;
      } else {
        unmatched += 1;
      }

      imported += 1;
    }

    setTracks(updatedTracks);
    setStatus(
      `IMPORTED ${imported} LIB MAP(S) • ${matched} matched • ${unmatched} stored by filename`
    );
  }

  async function removeSelectedSequenceRow() {
    if (selectedIndex === null) return;
    await removeItem(selectedIndex);
  }

  async function addTrackToSequence(track: Track) {
    const item = await saveUserSequenceItem({
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
    await saveUserSequenceItem(updated);
  }

  async function removeItem(index: number) {
    const item = sequence[index];
    await deleteUserSequenceItem(item.id);

    const next = sequence
      .filter((_, i) => i !== index)
      .map((x, i) => ({ ...x, position: i }));

    setSequence(next);
    for (const x of next) await saveUserSequenceItem(x);

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

    for (const item of normalized) await saveUserSequenceItem(item);
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
    setEndingAction(null);
    audio.current?.setRepeatSuppressed(false);

    const sourceName = track.source_name || `${track.title}.wav`;
    const isKnights =
      normalizeTrackName(sourceName) ===
      normalizeTrackName("Knights of St John.wav");

    // Fast playback path:
    // Background startup sync already stores the resolved LIB beat map on the
    // track. Use that immediately instead of making Play wait for a private
    // GitHub/Vercel request. Only fetch a LIB here when timing metadata is
    // genuinely missing.
    const storedBeatMap = track.timing_map ?? [];
    const needsRuntimeLIB = !isKnights && storedBeatMap.length === 0;

    const runtimeLIB = needsRuntimeLIB
      ? await loadWindowsTimingMap(sourceName)
      : null;

    const runtimeBeatMap =
      storedBeatMap.length
        ? storedBeatMap
        : runtimeLIB?.parsed.beatMap?.length
          ? runtimeLIB.parsed.beatMap
          : [];

    const runtimeRepeatStart = isKnights
      ? repeatStartMsForTrack(track)
      : legacyRepeatStartFromBeatMap(runtimeBeatMap);

    const runtimeRepeatEnd = isKnights
      ? track.repeat_end_ms
      : runtimeLIB?.parsed.repeatEndMs ?? track.repeat_end_ms ?? null;

    const runtimeRepeatMode = isKnights
      ? track.repeat_mode
      : runtimeLIB?.parsed.repeatMode ?? track.repeat_mode ?? null;

    await audio.current?.playMain(track.file_url, {
      action: item.action,
      repeatStartMs: runtimeRepeatStart,
      repeatEndMs: runtimeRepeatEnd,
      repeatMode: runtimeRepeatMode,
      beatMap: runtimeBeatMap,
      onNaturalEnd: () => handleNaturalEnd(index),
    });

    setStatus(`Sequence action: ${item.action.toUpperCase()}`);

    if (runtimeBeatMap.length) {
      setSyncStatus(
        `Beat Sync: ACTIVE • ${
          isKnights
            ? (track.lib_name || "Knights custom timing")
            : (runtimeLIB?.libName || "legacy timing map")
        } • ${runtimeBeatMap.length} timing markers • repeat from ${(runtimeRepeatStart / 1000).toFixed(2)}s`
      );
    } else {
      setSyncStatus("Beat Sync: no matching .lib found");
    }
  }

  async function playSelected() {

    try {
      if (selectedTrack && isInterludeTrack(selectedTrack)) {
        await playInterlude();
        return;
      }

      if (selectedIndex === null) {
          return;
      }

      // Do not make the operator wait for cue WAVs to decode before the
      // parade music starts. Cue preparation can finish in parallel.
      void audio.current?.prepareCueAudio();
      await playIndex(selectedIndex);
    } catch (error) {
      throw error;
    }
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

    const buttonName =
      kind === "single"
        ? "singleCue"
        : kind === "double"
          ? "doubleCue"
          : "doubleDoubleCue";
    setButtonActive(buttonName, true);

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
      setButtonActive(buttonName, false);
      return;
    }

    const beatMap = selectedTrack?.timing_map ?? [];
    const position = engine.getMainPositionMs();

    // Exact Windows fallback when there is no timing map:
    // play one cue immediately.
    if (!beatMap.length) {
      await engine.playCueFile(filename, 950, 0.30);
      setSyncStatus("Beat Sync: no timing map — cue played immediately");
      setButtonActive(buttonName, false);
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
      setButtonActive(buttonName, false);
      return;
    }

    const delay = Math.max(0, target - position - 45);

    // IMPORTANT iOS fix:
    // schedule the AudioBufferSourceNode NOW on the WebAudio clock.
    // Do not wait until the cue time and then call play().
    const firstScheduled = engine.isPhoneBrowser()
      ? await engine.scheduleCueFileAtMainPosition(
          filename,
          target - 45,
          950,
          0.30
        )
      : await engine.scheduleCueFile(
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

      const secondScheduled = engine.isPhoneBrowser()
        ? await engine.scheduleCueFileAtMainPosition(
            filename,
            target - 45 + (2 * fullInterval),
            950,
            0.30
          )
        : await engine.scheduleCueFile(
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

    const rowForLight = beatContextForPosition(beatMap, target);
    const fullIntervalForLight = rowForLight?.full_ms ?? 500;
    const lastCueDelay =
      kind === "doubleDouble"
        ? delay + (2 * fullIntervalForLight)
        : delay;

    window.setTimeout(
      () => setButtonActive(buttonName, false),
      Math.max(250, lastCueDelay + 1050)
    );
  }

  function requestMusicalEnding(action: "end" | "next") {
    const actionButtonName = action === "end" ? "end" : "nextSong";
    setEndingAction(action);
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
      void stopInterlude("end");
      return;
    }

    void engine?.prepareCueAudio();

    if (
      !engine ||
      !engine.isMainPlaying() ||
      selectedIndex === null ||
      !selectedTrack
    ) {
      setEndingAction(null);
      return;
    }

    const beatMap = selectedTrack.timing_map ?? [];
    const position = engine.getMainPositionMs();

    if (!beatMap.length) {
      setStatus(
        "Beat map required • this track has no matching timing map, so Parade Suite cannot perform a beat-synchronised ending."
      );
      setEndingAction(null);
      return;
    }

    // Exact Windows request_musical_ending values.
    let target = nextPhraseBoundaryMs(beatMap, position, 500);
    if (target === null) {
      target = nextQuantizedBeatMs(beatMap, position, 250);
    }
    if (target === null) {
      setEndingAction(null);
      return;
    }

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

    void (async () => {
      if (engine.isPhoneBrowser()) {
        const reached = await engine.waitForMainPosition(cueStart);
        if (!reached) return;
      } else {
        await new Promise<void>((resolve) => {
          schedule(delay, resolve);
        });
      }

      if (generation !== endingGeneration.current) return;

        // Exact Windows authoritative trigger: wait for the actual ending WAV
        // to reach EndOfMedia, then hard-stop/unload the march.
        await engine.playEndingCue(isKnights);

        if (generation !== endingGeneration.current) return;

        engine.hardStopMain();
        pendingEndingRef.current = false;
        setEndingQueued(false);
        setEndingAction(null);
  
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

    // Same Windows fallback watchdog: 12 s after cue delay.
    schedule(delay + 12000, () => {
      if (
        generation === endingGeneration.current &&
        pendingEndingRef.current
      ) {
        pendingEndingRef.current = false;
        engine.hardStopMain();
        setEndingQueued(false);
        setEndingAction(null);
        }
    });
  }

  function cancelEnding() {
    endingGeneration.current += 1;
    pendingEndingRef.current = false;
    clearScheduledTimers();
    setEndingQueued(false);
    setEndingAction(null);
    audio.current?.cancelEndingCue();
    audio.current?.setRepeatSuppressed(false);
    setStatus("Ending cancelled");
  }

  async function stopSelected() {

    if (selectedTrack && isInterludeTrack(selectedTrack)) {
      await stopInterlude("stop");
      return;
    }

    audio.current?.stopMain();
    setStatus("STOPPED");
  }

  async function fadeSelected() {
    setButtonActive("fade", true);

    if (selectedTrack && isInterludeTrack(selectedTrack)) {
      if (!audio.current?.isInterludePlaying()) {
        setStatus("INTERLUDE NOT PLAYING");
        setButtonActive("fade", false);
        return;
      }

      const targetPercent = Math.max(
        0,
        Math.min(100, interludeFadeTarget)
      );
      setStatus(`INTERLUDE FADING TO ${targetPercent}% • 5 seconds`);
      await audio.current.fadeInterludeToLevel(
        targetPercent / 100,
        5000,
        (value) => setInterludeLive(Math.round(value * 100))
      );
      setInterludeLive(targetPercent);
      setStatus(`INTERLUDE AT ${targetPercent}%`);
      setButtonActive("fade", false);
      return;
    }

    const startIndex = selectedIndex;
    const shouldAdvance =
      selectedTrack !== null &&
      ["Fanfares", "Inspection Tunes"].includes(selectedTrack.category);

    clearScheduledTimers();
    endingGeneration.current += 1;
    setEndingQueued(false);
    audio.current?.setRepeatSuppressed(true);

    setStatus(
      shouldAdvance
        ? "FADE END SONG • 5 seconds"
        : "MUSIC FADING TO 0% • 5 seconds"
    );

    await audio.current?.fadeMainToStop(5000);
    audio.current?.setRepeatSuppressed(false);

    if (
      shouldAdvance &&
      startIndex !== null &&
      startIndex + 1 < sequence.length
    ) {
      setSelectedIndex(startIndex + 1);
      setStatus("FADE END SONG COMPLETE • next track selected");
    } else {
      setStatus(
        shouldAdvance
          ? "FADE END SONG COMPLETE • end of playlist"
          : "FADED OUT • stopped"
      );
    }

    setButtonActive("fade", false);
  }

  async function restoreInterludeDefault() {
    setButtonActive("restore", true);

    if (!selectedTrack || !isInterludeTrack(selectedTrack)) {
      setStatus("SELECT AN INTERLUDE TRACK");
      setButtonActive("restore", false);
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
    setButtonActive("restore", false);
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

  async function stopInterlude(origin: "stop" | "end" = "stop") {
    const currentIndex = selectedIndex;

    if (currentIndex === null) {
      setEndingAction(null);
      setStatus("NO PLAYLIST TRACK SELECTED");
      return;
    }

    if (!audio.current?.isInterludePlaying()) {
      // End Song is no longer active once the Interlude is already stopped.
      setEndingAction(null);

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
      (value) => setInterludeLive(Math.round(value * 100)),
      interludeDefault / 100
    );

    // The End Song action is complete as soon as the 5-second fade has
    // reached 0%, the Interlude is stopped, and the track is reset to 00:00.
    // The separate 2-second muted/default-volume reset may continue in the
    // audio engine, but the button should no longer stay illuminated.
    setEndingAction(null);

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
    <main className="app-shell windows-parity">
      <header className="windows-menubar">
        <div className="windows-file-actions">
          <button onClick={() => void newParade()}>New</button>
          <button onClick={() => paradeFileInput.current?.click()}>Open</button>
          <button onClick={saveParadeSequence}>Save</button>
          <button onClick={() => setAboutOpen(true)}>About</button>
          <button onClick={() => setGuidebookOpen(true)}>Guidebook</button>
        </div>

        <div className="web-account-actions">
          <span>{accessUser.name}</span>
          {accessUser.role === "admin" && (
            <button onClick={() => void openAdmin()}>Admin</button>
          )}
          <button onClick={() => void logout()}>Log Out</button>
        </div>
      </header>

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

      <input
        ref={libFileInput}
        hidden
        multiple
        type="file"
        accept=".lib"
        onChange={(e) => {
          void importLIBFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      <nav className="windows-tabs">
        <button
          className={tab === "editor" ? "active" : ""}
          onClick={() => setTab("editor")}
        >
          Editor
        </button>
        <button
          className={tab === "manager" ? "active" : ""}
          onClick={() => setTab("manager")}
        >
          Manager
        </button>
      </nav>

      {tab === "editor" ? (
        <section className="windows-editor">
          <div className="windows-title-row">
            <h1>PARADE EDITOR</h1>
            <div className="windows-import-actions">
              <label className={`win-btn ${uploadBusy ? "disabled" : ""}`}>
                {uploadBusy ? "Uploading…" : "+ Import Music"}
                <input
                  hidden
                  multiple
                  type="file"
                  accept="audio/*,.wav,.mp3,.mp4,.m4a,.flac,.ogg"
                  disabled={uploadBusy}
                  onChange={(e) => {
                    void importMusic(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <button onClick={() => libFileInput.current?.click()}>
                + Import LIB
              </button>
            </div>
          </div>

          {(uploadBusy || uploadSuccesses.length > 0 || uploadFailures.length > 0) && (
            <div className="upload-results windows-upload-results">
              <div className="upload-results-header">
                <strong>Upload Results</strong>
                <span className="hint">
                  {uploadOverall.done} / {uploadOverall.total || uploadSuccesses.length + uploadFailures.length}
                </span>
              </div>
              {uploadBusy && uploadCurrent && (
                <>
                  <div className="upload-current">{uploadCurrent}</div>
                  <div className="upload-progress-track">
                    <div
                      className="upload-progress-fill"
                      style={{ width: `${uploadFilePercent}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="windows-editor-main">
            <section className="windows-library-pane">
              <label>Music Library</label>
              <input
                className="windows-input"
                placeholder="Search music track..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="windows-input windows-category-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option>All Categories</option>
                {CATEGORIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>

              <div className="windows-library-list">
                {filteredTracks.map((track) => (
                  <button
                    type="button"
                    key={track.id}
                    className={`windows-library-item ${
                      selectedLibraryId === track.id ? "selected" : ""
                    }`}
                    onClick={() => setSelectedLibraryId(track.id)}
                    onDoubleClick={() => void previewMusic(track)}
                  >
                    <span className="timing-icon">
                      {(track.has_lib || track.has_timing_map) ? "✅" : "❌"}
                    </span>
                    <span className="windows-library-copy">
                      <strong>{displayMusicName(track)}</strong>
                      <small>{track.category}</small>
                    </span>
                  </button>
                ))}
              </div>

              <div className="windows-library-buttons">
                {accessUser.role === "admin" && (
                  <button onClick={() => void deleteSelectedLibraryTrack()}>
                    Delete
                  </button>
                )}
                <button onClick={() => void addSelectedLibraryTrack()}>
                  Add to Parade →
                </button>
              </div>
            </section>

            <section className="windows-sequence-pane">
              <label>Parade Sequence</label>
              <div className="windows-sequence-table">
                <div className="windows-sequence-header">
                  <span>#</span>
                  <span>Track</span>
                  <span>Action</span>
                  <span>Category</span>
                </div>

                <div className="windows-sequence-body">
                  {sequence.map((item, index) => {
                    const track = tracks.find((x) => x.id === item.track_id);
                    if (!track) return null;

                    return (
                      <div
                        key={item.id}
                        data-sequence-index={index}
                        className={`windows-sequence-row ${
                          selectedIndex === index ? "selected" : ""
                        }`}
                        draggable
                        onClick={() => setSelectedIndex(index)}
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragIndex !== null) void reorder(dragIndex, index);
                          setDragIndex(null);
                        }}
                      >
                        <div
                          className="sequence-track-line"
                          style={{
                            gridColumn: "1 / span 2",
                            display: "flex",
                            alignItems: "center",
                            minWidth: 0,
                            width: "100%",
                            gap: "12px",
                          }}
                        >
                          <span
                            className="sequence-drag-handle"
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                            onTouchStart={(e) => {
                              touchDragIndex.current = index;
                              setSelectedIndex(index);
                              if (e.cancelable) e.preventDefault();
                            }}
                            onTouchMove={(e) => {
                              if (touchDragIndex.current !== null && e.cancelable) {
                                e.preventDefault();
                              }
                            }}
                            onTouchEnd={(e) => {
                              const from = touchDragIndex.current;
                              touchDragIndex.current = null;
                              if (from === null) return;

                              const touch = e.changedTouches[0];
                              if (!touch) return;
                              const target = document
                                .elementFromPoint(touch.clientX, touch.clientY)
                                ?.closest<HTMLElement>("[data-sequence-index]");
                              const to = Number(target?.dataset.sequenceIndex);
                              if (Number.isInteger(to) && to >= 0 && to < sequence.length) {
                                void reorder(from, to);
                              }
                            }}
                            style={{
                              touchAction: "none",
                              userSelect: "none",
                              display: "inline-flex",
                              alignItems: "center",
                              flex: "0 0 auto",
                              gap: "10px",
                              cursor: "grab",
                              height: "24px",
                              lineHeight: 1,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "20px",
                                fontWeight: 700,
                                lineHeight: 1,
                                height: "24px",
                              }}
                            >
                              ≡
                            </span>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                height: "24px",
                                lineHeight: 1,
                              }}
                            >
                              {index + 1}
                            </span>
                          </span>

                          <strong
                            className="sequence-track-title"
                            style={{
                              display: "block",
                              minWidth: 0,
                              flex: "1 1 auto",
                              lineHeight: 1.25,
                              margin: 0,
                            }}
                          >
                            {displayMusicName(track)}
                          </strong>
                        </div>
                        <select
                          className={`windows-action-select action-${item.action.toLowerCase()}`}
                          value={item.action}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            changeAction(item, e.target.value as TrackAction)
                          }
                        >
                          {allowedActions(track).map((action) => (
                            <option key={action}>{action}</option>
                          ))}
                        </select>
                        <span>{track.category}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="windows-sequence-controls">
                <button onClick={() => void removeSelectedSequenceRow()}>
                  Remove
                </button>
                <span>Drag and drop rows to reorder the Parade Sequence</span>
                <span className="spacer" />
                <button onClick={() => void clearParadeSequence()}>
                  Clear
                </button>
              </div>
            </section>
          </div>

          <fieldset className="windows-preview">
            <legend>Preview</legend>
            <button onClick={() => void previewSelectedLibraryTrack()}>
              ▶ Preview
            </button>
            <button
              onClick={() => {
                audio.current?.stopPreview();
                setPreviewTrackId(null);
              }}
            >
              ■ Stop
            </button>
            <input
              type="range"
              min="0"
              max="1000"
              value={previewTrackId ? 1 : 0}
              readOnly
            />
            <span>
              {previewTrackId
                ? displayMusicName(tracks.find((t) => t.id === previewTrackId))
                : ""}
            </span>
          </fieldset>
        </section>
      ) : (
        <section className="windows-manager">
          <div className="windows-manager-title">PARADE MANAGER</div>

          <div className="windows-manager-body">
            <div className="windows-manager-left">
              <div className="windows-manager-top">
                <fieldset className="windows-playlist-box">
                  <legend>Playlist</legend>
                  <div className="windows-playlist">
                    {sequence.map((item, index) => {
                      const track = tracks.find((x) => x.id === item.track_id);
                      if (!track) return null;
                      return (
                        <button
                          key={item.id}
                          className={selectedIndex === index ? "selected" : ""}
                          onClick={() => setSelectedIndex(index)}
                        >
                          <span>{String(index + 1).padStart(2, "0")}.</span>
                          <span>{displayMusicName(track)}</span>
                          <span
                            className={`playlist-action-text action-${item.action.toLowerCase()}`}
                          >
                            [{item.action}]
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="windows-actions-box">
                  <legend>Actions</legend>
                  <button
                    className={endingAction === "next" ? "action-active" : ""}
                    onClick={() => requestMusicalEnding("next")}
                  >
                    Next Song
                  </button>
                  <button
                    className={endingAction === "end" ? "action-active" : ""}
                    onClick={() => requestMusicalEnding("end")}
                  >
                    End Song
                  </button>
                  <button
                    className={activeButtons.has("fade") ? "action-active" : ""}
                    onClick={() => void fadeSelected()}
                  >
                    {fadeEndsAndAdvances ? "Fade End Song" : "Fade"}
                  </button>
                  {selectedTrack && isInterludeTrack(selectedTrack) && (
                    <button
                      className={`restore-button ${
                        activeButtons.has("restore") ? "action-active" : ""
                      }`}
                      onClick={() => void restoreInterludeDefault()}
                    >
                      Restore Interlude
                    </button>
                  )}
                </fieldset>

                <fieldset className="windows-cues-box">
                  <legend>Drum Cues</legend>
                  <button
                    className={activeButtons.has("singleCue") ? "action-active" : ""}
                    onClick={() => scheduleManualCue("single")}
                  >
                    Single Beat
                  </button>
                  <button
                    className={activeButtons.has("doubleCue") ? "action-active" : ""}
                    onClick={() => scheduleManualCue("double")}
                  >
                    Double Beat
                  </button>
                  <button
                    className={activeButtons.has("doubleDoubleCue") ? "action-active" : ""}
                    onClick={() => scheduleManualCue("doubleDouble")}
                  >
                    2x Double Beat
                  </button>
                  <div className="windows-sync">
                    {syncStatus}
                  </div>
                </fieldset>
              </div>

              <fieldset className="windows-now-playing">
                <legend>Now Playing</legend>
                <div className="counter">
                  {selectedIndex !== null
                    ? `${selectedIndex + 1} / ${sequence.length}`
                    : `0 / ${sequence.length}`}
                </div>
                <div className="windows-current-title">
                  {selectedTrack
                    ? displayMusicName(selectedTrack)
                    : "No Parade Music Loaded"}
                </div>
                <div className={`windows-current-action ${currentActionClass}`}>
                  {currentActionLabel}
                </div>
                <div className="windows-next-track">
                  {nextTrack
                    ? `Next: ${displayMusicName(nextTrack)}`
                    : "Next: —"}
                </div>
              </fieldset>
            </div>

            <div className="windows-mobile-main-controls">
              <div className="windows-manager-progress">
                <span>{formatTimeMs(mainPositionMs)}</span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(1, mainDurationMs)}
                  value={Math.min(mainPositionMs, Math.max(1, mainDurationMs))}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    audio.current?.seekMain(value);
                    setMainPositionMs(value);
                  }}
                />
                <span>{formatTimeMs(mainDurationMs)}</span>
              </div>

              <div className="windows-transport">
                <button onClick={playSelected}>▶ Play</button>
                <button onClick={() => void stopSelected()}>■ Stop</button>
              </div>

              <div className="windows-volume-row">
                <label>
                  <span>Music Volume</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={musicVolume}
                    onChange={(e) => setMusicVolume(Number(e.target.value))}
                  />
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
                </label>
              </div>
            </div>

            <aside className="windows-interlude-column">
              <fieldset>
                <legend>Interlude Music</legend>
                <div className="interlude-playing-text">
                  {isInterludeTrack(selectedTrack)
                    ? displayMusicName(selectedTrack)
                    : "No Interlude Selected"}
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
                <label className="default-box">
                  <strong>Fade %</strong>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={interludeFadeTarget}
                    onChange={(e) =>
                      setInterludeFadeTarget(
                        Math.max(0, Math.min(100, Number(e.target.value)))
                      )
                    }
                  />
                </label>
                <h3>Interlude Volume</h3>
                <div className="scale">
                  <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
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
              </fieldset>
            </aside>
          </div>

          <div className="windows-manager-progress">
            <span>{formatTimeMs(mainPositionMs)}</span>
            <input
              type="range"
              min="0"
              max={Math.max(1, mainDurationMs)}
              value={Math.min(mainPositionMs, Math.max(1, mainDurationMs))}
              onChange={(e) => {
                const value = Number(e.target.value);
                audio.current?.seekMain(value);
                setMainPositionMs(value);
              }}
            />
            <span>{formatTimeMs(mainDurationMs)}</span>
          </div>

          <div className="windows-transport">
            <button onClick={playSelected}>▶ Play</button>
            <button onClick={() => void stopSelected()}>■ Stop</button>
          </div>

          <div className="windows-volume-row">
            <label>
              <span>Music Volume</span>
              <input
                type="range"
                min="0"
                max="100"
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
              />
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
            </label>
          </div>
        </section>
      )}


      {guidebookOpen && (
        <div className="modal-backdrop" onMouseDown={() => setGuidebookOpen(false)}>
          <section
            className="admin-modal guidebook-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="panel-header guidebook-header">
              <div>
                <h2>Parade Suite Interactive Guidebook</h2>
                <div className="hint">Select a page, then click a highlighted control in the visual snapshot.</div>
              </div>
              <button className="button" onClick={() => setGuidebookOpen(false)}>Close</button>
            </div>

            <div className="guidebook-tabs">
              {([
                ["toolbar", "Toolbar"],
                ["editor", "Parade Editor"],
                ["manager", "Parade Manager"],
                ["interlude", "Interlude Music"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={guidebookTab === value ? "selected" : ""}
                  onClick={() => {
                    setGuidebookTab(value);
                    setGuideTopic(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="guidebook-layout">
              <div className="guide-snapshot-frame">
                <div className="guide-snapshot-caption">Interactive visual snapshot — click a control</div>

                {guidebookTab === "toolbar" && (
                  <div className="guide-snapshot guide-toolbar-shot">
                    <div className="guide-toolbar-row">
                      {[
                        ["New", "Starts a new Parade Sequence.", "Use when preparing a different parade programme.", "The current working sequence is cleared after confirmation."],
                        ["Open", "Opens a saved .parade.json Parade Sequence.", "Use to reload a prepared parade programme.", "The required music tracks must already exist in the Music Library."],
                        ["Save", "Saves the current Parade Sequence.", "Use after arranging tracks and actions.", "The file stores the sequence order and actions for later use."],
                        ["About", "Shows Parade Suite version, purpose and developer information.", "Use when checking application information.", "This does not change any parade settings."],
                        ["Guidebook", "Opens this interactive guidebook.", "Use whenever an operator needs help with a control.", "Choose a guide tab and click the highlighted control for details."],
                      ].map(([title, functionText, whenText, notes]) => (
                        <button key={title} className="guide-hotspot" onClick={() => setGuideTopic({ title, functionText, whenText, notes })}>{title}</button>
                      ))}
                    </div>
                    <div className="guide-toolbar-app">PARADE SUITE</div>
                    <div className="guide-toolbar-tabs">
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Editor Tab", functionText: "Opens the Parade Editor used to prepare the Music Library and Parade Sequence.", whenText: "Use before parade operations to build or edit the programme.", notes: "Changes made here feed directly into the Parade Manager sequence." })}>Editor</button>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Manager Tab", functionText: "Opens the Parade Manager used for live parade operation.", whenText: "Use during rehearsals and live parade operations.", notes: "Confirm the selected track before operating ceremonial cues." })}>Manager</button>
                    </div>
                  </div>
                )}

                {guidebookTab === "editor" && (
                  <div className="guide-snapshot guide-editor-shot">
                    <div className="guide-shot-title">PARADE EDITOR</div>
                    <div className="guide-editor-imports">
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "+ Import Music", functionText: "Adds supported audio files to the Parade Suite Music Library.", whenText: "Use when adding new parade, ceremonial or interlude tracks.", notes: "Imported music becomes available for building Parade Sequences." })}>+ Import Music</button>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "+ Import LIB", functionText: "Imports the legacy timing map for a matching track.", whenText: "Use when a track needs beat-synchronised drum cues, End Song or Next Song.", notes: "A correct timing map is essential for reliable beat-synchronised operation." })}>+ Import LIB</button>
                    </div>
                    <div className="guide-editor-grid">
                      <div className="guide-panel">
                        <strong>Music Library</strong>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Search", functionText: "Filters the visible Music Library by track name.", whenText: "Use to quickly locate a track in a large library.", notes: "Search works together with the Category filter." })}>Search music track…</button>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Category Filter", functionText: "Shows only tracks in the selected music category.", whenText: "Use to narrow the Music Library to Salutes, Fast March, Interlude Music and other categories.", notes: "Select All Categories to show the entire library." })}>All Categories ▾</button>
                        <div className="guide-list-row">✓ Knights of St John</div>
                        <div className="guide-list-row">✓ Advance in Review Order</div>
                        <div className="guide-list-row">✕ Example without LIB</div>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Timing-map Indicator", functionText: "Shows whether the selected music has a matching timing map.", whenText: "Check this before using beat-synchronised cues or endings.", notes: "A missing timing map means sync-dependent functions may not be available." })}>✓ / ✕ Timing Map</button>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Add to Parade →", functionText: "Adds the selected Music Library track to the Parade Sequence.", whenText: "Use while assembling the parade programme.", notes: "This does not remove or alter the Music Library copy." })}>Add to Parade →</button>
                      </div>

                      <div className="guide-panel">
                        <strong>Parade Sequence</strong>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Drag Handle / Row Drag", functionText: "Reorders the Parade Sequence.", whenText: "Use when changing the order of parade music.", notes: "On phone and iPad, drag using the handle beside the sequence number." })}>≡  1   Knights of St John</button>
                        <button className="guide-hotspot guide-wide green" onClick={() => setGuideTopic({ title: "Repeat", functionText: "Sets the sequence item to use the established repeat behaviour.", whenText: "Use when the march may need to continue or loop during parade movement.", notes: "Repeat is shown in green." })}>Action: Repeat</button>
                        <button className="guide-hotspot guide-wide red" onClick={() => setGuideTopic({ title: "End", functionText: "Marks the sequence item as an ending track.", whenText: "Use when the music should finish and prepare the next item without auto-playing it.", notes: "End is shown in red. Repeat remains available where allowed." })}>Action: End</button>
                        <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Remove", functionText: "Removes the selected row from the Parade Sequence only.", whenText: "Use when a track is no longer needed in the current programme.", notes: "The track remains in the Music Library." })}>Remove</button>
                        <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Clear", functionText: "Removes every row from the current Parade Sequence.", whenText: "Use when rebuilding the programme from scratch.", notes: "This does not delete Music Library tracks." })}>Clear</button>
                      </div>
                    </div>
                    <div className="guide-preview-row">
                      <strong>Preview</strong>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "▶ Preview", functionText: "Previews the selected Music Library track without running the Parade Manager sequence.", whenText: "Use to identify or check a track while building the programme.", notes: "Preview is separate from live parade playback." })}>▶ Preview</button>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "■ Stop Preview", functionText: "Stops the current Music Library preview.", whenText: "Use after checking the track.", notes: "It does not affect a live Parade Manager track." })}>■ Stop</button>
                    </div>
                  </div>
                )}

                {guidebookTab === "manager" && (
                  <div className="guide-snapshot guide-manager-shot">
                    <div className="guide-shot-title">PARADE MANAGER</div>
                    <div className="guide-manager-grid">
                      <div className="guide-panel">
                        <strong>Playlist</strong>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Playlist Selection", functionText: "Selects the sequence item that Parade Suite will prepare or operate.", whenText: "Use before pressing Play or operating a cue for a specific track.", notes: "Always confirm the highlighted row and Now Playing title." })}>01. Knights of St John [Repeat]</button>
                        <div className="guide-list-row">02. Advance in Review Order [End]</div>
                        <div className="guide-list-row">03. Corp of Drum Solo [End]</div>
                      </div>
                      <div className="guide-panel">
                        <strong>Actions</strong>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Next Song", functionText: "Performs the beat-synchronised ceremonial ending, then automatically starts the next parade track.", whenText: "Use when the programme should transition immediately to the next track.", notes: "Requires a correct timing map for the current track." })}>Next Song</button>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "End Song", functionText: "Performs the beat-synchronised ceremonial ending and then selects the next track without playing it.", whenText: "Use when the current march must end cleanly but the next item should wait for a manual Play command.", notes: "Knights of St John keeps its dedicated ending behaviour." })}>End Song</button>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Fade", functionText: "Fades the main parade music smoothly to silence and stops it.", whenText: "Use when a gradual stop is required instead of a ceremonial ending.", notes: "Fade does not add an ending drum sequence." })}>Fade</button>
                      </div>
                      <div className="guide-panel">
                        <strong>Drum Cues</strong>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Single Beat", functionText: "Plays one original single drum cue, beat-synchronised when timing data is available.", whenText: "Use for ceremonial commands requiring a single beat.", notes: "Cue audio uses the original WAV with no bass boost or EQ." })}>Single Beat</button>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Double Beat", functionText: "Plays one original double-beat cue, beat-synchronised when timing data is available.", whenText: "Use for ceremonial commands requiring a double beat.", notes: "The march is temporarily volume-ducked underneath the cue." })}>Double Beat</button>
                        <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "2× Double Beat", functionText: "Plays the established two-double-beat ceremonial pattern.", whenText: "Use where the parade command requires two consecutive double beats.", notes: "Timing follows the established Parade Suite cue behaviour." })}>2× Double Beat</button>
                      </div>
                    </div>
                    <div className="guide-now-playing">NOW PLAYING — Knights of St John<br/><span>Repeat</span><br/><small>Next: Advance in Review Order</small></div>
                    <div className="guide-transport-row">
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "▶ Play", functionText: "Starts the currently selected parade track.", whenText: "Use after confirming the correct Playlist and Now Playing selection.", notes: "For an Interlude row, the Interlude channel is prepared/used according to the current build." })}>▶ Play</button>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "■ Stop", functionText: "Stops the current main parade track immediately.", whenText: "Use when playback must be stopped without a musical ending.", notes: "This is different from End Song and Fade." })}>■ Stop</button>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Music Volume", functionText: "Controls the normal volume of the main parade-music channel.", whenText: "Set before or during operation to suit the sound system.", notes: "Drum-cue volume is controlled separately." })}>Music Volume ━━━</button>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Cue Volume", functionText: "Controls the audible level of the drum-cue WAV files.", whenText: "Adjust so ceremonial cues are clear without overpowering the system.", notes: "This does not EQ or bass-boost the drum cues." })}>Cue Volume ━━━</button>
                    </div>
                  </div>
                )}

                {guidebookTab === "interlude" && (
                  <div className="guide-snapshot guide-interlude-shot">
                    <div className="guide-shot-title">INTERLUDE MUSIC</div>
                    <div className="guide-interlude-card">
                      <div className="guide-interlude-track">Selected Interlude Music</div>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Default %", functionText: "Sets the starting volume used when the Interlude begins.", whenText: "Set this before starting Interlude playback.", notes: "The live Interlude Volume can still be adjusted during playback." })}>Default %   60</button>
                      <button className="guide-hotspot" onClick={() => setGuideTopic({ title: "Fade %", functionText: "Sets the Interlude fade target/behaviour used by the current build.", whenText: "Use when configuring how the Interlude should fade during transitions.", notes: "This setting is independent from the main parade-music Fade button." })}>Fade %   10</button>
                      <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Interlude Volume", functionText: "Controls the live volume of the independent Interlude channel.", whenText: "Adjust while the Interlude is playing to balance background/transition music.", notes: "This does not change the main parade-music volume." })}>0 ━━━━━●━━━━ 100</button>
                      <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Interlude Selection", functionText: "The Interlude is loaded from the selected Interlude row in the Parade Sequence.", whenText: "Select the correct Interlude sequence row before operating it.", notes: "The Interlude channel is independent of the main parade-music channel." })}>Loaded from Parade Sequence</button>
                      <button className="guide-hotspot guide-wide" onClick={() => setGuideTopic({ title: "Interlude Stop / Fade", functionText: "Stops the Interlude using its configured fade behaviour and prepares the next sequence item.", whenText: "Use at the end of a transition or background-music segment.", notes: "The next sequence item is prepared without being automatically started unless the current workflow specifies otherwise." })}>Stop / Fade Behaviour</button>
                    </div>
                  </div>
                )}
              </div>

              <aside className="guide-explanation-panel">
                {guideTopic ? (
                  <>
                    <div className="guide-explanation-label">Selected control</div>
                    <h3>{guideTopic.title}</h3>
                    <h4>What it does</h4>
                    <p>{guideTopic.functionText}</p>
                    <h4>When to use it</h4>
                    <p>{guideTopic.whenText}</p>
                    <h4>Important notes</h4>
                    <p>{guideTopic.notes}</p>
                  </>
                ) : (
                  <>
                    <div className="guide-explanation-label">How to use this guide</div>
                    <h3>Click a highlighted control</h3>
                    <p>The visual on the left represents the selected Parade Suite page. Click any outlined button or control to see its detailed explanation here.</p>
                    <p>Use the tabs above to move between the Toolbar, Parade Editor, Parade Manager and Interlude Music.</p>
                  </>
                )}
              </aside>
            </div>


          </section>
        </div>
      )}

      {aboutOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAboutOpen(false)}>
          <section
            className="admin-modal"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ maxWidth: "520px" }}
          >
            <div className="panel-header">
              <div>
                <h2>About Parade Suite</h2>
              </div>
              <button className="button" onClick={() => setAboutOpen(false)}>
                Close
              </button>
            </div>

            <div style={{ lineHeight: 1.55 }}>
              <h2 style={{ marginBottom: "4px" }}>Parade Suite</h2>
              <div style={{ marginBottom: "14px" }}>
                Parade and Ceremonial Music Management System
              </div>
              <div style={{ marginBottom: "12px" }}>
                <strong>Version 1, © 2026</strong>
              </div>
              <div style={{ marginBottom: "14px" }}>Built by Tan Zhong Jun Baron</div>
              <div>
                Designed for the preparation and management of parade music,
                ceremonial cues, drum cues and timing maps.
              </div>
            </div>
          </section>
        </div>
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

      <style jsx global>{`

        .guidebook-modal { width:min(1180px,calc(100vw - 20px)); max-width:1180px; height:min(88dvh,860px); overflow:hidden; display:flex; flex-direction:column; }
        .guidebook-header { flex:0 0 auto; }
        .guidebook-tabs { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0 14px; }
        .guidebook-tabs button { padding:9px 14px; border:1px solid #475569; border-radius:8px; background:#0f172a; color:#e5e7eb; font-weight:700; }
        .guidebook-tabs button.selected { background:#2563eb; border-color:#60a5fa; color:#fff; }
        .guidebook-layout { min-height:0; flex:1; display:grid; grid-template-columns:minmax(0,1fr) 330px; gap:14px; }
        .guide-snapshot-frame { min-width:0; min-height:0; overflow:auto; border:1px solid #334155; border-radius:12px; background:#0b1220; padding:12px; }
        .guide-snapshot-caption { color:#94a3b8; font-size:12px; margin-bottom:9px; }
        .guide-snapshot { min-width:700px; border:1px solid #475569; border-radius:10px; background:#111827; padding:14px; color:#f8fafc; box-shadow:0 12px 30px rgba(0,0,0,.28); }
        .guide-hotspot { border:2px solid #facc15 !important; background:#1f2937 !important; color:#fff !important; border-radius:7px; padding:8px 10px; font-weight:700; cursor:pointer; box-shadow:0 0 0 2px rgba(250,204,21,.08); }
        .guide-hotspot:hover { background:#374151 !important; box-shadow:0 0 0 3px rgba(250,204,21,.18); }
        .guide-hotspot.green { border-color:#22c55e !important; }
        .guide-hotspot.red { border-color:#ef4444 !important; }
        .guide-wide { width:100%; text-align:left; }
        .guide-toolbar-row,.guide-toolbar-tabs,.guide-editor-imports,.guide-preview-row,.guide-transport-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .guide-toolbar-app,.guide-shot-title { font-size:22px; font-weight:900; letter-spacing:.04em; margin:22px 0 12px; }
        .guide-toolbar-tabs { border-top:1px solid #334155; padding-top:12px; }
        .guide-editor-grid,.guide-manager-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .guide-manager-grid { grid-template-columns:1.2fr .8fr .8fr; }
        .guide-panel,.guide-interlude-card { border:1px solid #475569; border-radius:8px; padding:12px; display:grid; gap:8px; background:#0f172a; }
        .guide-list-row { padding:8px 10px; border-radius:6px; background:#172033; color:#cbd5e1; }
        .guide-preview-row { margin-top:12px; border:1px solid #475569; border-radius:8px; padding:10px; }
        .guide-now-playing { margin:12px 0; text-align:center; padding:18px; border:1px solid #475569; border-radius:8px; background:#0f172a; font-size:22px; font-weight:800; }
        .guide-now-playing span { color:#22c55e; }
        .guide-now-playing small { font-size:14px; color:#cbd5e1; }
        .guide-interlude-card { max-width:520px; margin:0 auto; }
        .guide-interlude-track { padding:12px; text-align:center; background:#172033; border-radius:6px; font-weight:800; }
        .guide-explanation-panel { min-height:0; overflow:auto; border:1px solid #334155; border-radius:12px; background:#111827; padding:18px; }
        .guide-explanation-panel h3 { margin:4px 0 18px; font-size:24px; }
        .guide-explanation-panel h4 { margin:16px 0 5px; color:#93c5fd; }
        .guide-explanation-panel p { margin:0; line-height:1.55; color:#e2e8f0; }
        .guide-explanation-label { color:#facc15; text-transform:uppercase; letter-spacing:.08em; font-size:11px; font-weight:800; }
        @media (max-width: 820px) {
          .guidebook-modal { height:92dvh; }
          .guidebook-layout { grid-template-columns:1fr; overflow:auto; }
          .guide-snapshot-frame { min-height:430px; }
          .guide-explanation-panel { min-height:260px; }
        }


        .sequence-track-line {
          align-self: center;
        }

        @media (max-width: 600px) {
          .sequence-track-line {
            grid-column: 1 / -1 !important;
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            min-width: 0 !important;
          }

          .sequence-drag-handle {
            display: inline-flex !important;
            align-items: center !important;
            gap: 10px !important;
            width: auto !important;
            min-width: auto !important;
            flex: 0 0 auto !important;
            white-space: nowrap;
          }

          .sequence-track-title {
            margin: 0 !important;
            min-width: 0 !important;
          }
        }
      `}</style>

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
