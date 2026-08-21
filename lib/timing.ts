import type { BeatRow, Track } from "./types";

export type ParsedLIB = {
  title?: string;
  audioFileName?: string;
  category?: string;
  behavior?: string;
  beatMap: BeatRow[];
  repeatStartMs?: number;
  repeatEndMs?: number;
  repeatMode?: string;
};

export function normalizeTrackName(text: string): string {
  const basename = text.replace(/^.*[\\/]/, "");
  const stem = basename.replace(/\.[^.]+$/, "");
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseLegacyLIB(text: string): ParsedLIB {
  const lines = text.split(/\r?\n/);

  let repeatStartMs: number | undefined;
  let repeatEndMs: number | undefined;
  let repeatMode: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    const upper = line.toUpperCase();

    if (upper.startsWith("#REPEAT_START=")) {
      const value = Number(line.split("=", 2)[1]?.trim());
      if (Number.isFinite(value)) repeatStartMs = Math.round(value);
    } else if (upper.startsWith("#REPEAT_END=")) {
      const value = Number(line.split("=", 2)[1]?.trim());
      if (Number.isFinite(value)) repeatEndMs = Math.round(value);
    } else if (upper.startsWith("#REPEAT_MODE=")) {
      repeatMode = line.split("=", 2)[1]?.trim().toUpperCase();
    }
  }

  const beatMap: BeatRow[] = [];

  // Exact Windows source behavior: timing rows begin at lines[7:].
  for (const raw of lines.slice(7)) {
    const parts = raw.split(";").map((x) => x.trim());
    if (parts.length !== 4) continue;

    let startMs = Number(parts[0]);
    let halfMs = Number(parts[1]);
    let fullMs = Number(parts[3]);

    if (![startMs, halfMs, fullMs].every(Number.isFinite)) continue;

    startMs = Math.round(startMs);
    halfMs = Math.round(halfMs);
    fullMs = Math.round(fullMs);

    if (fullMs <= 0 && halfMs > 0) fullMs = halfMs * 2;

    if (fullMs > 0) {
      beatMap.push({
        start_ms: startMs,
        half_ms: halfMs,
        full_ms: fullMs,
      });
    }
  }

  beatMap.sort((a, b) => a.start_ms - b.start_ms);

  return {
    title: lines[0]?.trim() || undefined,
    audioFileName: lines[1]?.trim() || undefined,
    category: lines[2]?.trim() || undefined,
    behavior: lines[3]?.trim() || undefined,
    beatMap,
    repeatStartMs,
    repeatEndMs,
    repeatMode,
  };
}

export function beatContextForPosition(
  beatMap: BeatRow[] | undefined,
  positionMs: number
): BeatRow | null {
  if (!beatMap?.length) return null;
  let active = beatMap[0];

  for (const row of beatMap) {
    if (row.start_ms <= positionMs) active = row;
    else break;
  }
  return active;
}

export function nextQuantizedBeatMs(
  beatMap: BeatRow[] | undefined,
  positionMs: number,
  minimumLeadMs = 70
): number | null {
  const row = beatContextForPosition(beatMap, positionMs);
  if (!row) return null;

  const interval = Math.max(1, row.full_ms);
  const origin = row.start_ms;
  const targetFrom = positionMs + minimumLeadMs;

  if (targetFrom <= origin) return origin;
  const steps = Math.ceil((targetFrom - origin) / interval);
  return origin + steps * interval;
}

export function nextQuantizedHalfBeatMs(
  beatMap: BeatRow[] | undefined,
  positionMs: number,
  minimumLeadMs = 85
): number | null {
  const row = beatContextForPosition(beatMap, positionMs);
  if (!row) return null;

  const interval =
    row.half_ms > 0
      ? row.half_ms
      : Math.max(1, Math.floor(row.full_ms / 2));

  const origin = row.start_ms;
  const targetFrom = positionMs + minimumLeadMs;

  if (targetFrom <= origin) return origin;
  const steps = Math.ceil((targetFrom - origin) / interval);
  return origin + steps * interval;
}

export function nextPhraseBoundaryMs(
  beatMap: BeatRow[] | undefined,
  positionMs: number,
  minimumLeadMs = 1400
): number | null {
  if (!beatMap?.length) return null;

  const threshold = positionMs + minimumLeadMs;
  for (const row of beatMap) {
    if (row.start_ms >= threshold) return row.start_ms;
  }
  return null;
}

export function repeatStartMsForTrack(track: Track): number {
  if (
    track.repeat_start_ms !== null &&
    track.repeat_start_ms !== undefined
  ) {
    return Math.max(0, track.repeat_start_ms);
  }

  for (const row of track.timing_map ?? []) {
    if (row.start_ms > 0 && row.full_ms >= 300 && row.full_ms <= 2000) {
      return row.start_ms;
    }
  }

  return 0;
}

export async function loadWindowsTimingMap(
  audioName: string
): Promise<{ parsed: ParsedLIB; libName: string } | null> {
  try {
    const indexResponse = await fetch("/generated_timing_maps/index.json?v=0.129", {
      cache: "no-store",
    });
    if (!indexResponse.ok) return null;

    const index = (await indexResponse.json()) as Record<string, string>;
    const key = normalizeTrackName(audioName);

    // Exact Windows source order:
    // 1. exact normalized name against bundled index
    let mappedName = index[key];

    // 2. conservative containment match >= 0.72
    if (!mappedName) {
      const candidates: Array<[number, string]> = [];

      for (const [knownKey, filename] of Object.entries(index)) {
        if (!knownKey) continue;

        if (key.includes(knownKey) || knownKey.includes(key)) {
          const score =
            Math.min(key.length, knownKey.length) /
            Math.max(key.length, knownKey.length);

          if (score >= 0.72) {
            candidates.push([score, filename]);
          }
        }
      }

      if (candidates.length) {
        candidates.sort((a, b) => {
          if (b[0] !== a[0]) return b[0] - a[0];
          return b[1].localeCompare(a[1]);
        });
        mappedName = candidates[0][1];
      }
    }

    if (!mappedName) return null;

    const response = await fetch(
      `/generated_timing_maps/${encodeURIComponent(mappedName)}?v=0.129`,
      { cache: "no-store" }
    );
    if (!response.ok) return null;

    return {
      parsed: parseLegacyLIB(await response.text()),
      libName: mappedName,
    };
  } catch {
    return null;
  }
}

export function pairUploadedLIBToTrack(
  allTracks: Track[],
  libFileName: string,
  parsed: ParsedLIB
): Track | null {
  // Exact Windows pair_audio_and_lib_files logic, adapted to persisted web tracks.
  const candidateKeys = new Set<string>([
    normalizeTrackName(libFileName),
  ]);

  if (parsed.audioFileName) {
    candidateKeys.add(normalizeTrackName(parsed.audioFileName));
  }
  if (parsed.title) {
    candidateKeys.add(normalizeTrackName(parsed.title));
  }

  const audioByKey = new Map<string, Track>();
  for (const track of allTracks) {
    for (const source of [
      track.source_name || "",
      track.title || "",
    ]) {
      const key = normalizeTrackName(source);
      if (key) audioByKey.set(key, track);
    }
  }

  // Exact normalized-key matching first.
  for (const key of candidateKeys) {
    const match = audioByKey.get(key);
    if (match) return match;
  }

  // Conservative containment fallback >= 0.72.
  for (const key of candidateKeys) {
    for (const [audioKey, track] of audioByKey.entries()) {
      if (!key || !audioKey) continue;

      if (key.includes(audioKey) || audioKey.includes(key)) {
        const shorter = Math.min(key.length, audioKey.length);
        const longer = Math.max(key.length, audioKey.length);

        if (longer && shorter / longer >= 0.72) {
          return track;
        }
      }
    }
  }

  return null;
}
