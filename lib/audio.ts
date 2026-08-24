import type { TrackAction } from "./types";

export type RepeatBeatRow = {
  start_ms: number;
  half_ms: number;
  full_ms: number;
};

export type RepeatConfig = {
  action: TrackAction;
  repeatStartMs: number;
  repeatEndMs?: number | null;
  repeatMode?: string | null;
  beatMap?: RepeatBeatRow[];
  onNaturalEnd?: () => void;
};

export class AudioEngine {
  private interludeContext: AudioContext | null = null;
  private interludeSource: MediaElementAudioSourceNode | null = null;
  private interludeGain: GainNode | null = null;
  private interludeResetGeneration = 0;

  private main = new Audio();
  private repeatPlayer = new Audio();
  private interlude = new Audio();
  private preview = new Audio();
  private ending = new Audio();
  private singleCue = new Audio();
  private doubleCue = new Audio();

  private mainUrl = "";
  private repeatConfig: RepeatConfig | null = null;
  private repeatCrossfadeActive = false;
  private repeatSuppressed = false;
  private monitorFrame = 0;

  private musicVolume = 0.8;
  private cueVolume = 1.0;
  private duckGeneration = 0;

  // iOS/Safari-safe cue playback. The context is unlocked by a direct user
  // gesture (Play button) and then reused for scheduled cue/ending sounds.
  private cueContext: AudioContext | null = null;
  private cueBuffers = new Map<string, AudioBuffer>();
  private endingSources = new Set<AudioBufferSourceNode>();

  // Exact Windows v0.104 values.
  readonly repeatCrossfadeMs = 220;
  readonly drumRollRepeatCrossfadeMs = 45;
  readonly repeatBridgeReleaseMs = 220;
  readonly duckedMusicLevel = 0.30;
  readonly interludeFadeDurationMs = 5000;
  readonly fadeEndDurationMs = 5000;

  constructor() {
    this.interlude.loop = true;

    // Interlude audio is routed through WebAudio for iPad/iPhone-safe fades.
    // Set CORS mode before assigning any remote Supabase URL; otherwise Safari
    // can allow the HTMLAudio element to "play" while the MediaElement source
    // outputs silence through the AudioContext.
    this.interlude.crossOrigin = "anonymous";

    this.main.preload = "auto";
    this.repeatPlayer.preload = "auto";
    this.interlude.preload = "auto";
    this.preview.preload = "auto";
    this.ending.preload = "auto";
    this.singleCue.preload = "auto";
    this.doubleCue.preload = "auto";

    // Exact Windows cue files, kept on persistent HTMLAudio elements.
    // On iOS Safari, reusing an already-unlocked media element is more reliable
    // than creating a new element only after a delayed scheduled callback.
    this.singleCue.src = "/cues/singlebeat.wav";
    this.doubleCue.src = "/cues/doublebeat.wav";
    this.singleCue.volume = this.cueVolume;
    this.doubleCue.volume = this.cueVolume;

    this.bindMainEnded();
  }

  private bindMainEnded() {
    this.main.addEventListener("ended", () => this.handleMainEnded(), {
      once: true,
    });
  }

  setMusicVolume(value: number) {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (!this.main.paused) this.main.volume = this.musicVolume;
  }

  setCueVolume(value: number) {
    this.cueVolume = Math.max(0, Math.min(1, value));
    this.singleCue.volume = this.cueVolume;
    this.doubleCue.volume = this.cueVolume;
  }

  getMainPositionMs(): number {
    return Math.max(0, Math.round(this.main.currentTime * 1000));
  }

  getMainDurationMs(): number {
    return Number.isFinite(this.main.duration)
      ? Math.max(0, Math.round(this.main.duration * 1000))
      : 0;
  }

  seekMain(positionMs: number) {
    if (!Number.isFinite(this.main.duration) || this.main.duration <= 0) return;
    const seconds = Math.max(
      0,
      Math.min(this.main.duration, positionMs / 1000)
    );
    try {
      this.main.currentTime = seconds;
    } catch {}
  }

  isMainPlaying(): boolean {
    return !this.main.paused && !this.main.ended;
  }

  setRepeatSuppressed(value: boolean) {
    this.repeatSuppressed = value;
  }

  async playMain(url: string, repeatConfig: RepeatConfig) {
    this.stopMain();

    this.repeatConfig = repeatConfig;
    this.repeatSuppressed = false;
    this.mainUrl = url;

    this.main.src = url;
    this.main.currentTime = 0;
    this.main.loop = false;
    this.main.volume = this.musicVolume;

    // Preload the repeat bridge immediately. On iPhone/iPad Safari, assigning
    // a source and seeking only at the loop boundary can cause currentTime to
    // be ignored until metadata loads, making the repeat restart from 0.
    this.repeatPlayer.pause();
    this.repeatPlayer.src = url;
    this.repeatPlayer.preload = "auto";
    this.repeatPlayer.load();
    this.repeatPlayer.volume = 0;

    this.bindMainEnded();
    await this.main.play();
    this.startRepeatMonitor();
  }

  stopMain() {
    this.duckGeneration += 1;
    cancelAnimationFrame(this.monitorFrame);
    this.monitorFrame = 0;

    this.repeatCrossfadeActive = false;

    this.main.pause();
    try { this.main.currentTime = 0; } catch {}

    this.repeatPlayer.pause();
    try { this.repeatPlayer.currentTime = 0; } catch {}
    this.repeatPlayer.removeAttribute("src");

    this.main.volume = this.musicVolume;
  }

  hardStopMain() {
    this.duckGeneration += 1;
    cancelAnimationFrame(this.monitorFrame);
    this.monitorFrame = 0;
    this.repeatCrossfadeActive = false;

    this.main.pause();
    this.main.removeAttribute("src");
    this.main.load();

    this.repeatPlayer.pause();
    this.repeatPlayer.removeAttribute("src");
    this.repeatPlayer.load();

    this.main.volume = this.musicVolume;
  }

  async fadeMainToStop(durationMs = this.fadeEndDurationMs) {
    const mainWasPlaying = this.isMainPlaying();
    const repeatWasPlaying =
      !this.repeatPlayer.paused && !this.repeatPlayer.ended;

    if (!mainWasPlaying && !repeatWasPlaying) return;

    // Freeze all mechanisms that can change playback/volume while fading.
    cancelAnimationFrame(this.monitorFrame);
    this.monitorFrame = 0;
    this.repeatSuppressed = true;

    // Invalidate any pending drum-cue duck restore timer. Without this, an
    // older cue timeout can restore the march to full Music Volume halfway
    // through the 5-second fade.
    this.duckGeneration += 1;

    const mainStart = Math.max(0, Math.min(1, this.main.volume));
    const repeatStart = Math.max(0, Math.min(1, this.repeatPlayer.volume));

    // If a Repeat crossfade is active, BOTH audible media elements must fade.
    // Previously only the primary element faded, so the bridge player could
    // remain audible and make the Fade button appear not to work.
    const fades: Promise<void>[] = [];

    if (mainWasPlaying) {
      fades.push(this.fade(this.main, mainStart, 0, durationMs));
    }

    if (repeatWasPlaying) {
      fades.push(this.fade(this.repeatPlayer, repeatStart, 0, durationMs));
    }

    await Promise.all(fades);

    this.main.volume = 0;
    this.repeatPlayer.volume = 0;

    this.hardStopMain();

    // Prepare the next normal track at the operator's Music Volume.
    this.main.volume = this.musicVolume;
    this.repeatPlayer.volume = 0;
    this.repeatSuppressed = false;
  }

  private repeatGridLeadMs(config: RepeatConfig): number {
    if (config.repeatStartMs <= 0) {
      return this.drumRollRepeatCrossfadeMs;
    }

    const rows = config.beatMap ?? [];
    let active: RepeatBeatRow | null = null;

    for (const row of rows) {
      if (row.start_ms <= config.repeatStartMs) {
        active = row;
      } else {
        break;
      }
    }

    if (!active) {
      active =
        rows.find(
          (row) =>
            row.start_ms > 0 &&
            row.full_ms >= 300 &&
            row.full_ms <= 2000
        ) ?? null;
    }

    if (!active) return this.repeatCrossfadeMs;

    const half =
      active.half_ms > 0
        ? active.half_ms
        : Math.round(active.full_ms / 2);

    // Legacy fast-march maps are normally ~240–275 ms per half beat.
    // Clamp unusual files so the transition remains operationally safe.
    return Math.max(120, Math.min(650, half));
  }

  private startRepeatMonitor() {
    cancelAnimationFrame(this.monitorFrame);

    const monitor = () => {
      const config = this.repeatConfig;

      if (
        config &&
        config.action === "Repeat" &&
        !this.repeatSuppressed &&
        !this.repeatCrossfadeActive &&
        config.repeatMode?.toUpperCase() !== "FULL_ENDING" &&
        Number.isFinite(this.main.duration) &&
        this.main.duration > 0 &&
        !this.main.paused
      ) {
        const durationMs = this.main.duration * 1000;
        const loopEnd = config.repeatEndMs ?? durationMs;

        const crossfadeLead = this.repeatGridLeadMs(config);

        if (this.getMainPositionMs() >= loopEnd - crossfadeLead) {
          void this.startRepeatCrossfade(
            config.repeatStartMs,
            crossfadeLead
          );
        }
      }

      this.monitorFrame = requestAnimationFrame(monitor);
    };

    this.monitorFrame = requestAnimationFrame(monitor);
  }

  private async startRepeatCrossfade(
    repeatStartMs: number,
    activeCrossfadeMs: number
  ) {
    if (this.repeatCrossfadeActive || !this.mainUrl) return;

    this.repeatCrossfadeActive = true;

    const outgoing = this.main;
    const incoming = this.repeatPlayer;
    const targetVolume = this.musicVolume;

    incoming.pause();

    if (incoming.src !== this.mainUrl) {
      incoming.src = this.mainUrl;
      incoming.preload = "auto";
      incoming.load();
    }

    // Legacy .lib beat-grid pre-roll:
    // start the incoming player one crossfade window BEFORE the repeat marker.
    // When the outgoing track reaches its loop boundary, the incoming player
    // arrives at repeatStartMs on the same musical beat.
    const incomingStartMs =
      repeatStartMs > 0
        ? Math.max(0, repeatStartMs - activeCrossfadeMs)
        : 0;

    if (incoming.readyState < 1) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        incoming.addEventListener("loadedmetadata", done, { once: true });
        window.setTimeout(done, 800);
      });
    }

    try {
      incoming.currentTime = incomingStartMs / 1000;
    } catch {}

    incoming.volume = 0;

    try {
      await incoming.play();
    } catch {
      this.repeatCrossfadeActive = false;
      return;
    }

    // Exact Windows source step counts.
    const steps = repeatStartMs === 0 ? 5 : 11;
    const intervalMs = Math.max(9, Math.floor(activeCrossfadeMs / steps));

    await new Promise<void>((resolve) => {
      let step = 0;

      const timer = window.setInterval(() => {
        step += 1;
        const frac = Math.min(1, step / steps);

        outgoing.volume = targetVolume * (1 - frac);
        incoming.volume = targetVolume * frac;

        if (step >= steps) {
          window.clearInterval(timer);
          resolve();
        }
      }, intervalMs);
    });

    // Same bridge logic as Windows: switch the primary channel to the
    // position already reached by the repeat channel, then release bridge.
    const bridgePositionMs = Math.max(
      repeatStartMs,
      Math.round(incoming.currentTime * 1000)
    );

    outgoing.pause();
    outgoing.src = this.mainUrl;
    outgoing.currentTime = bridgePositionMs / 1000;

    // Keep the already-audible bridge player carrying the music while the
    // primary HTMLAudio element wakes back up. On iPhone/iPad Safari the
    // primary element can take longer than the old 80 ms bridge window,
    // producing a small audible pause.
    outgoing.volume = 0;

    try {
      await outgoing.play();
    } catch {
      incoming.volume = targetVolume;
      this.repeatCrossfadeActive = false;
      return;
    }

    // Second-stage handoff: crossfade from the bridge player back to the
    // primary player instead of cutting the bridge after a fixed 80 ms.
    const bridgeReleaseMs = this.repeatBridgeReleaseMs;
    const bridgeSteps = 11;
    const bridgeIntervalMs = Math.max(
      12,
      Math.floor(bridgeReleaseMs / bridgeSteps)
    );

    await new Promise<void>((resolve) => {
      let step = 0;

      const timer = window.setInterval(() => {
        step += 1;
        const frac = Math.min(1, step / bridgeSteps);

        outgoing.volume = targetVolume * frac;
        incoming.volume = targetVolume * (1 - frac);

        if (step >= bridgeSteps) {
          window.clearInterval(timer);
          resolve();
        }
      }, bridgeIntervalMs);
    });

    outgoing.volume = targetVolume;
    incoming.pause();
    incoming.removeAttribute("src");
    incoming.volume = 0;
    this.repeatCrossfadeActive = false;
  }

  private handleMainEnded() {
    const config = this.repeatConfig;

    if (!config || this.repeatSuppressed) {
      config?.onNaturalEnd?.();
      return;
    }

    if (config.action === "Repeat") {
      // Exact Windows EndOfMedia Repeat behavior:
      // FULL_ENDING lets native ending bass drums finish before restart.
      try {
        this.main.currentTime = Math.max(0, config.repeatStartMs) / 1000;
        this.main.volume = this.musicVolume;
        this.bindMainEnded();
        void this.main.play();
      } catch {}
      return;
    }

    config.onNaturalEnd?.();
  }

  async playPreview(url: string, volume?: number) {
    this.preview.pause();
    this.preview.src = url;
    this.preview.currentTime = 0;
    this.preview.loop = false;
    this.preview.volume = Math.max(
      0,
      Math.min(1, volume ?? this.musicVolume)
    );
    await this.preview.play();
  }

  stopPreview() {
    this.preview.pause();
    try { this.preview.currentTime = 0; } catch {}
  }

  isPreviewPlaying(): boolean {
    return !this.preview.paused && !this.preview.ended;
  }

  private async ensureInterludeAudioGraph(): Promise<void> {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) return;

    if (!this.interludeContext) {
      this.interludeContext = new AudioContextCtor();
    }

    if (!this.interludeSource) {
      try {
        this.interludeSource =
          this.interludeContext.createMediaElementSource(this.interlude);
        this.interludeGain = this.interludeContext.createGain();
        this.interludeSource.connect(this.interludeGain);
        this.interludeGain.connect(this.interludeContext.destination);
      } catch {
        // If Safari already associated the element with a MediaElementSource,
        // keep the existing graph and continue.
      }
    }

    if (this.interludeContext.state === "suspended") {
      try {
        await this.interludeContext.resume();
      } catch {}
    }
  }

  private setInterludeGain(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));

    if (this.interludeGain && this.interludeContext) {
      try {
        const now = this.interludeContext.currentTime;
        this.interludeGain.gain.cancelScheduledValues(now);
        this.interludeGain.gain.setValueAtTime(clamped, now);
      } catch {}
    } else {
      this.interlude.volume = clamped;
    }
  }

  private async rampInterludeGain(
    targetVolume: number,
    durationMs: number,
    onVolume?: (value: number) => void
  ) {
    const target = Math.max(0, Math.min(1, targetVolume));
    await this.ensureInterludeAudioGraph();

    // Use WebAudio automation on iOS/iPadOS Safari. HTMLAudioElement.volume
    // updates are not reliably audible there during rapid scripted fades.
    if (this.interludeGain && this.interludeContext) {
      const context = this.interludeContext;
      const gain = this.interludeGain.gain;
      const now = context.currentTime;

      let start = gain.value;
      if (!Number.isFinite(start)) {
        start = this.interlude.volume;
      }

      try {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(start, now);
        gain.linearRampToValueAtTime(target, now + durationMs / 1000);
      } catch {}

      const steps = 50;
      const intervalMs = Math.max(20, Math.floor(durationMs / steps));
      let step = 0;

      await new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
          step += 1;
          const fraction = Math.min(1, step / steps);
          const value = start + ((target - start) * fraction);
          onVolume?.(Math.max(0, Math.min(1, value)));

          if (fraction >= 1) {
            window.clearInterval(timer);
            resolve();
          }
        }, intervalMs);
      });

      // Do not cancel and re-apply the gain at the end of the ramp.
      // The AudioParam is already exactly at `target` after the scheduled
      // linear ramp. Re-setting it here can create a short click/glitch on
      // Safari/iPadOS when the fade completes.
      return;
    }

    // Fallback for browsers without WebAudio MediaElement routing.
    await this.fade(
      this.interlude,
      this.interlude.volume,
      target,
      durationMs,
      onVolume
    );
  }

  async playInterlude(url: string, volume: number) {
    this.interludeResetGeneration += 1;
    this.interlude.pause();

    if (this.interlude.src !== url) {
      this.interlude.src = url;
      this.interlude.load();
    }

    try { this.interlude.currentTime = 0; } catch {}
    this.interlude.loop = true;

    const targetVolume = Math.max(0, Math.min(1, volume));

    // IMPORTANT iOS/iPadOS Safari:
    // invoke play() immediately while still inside the operator's Play-button
    // gesture. Do not await AudioContext setup before making this call.
    //
    // The first play begins on the HTMLMediaElement; immediately afterwards we
    // attach/resume the WebAudio GainNode used by Fade/Restore.
    this.interlude.volume = targetVolume;
    const playPromise = this.interlude.play();

    await this.ensureInterludeAudioGraph();

    // Once the media element is routed through WebAudio, keep its own volume at
    // unity and control audible volume with the GainNode.
    if (this.interludeGain) {
      this.interlude.volume = 1.0;
      this.setInterludeGain(targetVolume);
    } else {
      this.interlude.volume = targetVolume;
    }

    await playPromise;
  }

  setInterludeVolume(volume: number) {
    this.setInterludeGain(volume);
  }

  isInterludePlaying(): boolean {
    return !this.interlude.paused && !this.interlude.ended;
  }

  async fadeInterludeToLevel(
    targetVolume: number,
    durationMs = this.interludeFadeDurationMs,
    onVolume?: (value: number) => void
  ) {
    if (!this.isInterludePlaying()) return;

    const target = Math.max(0, Math.min(1, targetVolume));
    await this.rampInterludeGain(target, durationMs, onVolume);
    onVolume?.(target);
  }

  async restoreInterludeVolume(
    targetVolume: number,
    durationMs = 800,
    onVolume?: (value: number) => void
  ) {
    const target = Math.max(0, Math.min(1, targetVolume));

    if (!this.isInterludePlaying()) {
      this.setInterludeGain(target);
      onVolume?.(target);
      return;
    }

    await this.rampInterludeGain(target, durationMs, onVolume);
    onVolume?.(target);
  }

  async fadeInterludeToStop(
    durationMs = this.interludeFadeDurationMs,
    onVolume?: (value: number) => void,
    restoreVolume = 0.60
  ) {
    if (!this.isInterludePlaying()) return;

    // Cancel any older delayed reset/restore sequence.
    const generation = ++this.interludeResetGeneration;

    // 1) Fade fully to 0% within 5 seconds.
    await this.rampInterludeGain(0, durationMs, onVolume);
    if (generation !== this.interludeResetGeneration) return;
    onVolume?.(0);

    // 2) Once truly silent, stop the element and reset it to the beginning.
    // The GainNode stays at 0%, so any browser seek transient remains inaudible.
    this.interlude.pause();
    try {
      this.interlude.currentTime = 0;
    } catch {}

    // The track is already stopped now. Run the remaining reset sequence in
    // the background so Parade Suite can select the next playlist track now.
    void (async () => {
      // 3) Wait 2 seconds at 0% while paused at 00:00.
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 2000);
      });
      if (generation !== this.interludeResetGeneration) return;

      // 4) Still paused at the beginning, restore the Interlude channel
      // immediately to the operator's editable Default %.
      const target = Math.max(0, Math.min(1, restoreVolume));
      this.setInterludeGain(target);
      onVolume?.(target);
    })();
  }

  stopInterludeImmediately(restoreVolume = 0.60) {
    const generation = ++this.interludeResetGeneration;

    this.setInterludeGain(0);
    this.interlude.pause();
    try {
      this.interlude.currentTime = 0;
    } catch {}

    window.setTimeout(() => {
      if (generation !== this.interludeResetGeneration) return;

      const target = Math.max(0, Math.min(1, restoreVolume));
      this.setInterludeGain(target);
    }, 2000);
  }

  async unlockCueAudio(): Promise<void> {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) return;

    if (!this.cueContext) {
      this.cueContext = new AudioContextCtor();
    }

    if (this.cueContext.state === "suspended") {
      try {
        await this.cueContext.resume();
      } catch {}
    }

    // Prime the output graph with a silent buffer during the user gesture.
    // This helps iOS Safari keep the context eligible for later scheduled cues.
    try {
      const silent = this.cueContext.createBuffer(1, 1, this.cueContext.sampleRate);
      const source = this.cueContext.createBufferSource();
      const gain = this.cueContext.createGain();
      gain.gain.value = 0;
      source.buffer = silent;
      source.connect(gain);
      gain.connect(this.cueContext.destination);
      source.start();
    } catch {}
  }

  async prepareCueAudio(): Promise<void> {
    await this.unlockCueAudio();

    // Canonical cue set shared with the Windows folder.
    // Predecode while a direct user gesture is active so iOS Safari can later
    // fire scheduled AudioBufferSourceNodes without another play() permission.
    await Promise.all([
      this.loadCueBuffer("singlebeat.wav"),
      this.loadCueBuffer("doublebeat.wav"),
      this.loadCueBuffer("Ending Beat.wav"),
      this.loadCueBuffer("knights_ending_beat.wav"),
    ]);
  }


  private async loadCueBuffer(filename: string): Promise<AudioBuffer | null> {
    await this.unlockCueAudio();
    if (!this.cueContext) return null;

    const cached = this.cueBuffers.get(filename);
    if (cached) return cached;

    try {
      const response = await fetch(`/cues/${filename}`, { cache: "force-cache" });
      if (!response.ok) return null;

      const bytes = await response.arrayBuffer();
      const buffer = await this.cueContext.decodeAudioData(bytes.slice(0));
      this.cueBuffers.set(filename, buffer);
      return buffer;
    } catch {
      return null;
    }
  }

  private async playCueBuffer(
    filename: string,
    volume: number,
    whenSeconds?: number
  ): Promise<boolean> {
    const buffer = await this.loadCueBuffer(filename);
    const context = this.cueContext;
    if (!buffer || !context) return false;

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }

    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, volume));

    source.connect(gain);
    gain.connect(context.destination);

    const startAt =
      whenSeconds !== undefined
        ? Math.max(context.currentTime + 0.005, whenSeconds)
        : context.currentTime + 0.005;

    return new Promise<boolean>((resolve) => {
      source.addEventListener("ended", () => resolve(true), { once: true });
      try {
        source.start(startAt);
      } catch {
        resolve(false);
      }
    });
  }

  private async playPersistentWindowsCue(
    filename: string,
    volume: number
  ): Promise<boolean> {
    const cue =
      filename === "singlebeat.wav"
        ? this.singleCue
        : filename === "doublebeat.wav"
        ? this.doubleCue
        : null;

    if (!cue) return false;

    try {
      cue.pause();
      cue.currentTime = 0;
      cue.volume = Math.max(0, Math.min(1, volume));
      await cue.play();
      return true;
    } catch {
      return false;
    }
  }

  private async playHtmlCueFallback(
    filename: string,
    volume: number
  ): Promise<void> {
    const cue = new Audio(`/cues/${filename}`);
    cue.preload = "auto";
    cue.volume = Math.max(0, Math.min(1, volume));

    try {
      await cue.play();
    } catch {
      // Keep failure contained; caller may be running on a browser that blocks
      // delayed HTMLAudio. Web Audio remains the preferred path.
    }
  }

  async scheduleCueFile(
    filename: string,
    delayMs: number,
    duckDurationMs = 950,
    duckLevel = this.duckedMusicLevel
  ): Promise<boolean> {
    await this.unlockCueAudio();
    const buffer = await this.loadCueBuffer(filename);
    const context = this.cueContext;

    if (!buffer || !context) return false;

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }

    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = buffer;
    gain.gain.value = this.cueVolume;

    source.connect(gain);
    gain.connect(context.destination);

    // Schedule the actual audio source immediately against the WebAudio clock.
    // iOS Safari does not need to authorize a new play() call when this future
    // timestamp arrives; the source was already created/scheduled during the tap.
    const startAt = context.currentTime + Math.max(0.005, delayMs / 1000);

    try {
      source.start(startAt);
    } catch {
      return false;
    }

    // Schedule only the march ducking UI/audio-volume change around the cue.
    // The cue itself no longer depends on a delayed setTimeout callback.
    window.setTimeout(() => {
      // Manual bass-drum cues duck to a percentage of the CURRENT music
      // level, so the effect is always audible even when the music slider
      // is below 100%.
      this.duckMusicForCue(duckDurationMs, duckLevel, true);
    }, Math.max(0, delayMs - 10));

    return true;
  }

  async playCueFile(
    filename: string,
    duckDurationMs = 950,
    duckLevel = this.duckedMusicLevel
  ) {
    // Keep the cue WAV itself untouched. Manual bass-drum cues duck
    // relative to the operator's current music volume.
    this.duckMusicForCue(duckDurationMs, duckLevel, true);

    // iOS Safari path: use the persistent element that was unlocked during
    // the user's Play/Drum Cue tap. This avoids silent failure in delayed
    // setTimeout callbacks.
    const persistentPlayed = await this.playPersistentWindowsCue(
      filename,
      this.cueVolume
    );
    if (persistentPlayed) return;

    // Fallback 1: already-unlocked/predecoded WebAudio.
    const webAudioPlayed = await this.playCueBuffer(
      filename,
      this.cueVolume
    );
    if (webAudioPlayed) return;

    // Fallback 2: ordinary HTMLAudio.
    await this.playHtmlCueFallback(filename, this.cueVolume);
  }


  cancelEndingCue() {
    for (const source of this.endingSources) {
      try { source.stop(); } catch {}
    }
    this.endingSources.clear();

    this.ending.pause();
    this.ending.removeAttribute("src");
    this.ending.load();
  }

  async playEndingCue(isKnights: boolean): Promise<void> {
    const filename = isKnights
      ? "knights_ending_beat.wav"
      : "Ending Beat.wav";

    // Exact Windows file; use Web Audio only to make scheduled playback
    // reliable on iPhone/iPad Safari after the context has been unlocked.
    const buffer = await this.loadCueBuffer(filename);
    const context = this.cueContext;

    if (!buffer || !context) {
      // Fallback to HTMLAudio if Web Audio is unavailable.
      this.ending.pause();
      this.ending.src = `/cues/${filename}`;
      this.ending.currentTime = 0;
      this.ending.volume = 1.0;

      const fallbackMs = isKnights ? 4200 : 4500;
      const endingDuckLevel = isKnights ? 0.15 : 0.30;
      this.duckMusicForCue(fallbackMs + 250, endingDuckLevel, true);

      return new Promise<void>(async (resolve) => {
        const finish = () => {
          this.ending.removeEventListener("ended", finish);
          resolve();
        };
        this.ending.addEventListener("ended", finish);
        try { await this.ending.play(); } catch { finish(); }
      });
    }

    const durationMs = Math.round(buffer.duration * 1000);

    // Knights of St John ending needs more separation from the march.
    // Standard ending stays at 30%; Knights ducks the march to 15%.
    const endingDuckLevel = isKnights ? 0.15 : 0.30;
    this.duckMusicForCue(durationMs + 250, endingDuckLevel, true);

    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = buffer;
    gain.gain.value = 1.0;

    source.connect(gain);
    gain.connect(context.destination);

    this.endingSources.add(source);

    return new Promise<void>((resolve) => {
      const finish = () => {
        this.endingSources.delete(source);
        resolve();
      };

      source.addEventListener("ended", finish, { once: true });

      try {
        source.start(context.currentTime + 0.005);
      } catch {
        finish();
      }
    });
  }


  private duckMusicForCue(
    durationMs = 900,
    level = this.duckedMusicLevel,
    relativeToCurrent = false
  ) {
    if (!this.isMainPlaying()) return;

    this.duckGeneration += 1;
    const generation = this.duckGeneration;

    const normalLevel = this.musicVolume;

    // Manual drum cues use relative ducking:
    // e.g. music at 80% with a 30% duck target becomes 24%.
    // This prevents the old problem where music at 30% or lower barely
    // ducked at all because 0.30 was treated as an absolute level.
    const requestedLevel = relativeToCurrent
      ? normalLevel * level
      : level;

    const duckLevel = Math.max(0, Math.min(normalLevel, requestedLevel));
    this.main.volume = duckLevel;

    window.setTimeout(() => {
      if (generation !== this.duckGeneration) return;

      if (this.isMainPlaying()) {
        this.main.volume = this.musicVolume;
      }
    }, Math.max(80, Math.round(durationMs)));
  }

  private fade(
    audio: HTMLAudioElement,
    from: number,
    to: number,
    durationMs: number,
    onVolume?: (value: number) => void
  ) {
    return new Promise<void>((resolve) => {
      // Windows uses 50 steps for the main Fade; this smoothstep curve
      // is numerically identical at the sampled fractions.
      const steps = 50;
      const intervalMs = Math.max(20, Math.floor(durationMs / steps));
      let step = 0;

      const timer = window.setInterval(() => {
        step += 1;
        const fraction = Math.min(1, step / steps);
        const eased = fraction * fraction * (3 - 2 * fraction);
        const value = from + ((to - from) * eased);

        audio.volume = Math.max(0, Math.min(1, value));
        onVolume?.(audio.volume);

        if (fraction >= 1) {
          window.clearInterval(timer);
          resolve();
        }
      }, intervalMs);
    });
  }
}
