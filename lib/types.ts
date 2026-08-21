export type TrackAction = "Repeat" | "End" | "Interlude";

export type BeatRow = {
  start_ms: number;
  half_ms: number;
  full_ms: number;
};

export type Track = {
  id: string;
  title: string;
  category: string;
  file_url: string;
  has_lib?: boolean;
  has_timing_map: boolean;
  source_name?: string | null;
  timing_map?: BeatRow[];
  repeat_start_ms?: number | null;
  repeat_end_ms?: number | null;
  repeat_mode?: string | null;
  lib_name?: string | null;
  created_at?: string;
};

export type SequenceItem = {
  id: string;
  track_id: string;
  action: TrackAction;
  position: number;
};
