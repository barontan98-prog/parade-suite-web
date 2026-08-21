import type { TrackAction } from "./types";

export type RepeatConfig = {
  action: TrackAction;
  repeatStartMs: number;
  repeatEndMs?: number | null;
  repeatMode?: string | null;
  onNaturalEnd?: () => void;
};

export class AudioEngine {
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
  readonly duckedMusicLevel = 0.30;
  readonly interludeFadeDurationMs = 5000;
  readonly fadeEndDurationMs = 5000;

  constructor() {
    this.interlude.loop = true;

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

    this.bindMainEnded();
    await this.main.play();
    this.startRepeatMonitor();
  }

  stopMain() {
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
    if (!this.isMainPlaying()) return;

    await this.fade(this.main, this.main.volume, 0, durationMs);
    this.main.volume = 0;
    this.hardStopMain();
    this.main.volume = this.musicVolume;
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

        const crossfadeLead =
          config.repeatStartMs === 0
            ? this.drumRollRepeatCrossfadeMs
            : this.repeatCrossfadeMs;

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
    incoming.src = this.mainUrl;
    incoming.currentTime = Math.max(0, repeatStartMs) / 1000;
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
    outgoing.volume = targetVolume;

    try {
      await outgoing.play();
    } catch {}

    window.setTimeout(() => {
      incoming.pause();
      incoming.removeAttribute("src");
      incoming.volume = 0;
      this.repeatCrossfadeActive = false;
    }, 80);
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

  async playInterlude(url: string, volume: number) {
    this.interlude.pause();

    if (this.interlude.src !== url) {
      this.interlude.src = url;
      this.interlude.load();
    }

    try { this.interlude.currentTime = 0; } catch {}
    this.interlude.loop = true;
    this.interlude.volume = Math.max(0, Math.min(1, volume));

    // Called directly from the Interlude Play button so this remains inside
    // the iOS/iPadOS user gesture required by Safari media playback.
    await this.interlude.play();
  }

  setInterludeVolume(volume: number) {
    this.interlude.volume = Math.max(0, Math.min(1, volume));
  }

  isInterludePlaying(): boolean {
    return !this.interlude.paused && !this.interlude.ended;
  }

  async fadeInterludeToStop(
    durationMs = this.interludeFadeDurationMs,
    onVolume?: (value: number) => void
  ) {
    if (!this.isInterludePlaying()) return;

    await this.fade(
      this.interlude,
      this.interlude.volume,
      0,
      durationMs,
      onVolume
    );

    this.interlude.pause();
    this.interlude.currentTime = 0;
  }

  stopInterludeImmediately() {
    this.interlude.pause();
    try { this.interlude.currentTime = 0; } catch {}
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
      this.duckMusicForCue(duckDurationMs, duckLevel);
    }, Math.max(0, delayMs - 10));

    return true;
  }

  async playCueFile(
    filename: string,
    duckDurationMs = 950,
    duckLevel = this.duckedMusicLevel
  ) {
    // Keep the Windows cue itself untouched.
    this.duckMusicForCue(duckDurationMs, duckLevel);

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
      this.duckMusicForCue(fallbackMs + 250, endingDuckLevel);

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
    this.duckMusicForCue(durationMs + 250, endingDuckLevel);

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


  private duckMusicForCue(durationMs = 900, level = this.duckedMusicLevel) {
    if (!this.isMainPlaying()) return;

    this.duckGeneration += 1;
    const generation = this.duckGeneration;

    const normalLevel = this.musicVolume;
    const duckLevel = Math.max(0, Math.min(normalLevel, level));

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
