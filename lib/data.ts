import { supabase } from "./supabase";
import type { SequenceItem, Track } from "./types";

const LOCAL_TRACKS = "parade-suite-tracks-v0105";
const LOCAL_SEQUENCE = "parade-suite-sequence-v0105";

function readLocal<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function writeLocal<T>(key: string, value: T[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

export async function listTracks(): Promise<Track[]> {
  if (!supabase) return readLocal<Track>(LOCAL_TRACKS);
  const { data, error } = await supabase.from("tracks").select("*").order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function createTrack(input: Omit<Track, "id">): Promise<Track> {
  if (!supabase) {
    const track = { ...input, id: crypto.randomUUID() };
    const all = readLocal<Track>(LOCAL_TRACKS);
    all.push(track);
    writeLocal(LOCAL_TRACKS, all);
    return track;
  }

  const { data, error } = await supabase.from("tracks").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateTrackTiming(
  id: string,
  patch: Partial<Pick<
    Track,
    "has_lib" | "has_timing_map" | "timing_map" | "repeat_start_ms" | "repeat_end_ms" | "repeat_mode" | "lib_name" | "category" | "source_name"
  >>
): Promise<Track> {
  if (!supabase) {
    const all = readLocal<Track>(LOCAL_TRACKS);
    const idx = all.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error("Track not found");
    all[idx] = { ...all[idx], ...patch };
    writeLocal(LOCAL_TRACKS, all);
    return all[idx];
  }

  const { data, error } = await supabase
    .from("tracks")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function listSequence(): Promise<SequenceItem[]> {
  if (!supabase) {
    return readLocal<SequenceItem>(LOCAL_SEQUENCE).sort((a, b) => a.position - b.position);
  }
  const { data, error } = await supabase.from("sequence_items").select("*").order("position");
  if (error) throw error;
  return data ?? [];
}

export async function saveSequenceItem(item: SequenceItem): Promise<SequenceItem> {
  if (!supabase) {
    const all = readLocal<SequenceItem>(LOCAL_SEQUENCE);
    const idx = all.findIndex((x) => x.id === item.id);
    if (idx >= 0) all[idx] = item;
    else all.push(item);
    writeLocal(LOCAL_SEQUENCE, all);
    return item;
  }

  const { data, error } = await supabase.from("sequence_items").upsert(item).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSequenceItem(id: string): Promise<void> {
  if (!supabase) {
    writeLocal(
      LOCAL_SEQUENCE,
      readLocal<SequenceItem>(LOCAL_SEQUENCE).filter((x) => x.id !== id)
    );
    return;
  }

  const { error } = await supabase.from("sequence_items").delete().eq("id", id);
  if (error) throw error;
}

export async function uploadAudioFile(
  file: File,
  onProgress?: (uploadedBytes: number, totalBytes: number) => void
): Promise<string> {
  if (!supabase) {
    onProgress?.(file.size, file.size);
    return URL.createObjectURL(file);
  }

  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const DIRECT_THRESHOLD = 6 * 1024 * 1024;

  if (file.size <= DIRECT_THRESHOLD) {
    const objectName = `${crypto.randomUUID()}-${safeFileName}`;

    const { error } = await supabase.storage
      .from("music")
      .upload(objectName, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) throw error;

    onProgress?.(file.size, file.size);

    const { data } = supabase.storage
      .from("music")
      .getPublicUrl(objectName);

    return data.publicUrl;
  }

  const signedResponse = await fetch("/api/storage/signed-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: safeFileName }),
  });

  const signed = await signedResponse.json();

  if (!signedResponse.ok || !signed?.token || !signed?.objectName) {
    throw new Error(
      signed?.message || "Unable to prepare signed upload."
    );
  }

  onProgress?.(0, file.size);

  const { error } = await supabase.storage
    .from("music")
    .uploadToSignedUrl(
      signed.objectName,
      signed.token,
      file,
      {
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      }
    );

  if (error) throw error;

  onProgress?.(file.size, file.size);

  const { data } = supabase.storage
    .from("music")
    .getPublicUrl(signed.objectName);

  return data.publicUrl;
}
