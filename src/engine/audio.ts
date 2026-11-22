import type { Simulation } from "./sim";

function renderBuffer(
  ctx: AudioContext,
  seconds: number,
  fn: (t: number, i: number) => number,
): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = fn(i / ctx.sampleRate, i);
  return buffer;
}

/**
 * Devirle yürüyen motor sesi: ateşleme anına kilitli tıklar,
 * gövde osilatörü, turbo ıslığı ve arıza katmanları.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private body: OscillatorNode | null = null;
  private bodyGain: GainNode | null = null;
  private sub: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private turbo: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private gasClick: AudioBuffer | null = null;
  private dieselClick: AudioBuffer | null = null;
  private bang: AudioBuffer | null = null;
  private knock: AudioBuffer | null = null;
  private crackle: AudioBuffer | null = null;
  private prevCrank = 0;
  private prevRpm = 0;
  private knockAcc = 0;
  muted = false;
  ready = false;

  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.ready = true;
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 16;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    const body = ctx.createOscillator();
    body.type = "sawtooth";
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0;
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.value = 420;
    body.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(master);
    body.start();
    this.body = body;
    this.bodyGain = bodyGain;

    const sub = ctx.createOscillator();
    sub.type = "sine";
    const subGain = ctx.createGain();
    subGain.gain.value = 0;
    sub.connect(subGain);
    subGain.connect(master);
    sub.start();
    this.sub = sub;
    this.subGain = subGain;

    const seconds = 1;
    const noiseBuf = renderBuffer(ctx, seconds, () => Math.random() * 2 - 1);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.Q.value = 0.7;
    noiseFilter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();
    this.noiseFilter = noiseFilter;
    this.noiseGain = noiseGain;

    const turbo = ctx.createOscillator();
    turbo.type = "sine";
    const turboFilter = ctx.createBiquadFilter();
    turboFilter.type = "bandpass";
    turboFilter.frequency.value = 1800;
    turboFilter.Q.value = 6;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turbo.connect(turboFilter);
    turboFilter.connect(turboGain);
    turboGain.connect(master);
    turbo.start();
    this.turbo = turbo;
    this.turboGain = turboGain;

    this.gasClick = renderBuffer(ctx, 0.07, (t) => {
      const env = Math.exp(-t * 46);
      return (Math.sin(Math.PI * 2 * 68 * t) * 0.75 + (Math.random() * 2 - 1) * 0.35) * env;
    });
    this.dieselClick = renderBuffer(ctx, 0.04, (t) => {
      const env = Math.exp(-t * 110);
      return ((Math.random() * 2 - 1) * 0.9 + Math.sin(Math.PI * 2 * 180 * t) * 0.25) * env;
    });
    this.bang = renderBuffer(ctx, 0.5, (t) => {
      const env = Math.exp(-t * 5.5);
      const freq = 120 * Math.exp(-t * 3.2);
      return (Math.sin(Math.PI * 2 * freq * t) * 0.8 + (Math.random() * 2 - 1) * 0.55) * env;
    });
    this.knock = renderBuffer(ctx, 0.045, (t) => {
      const env = Math.exp(-t * 70);
      return (Math.sin(Math.PI * 2 * 2100 * t) * 0.4 + (Math.random() * 2 - 1) * 0.6) * env;
    });
    this.crackle = renderBuffer(ctx, 0.06, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 40));

    if (ctx.state === "suspended") await ctx.resume();
    this.ready = true;
  }

  update(sim: Simulation): void {
    if (!this.ctx || !this.master || !this.body || !this.bodyGain || !this.sub || !this.subGain) {
      sim.events.length = 0;
      this.prevCrank = sim.crankDeg;
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, now, 0.03);

    for (const event of sim.events) {
      if (event === "bang" || event === "punch" || event === "grind") this.play(this.bang, event === "punch" ? 0.7 : 1);
      else if (event === "snap") this.play(this.crackle, 0.8);
      else if (event === "hiss") this.play(this.crackle, 0.35);
    }
    sim.events.length = 0;

    const cyl = Math.max(1, sim.cyls.length);
    const fireHz = Math.max(0, (sim.rpm * cyl) / 120);
    const diesel = sim.spec.fuel === "dizel";
    this.body.type = diesel ? "square" : "sawtooth";
    this.body.frequency.setTargetAtTime(Math.max(18, fireHz), now, 0.04);
    this.sub.frequency.setTargetAtTime(Math.max(12, fireHz * 0.5), now, 0.05);

    const alive = sim.rpm > 280 && !sim.seized;
    const load = sim.throttle * 0.75 + 0.25;
    const bodyAmp = alive ? Math.min(0.16, (0.03 + sim.rpm / 14000) * load) * (diesel ? 0.7 : 1) : 0;
    this.bodyGain.gain.setTargetAtTime(bodyAmp, now, 0.05);
    this.subGain.gain.setTargetAtTime(alive ? bodyAmp * (diesel ? 0.45 : 0.8) : 0, now, 0.05);
    if (this.noiseGain && this.noiseFilter) {
      this.noiseGain.gain.setTargetAtTime(alive ? 0.03 + sim.throttle * 0.06 : 0, now, 0.05);
      this.noiseFilter.frequency.setTargetAtTime(diesel ? 1400 + sim.rpm * 0.12 : 500 + sim.throttle * 1600 + sim.rpm * 0.08, now, 0.05);
    }

    if (this.turbo && this.turboGain) {
      const unstable = sim.turboFail;
      const wobble = unstable ? Math.sin(sim.time * 47) * 380 + Math.sin(sim.time * 130) * 160 : 0;
      const freq = 160 + sim.rpm * 0.16 + sim.boost * 1250 + wobble;
      this.turbo.frequency.setTargetAtTime(Math.max(40, freq), now, 0.03);
      const whine = sim.spec.aspiration === "turbo" && sim.rpm > 700
        ? (unstable ? 0.05 + Math.abs(Math.sin(sim.time * 30)) * 0.04 : Math.min(0.1, sim.boost * 0.07))
        : 0;
      this.turboGain.gain.setTargetAtTime(alive || unstable ? whine : 0, now, 0.04);
    }

    const fires = sim.firesSince(this.prevCrank);
    const rate = Math.max(30, sim.rpm * 6);
    const click = diesel ? this.dieselClick : this.gasClick;
    const amp = diesel ? 0.55 : 0.38;
    const thin = sim.rpm > 4500 ? 0.45 : sim.rpm > 2500 ? 0.75 : 1;
    let played = 0;
    for (const fire of fires) {
      if (played > 24) break;
      const when = now + Math.max(0, (fire.atDeg - this.prevCrank) / rate);
      this.play(click, amp * thin * (0.45 + sim.throttle * 0.7) * (sim.seized ? 0 : 1), when);
      played++;
    }
    this.prevCrank = sim.crankDeg;

    if (sim.rodStage === 1) {
      this.knockAcc += 1 / 60;
      const gap = 0.11 - sim.knock * 0.06;
      if (this.knockAcc > gap) {
        this.knockAcc = 0;
        this.play(this.knock, 0.25 + sim.knock * 0.6);
      }
    } else this.knockAcc = 0;

    if (sim.spec.fuel === "benzin" && sim.throttle < 0.12 && sim.rpm > 2600 && sim.rpm < this.prevRpm - 8 && Math.random() < 0.18) {
      this.play(this.crackle, 0.22);
    }
    this.prevRpm = sim.rpm;
  }

  private play(buffer: AudioBuffer | null, gain: number, when = this.ctx?.currentTime ?? 0): void {
    if (!buffer || !this.ctx || !this.master || gain <= 0.001) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start(when);
  }
}
