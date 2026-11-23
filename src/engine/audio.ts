import type { Simulation } from "./sim";

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor {
  const w = window as Window & { webkitAudioContext?: AudioCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? AudioContext;
}

function preferOgg(): boolean {
  const probe = document.createElement("audio");
  const can = probe.canPlayType('audio/ogg; codecs="vorbis"');
  return can === "probably" || can === "maybe";
}

interface Clip {
  rpm: number;
  file: string;
  family: "renault" | "ford" | "f20c" | "vw" | "peugeot" | "tdi";
}

const PETROL: Clip[] = [
  { rpm: 780, file: "petrol/renault19_underhood_780", family: "renault" },
  { rpm: 840, file: "petrol/under_bonnet_idle_840", family: "renault" },
  { rpm: 1200, file: "petrol/renault19_underhood_1200", family: "renault" },
  { rpm: 1340, file: "petrol/accord_cold_idle_1340", family: "renault" },
  { rpm: 2100, file: "petrol/renault19_underhood_2100", family: "renault" },
  { rpm: 2520, file: "petrol/renault19_underhood_2520", family: "renault" },
  { rpm: 3480, file: "petrol/renault19_underhood_3480", family: "renault" },
  { rpm: 4620, file: "petrol/renault19_underhood_4620", family: "renault" },
  { rpm: 5660, file: "petrol/renault19_underhood_5660", family: "renault" },
  { rpm: 900, file: "petrol/ford_ranger_900", family: "ford" },
  { rpm: 1980, file: "petrol/ford_ranger_1980", family: "ford" },
  { rpm: 2940, file: "petrol/ford_ranger_2940", family: "ford" },
  { rpm: 2640, file: "petrol/f20c_loop_2640", family: "f20c" },
  { rpm: 3600, file: "petrol/f20c_loop_3600", family: "f20c" },
  { rpm: 4020, file: "petrol/f20c_loop_4020", family: "f20c" },
  { rpm: 6180, file: "petrol/f20c_loop_6180", family: "f20c" },
];

const DIESEL: Clip[] = [
  { rpm: 720, file: "diesel/w124_idle_720", family: "vw" },
  { rpm: 900, file: "diesel/vw_diesel_900", family: "vw" },
  { rpm: 1800, file: "diesel/vw_diesel_1800", family: "vw" },
  { rpm: 2190, file: "diesel/vw_diesel_2190", family: "vw" },
  { rpm: 2440, file: "diesel/vw_diesel_2440", family: "vw" },
  { rpm: 3060, file: "diesel/vw_diesel_3060", family: "vw" },
  { rpm: 1080, file: "diesel/p306td_loop_1080", family: "peugeot" },
  { rpm: 2040, file: "diesel/p306td_loop_2040", family: "peugeot" },
  { rpm: 2640, file: "diesel/p306td_loop_2640", family: "peugeot" },
  { rpm: 3600, file: "diesel/p306td_loop_3600", family: "peugeot" },
  { rpm: 1560, file: "diesel/tdi_loop_1560", family: "tdi" },
  { rpm: 2000, file: "diesel/tdi_loop_2000", family: "tdi" },
  { rpm: 2500, file: "diesel/tdi_loop_2500", family: "tdi" },
];

interface Voice {
  rpm: number;
  family: string;
  gain: GainNode;
  src: AudioBufferSourceNode;
}

/**
 * Kayıtlı motor döngüleri. Komşu döngüler eşit güçlü karışır,
 * her döngü hedef devir / kendi devri kadar (±%15) hızlanır.
 * Sentez yalnızca vuruntu, tekleme ve supap sesi için kısık kalır.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: GainNode | null = null;
  private voiceFilter: BiquadFilterNode | null = null;
  private fault: GainNode | null = null;
  private voices: Voice[] = [];
  private loadedFuel: "benzin" | "dizel" | null = null;
  private loadToken = 0;
  private starter: AudioBufferSourceNode | null = null;
  private starterGain: GainNode | null = null;
  private starterKey = "";
  private starterBufs = new Map<string, AudioBuffer>();
  private knockBuf: AudioBuffer | null = null;
  private popBuf: AudioBuffer | null = null;
  private knockAcc = 0;
  volume = 0.8;
  mixExhaust = 0.85;
  mixIntake = 0.55;
  mixMech = 0.4;
  muted = false;
  ready = false;

  async start(): Promise<void> {
    const Ctor = audioCtor();
    if (!this.ctx) {
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 3;
      comp.attack.value = 0.005;
      comp.release.value = 0.18;
      master.connect(comp);
      comp.connect(ctx.destination);
      this.master = master;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 4200;
      const voice = ctx.createGain();
      voice.gain.value = 0;
      voice.connect(filter);
      filter.connect(master);
      this.voice = voice;
      this.voiceFilter = filter;

      const fault = ctx.createGain();
      fault.gain.value = 0.35;
      fault.connect(master);
      this.fault = fault;

      const starterGain = ctx.createGain();
      starterGain.gain.value = 0;
      starterGain.connect(master);
      this.starterGain = starterGain;

      this.knockBuf = noiseBurst(ctx, 0.045, 1400);
      this.popBuf = noiseBurst(ctx, 0.11, 180);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.ready = this.ctx.state === "running";
  }

  update(sim: Simulation): void {
    if (!this.ctx || !this.master || !this.voice || !this.voiceFilter || !this.starterGain) {
      sim.events.length = 0;
      return;
    }
    const now = this.ctx.currentTime;
    const vol = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(vol, now, 0.05);

    const fuel = sim.spec.fuel === "dizel" ? "dizel" : "benzin";
    if (this.loadedFuel !== fuel) {
      this.loadedFuel = fuel;
      void this.loadFuel(fuel);
    }

    const rpm = Math.max(0, sim.rpm);
    const cranking = sim.cranking;
    const alive = rpm > 280 && !sim.seized && !cranking && !sim.noFuel;
    const load = sim.throttle;
    const vtec = sim.vtecEngaged > 0.55 || (sim.camId !== "stock" && rpm > 4200);
    const high = fuel === "benzin" ? smooth(rpm, vtec ? 3000 : 4600, vtec ? 5200 : 6000) : smooth(rpm, 2400, 3400);
    const ford = fuel === "benzin" ? (1 - high) * (1 - smooth(rpm, 1600, 2800)) * 0.42 : 0;
    const weights: Record<string, number> = fuel === "benzin"
      ? { renault: (1 - high) * (1 - ford * 0.35), ford, f20c: high }
      : { vw: 1 - high * 0.65, peugeot: high * 0.7, tdi: 0.28 * (1 - Math.abs(high - 0.4)) };

    const sum = Object.values(weights).reduce((s, n) => s + Math.max(0, n), 0) || 1;
    for (const key of Object.keys(weights)) weights[key] = Math.max(0, weights[key]) / sum;

    const families = new Set(this.voices.map((v) => v.family));
    for (const family of families) {
      const group = this.voices.filter((v) => v.family === family).sort((a, b) => a.rpm - b.rpm);
      const pair = neighbors(group, rpm);
      for (const voice of group) {
        const share = pair.a === voice ? pair.ga : pair.b === voice ? pair.gb : 0;
        const amp = share * (weights[family] ?? 0);
        voice.gain.gain.setTargetAtTime(amp, now, 0.08);
        const rate = clamp(rpm > 40 ? rpm / voice.rpm : 1, 0.85, 1.15);
        voice.src.playbackRate.setTargetAtTime(rate, now, 0.08);
      }
    }

    const heard = alive || (cranking && rpm > 80);
    const level = heard ? (0.62 + load * 0.38) * (0.75 + this.mixExhaust * 0.25) : 0;
    this.voice.gain.setTargetAtTime(cranking ? 0 : level, now, 0.06);
    const cut = 900 + load * 5200 + Math.min(rpm, 6000) * 0.35 + (vtec ? 800 : 0);
    this.voiceFilter.frequency.setTargetAtTime(Math.max(280, cut), now, 0.08);
    this.voiceFilter.Q.setTargetAtTime(0.7 + load * 0.4, now, 0.1);

    this.driveStarter(sim, now, fuel);

    if ((sim.rodStage >= 1 || sim.oil < 1) && alive) {
      this.knockAcc += 1 / 60;
      if (this.knockAcc > (sim.rodStage >= 1 ? 0.11 : 0.2)) {
        this.knockAcc = 0;
        this.blip(this.knockBuf, sim.rodStage >= 1 ? 0.22 : 0.08, now);
      }
    } else this.knockAcc = 0;

    if (sim.misfireCyl >= 0 && alive && Math.random() < 0.12) this.blip(this.popBuf, 0.16, now);
    if (sim.valveWarn && Math.random() < 0.03) this.blip(this.knockBuf, 0.12, now);
    for (const event of sim.events) {
      if (event === "bang" || event === "punch" || event === "clash" || event === "grind") this.blip(this.knockBuf, 0.28, now);
      else if (event === "snap") this.blip(this.popBuf, 0.12, now);
    }
    sim.events.length = 0;
  }

  private driveStarter(sim: Simulation, now: number, fuel: "benzin" | "dizel"): void {
    if (!sim.cranking) {
      this.starterGain?.gain.setTargetAtTime(0, now, 0.08);
      if (this.starter && this.starterGain && this.starterGain.gain.value < 0.01) {
        try { this.starter.stop(); } catch { /* bitti */ }
        this.starter = null;
        this.starterKey = "";
      }
      return;
    }
    const weak = sim.batteryWeak || sim.noCrank;
    const key = weak ? "weak" : fuel === "dizel" ? "diesel" : "petrol";
    if (this.starterKey === key && this.starter) {
      this.starterGain?.gain.setTargetAtTime(weak ? 0.7 : 0.85, now, 0.05);
      return;
    }
    const buf = this.starterBufs.get(key);
    if (!buf || !this.ctx || !this.starterGain) return;
    try { this.starter?.stop(); } catch { /* yok */ }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = weak;
    src.connect(this.starterGain);
    src.start();
    this.starter = src;
    this.starterKey = key;
    this.starterGain.gain.setTargetAtTime(weak ? 0.7 : 0.85, now, 0.04);
  }

  private async loadFuel(fuel: "benzin" | "dizel"): Promise<void> {
    const ctx = this.ctx;
    const voice = this.voice;
    if (!ctx || !voice) return;
    const token = ++this.loadToken;
    for (const v of this.voices) {
      try { v.src.stop(); } catch { /* */ }
      v.src.disconnect();
      v.gain.disconnect();
    }
    this.voices = [];
    const clips = fuel === "dizel" ? DIESEL : PETROL;
    const ext = preferOgg() ? "ogg" : "mp3";
    await Promise.all(clips.map(async (clip) => {
      const buffer = await fetchBuffer(ctx, `${import.meta.env.BASE_URL}sounds/${clip.file}`, ext);
      if (!buffer || token !== this.loadToken || !this.voice) return;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.voice);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(gain);
      src.start();
      this.voices.push({ rpm: clip.rpm, family: clip.family, gain, src });
    }));
    if (token !== this.loadToken) return;
    const starters: { key: string; file: string }[] = fuel === "dizel"
      ? [
          { key: "diesel", file: "starter/diesel_start_idle_revs" },
          { key: "weak", file: "starter/citroen_xantia_20hdi_start_attempts" },
        ]
      : [
          { key: "petrol", file: "starter/honda_accord_petrol_start_enginebay" },
          { key: "weak", file: "starter/car_not_starting_weak_crank" },
        ];
    await Promise.all(starters.map(async (s) => {
      const buffer = await fetchBuffer(ctx, `${import.meta.env.BASE_URL}sounds/${s.file}`, ext);
      if (buffer && token === this.loadToken) this.starterBufs.set(s.key, buffer);
    }));
  }

  private blip(buffer: AudioBuffer | null, gain: number, when: number): void {
    if (!buffer || !this.ctx || !this.fault || gain <= 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain * this.mixMech;
    src.connect(g);
    g.connect(this.fault);
    try { src.start(Math.max(this.ctx.currentTime, when)); } catch { /* */ }
  }
}

function neighbors(group: Voice[], rpm: number): { a: Voice | null; b: Voice | null; ga: number; gb: number } {
  if (!group.length) return { a: null, b: null, ga: 0, gb: 0 };
  if (group.length === 1 || rpm <= group[0].rpm) return { a: group[0], b: null, ga: 1, gb: 0 };
  const last = group[group.length - 1];
  if (rpm >= last.rpm) return { a: last, b: null, ga: 1, gb: 0 };
  let i = 0;
  while (i < group.length - 1 && group[i + 1].rpm < rpm) i++;
  const a = group[i];
  const b = group[i + 1];
  const t = (rpm - a.rpm) / Math.max(1, b.rpm - a.rpm);
  return { a, b, ga: Math.cos(t * Math.PI * 0.5), gb: Math.sin(t * Math.PI * 0.5) };
}

function smooth(v: number, a: number, b: number): number {
  const t = clamp((v - a) / Math.max(1, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

async function fetchBuffer(ctx: AudioContext, path: string, ext: "ogg" | "mp3"): Promise<AudioBuffer | null> {
  const order = ext === "ogg" ? ["ogg", "mp3"] : ["mp3", "ogg"];
  for (const tryExt of order) {
    try {
      const res = await fetch(`${path}.${tryExt}`);
      if (!res.ok) continue;
      const data = await res.arrayBuffer();
      return await ctx.decodeAudioData(data.slice(0));
    } catch {
      /* diğer kodlayıcı */
    }
  }
  return null;
}

function noiseBurst(ctx: AudioContext, seconds: number, hz: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.exp(-t * (seconds < 0.06 ? 70 : 16));
    data[i] = ((Math.random() * 2 - 1) * 0.7 + Math.sin(Math.PI * 2 * hz * t) * 0.3) * env;
  }
  return buffer;
}
