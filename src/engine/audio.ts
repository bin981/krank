import type { Simulation } from "./sim";
import { camCard, redlineRpm } from "./model";
import { LAYOUTS } from "./model";

type Bus = "exhaust" | "intake" | "mech";

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

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor {
  const w = window as Window & { webkitAudioContext?: AudioCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? AudioContext;
}

/**
 * Prosedürel motor sesi. Kayıtlı örnek yok.
 * Her silindir, krank açısına ve ateşleme sırasına kilitli bir darbe üretir.
 * Egzoz, emme ve mekanik katmanları ayrı kazançla karışır.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private exhaust: GainNode | null = null;
  private intake: GainNode | null = null;
  private mech: GainNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;
  private exhaustPeak: BiquadFilterNode | null = null;
  private intakeFilter: BiquadFilterNode | null = null;
  private body: OscillatorNode | null = null;
  private bodyGain: GainNode | null = null;
  private turbo: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private howl: OscillatorNode | null = null;
  private howlGain: GainNode | null = null;
  private starter: OscillatorNode | null = null;
  private starterGain: GainNode | null = null;
  private gas: AudioBuffer | null = null;
  private diesel: AudioBuffer | null = null;
  private clatter: AudioBuffer | null = null;
  private pop: AudioBuffer | null = null;
  private knock: AudioBuffer | null = null;
  private tick: AudioBuffer | null = null;
  private blow: AudioBuffer | null = null;
  private chug: AudioBuffer | null = null;
  private clash: AudioBuffer | null = null;
  private prevCrank = 0;
  private prevThrottle = 0.45;
  private prevBoost = 0;
  private prevVtec = 0;
  private howlLeft = 0;
  private knockAcc = 0;
  private tickAcc = 0;
  private chugAcc = 0;
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
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.16;
      master.connect(comp);
      comp.connect(ctx.destination);
      this.master = master;

      const exhaust = ctx.createGain();
      const exhaustFilter = ctx.createBiquadFilter();
      exhaustFilter.type = "lowpass";
      exhaustFilter.frequency.value = 900;
      const exhaustPeak = ctx.createBiquadFilter();
      exhaustPeak.type = "peaking";
      exhaustPeak.Q.value = 3.2;
      exhaustPeak.gain.value = 5;
      exhaust.connect(exhaustFilter);
      exhaustFilter.connect(exhaustPeak);
      exhaustPeak.connect(master);
      this.exhaust = exhaust;
      this.exhaustFilter = exhaustFilter;
      this.exhaustPeak = exhaustPeak;

      const intake = ctx.createGain();
      const intakeFilter = ctx.createBiquadFilter();
      intakeFilter.type = "bandpass";
      intakeFilter.Q.value = 1.4;
      intakeFilter.frequency.value = 700;
      intake.connect(intakeFilter);
      intakeFilter.connect(master);
      this.intake = intake;
      this.intakeFilter = intakeFilter;

      const mech = ctx.createGain();
      const mechFilter = ctx.createBiquadFilter();
      mechFilter.type = "highpass";
      mechFilter.frequency.value = 180;
      mech.connect(mechFilter);
      mechFilter.connect(master);
      this.mech = mech;

      const body = ctx.createOscillator();
      body.type = "sawtooth";
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = 0;
      const bodyFilter = ctx.createBiquadFilter();
      bodyFilter.type = "lowpass";
      bodyFilter.frequency.value = 280;
      body.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(exhaust);
      body.start();
      this.body = body;
      this.bodyGain = bodyGain;

      const turbo = ctx.createOscillator();
      turbo.type = "sine";
      const turboGain = ctx.createGain();
      turboGain.gain.value = 0;
      const turboFilter = ctx.createBiquadFilter();
      turboFilter.type = "bandpass";
      turboFilter.frequency.value = 2200;
      turboFilter.Q.value = 8;
      turbo.connect(turboFilter);
      turboFilter.connect(turboGain);
      turboGain.connect(intake);
      turbo.start();
      this.turbo = turbo;
      this.turboGain = turboGain;

      const howl = ctx.createOscillator();
      howl.type = "sawtooth";
      const howlGain = ctx.createGain();
      howlGain.gain.value = 0;
      const howlFilter = ctx.createBiquadFilter();
      howlFilter.type = "bandpass";
      howlFilter.frequency.value = 1400;
      howlFilter.Q.value = 4;
      howl.connect(howlFilter);
      howlFilter.connect(howlGain);
      howlGain.connect(intake);
      howl.start();
      this.howl = howl;
      this.howlGain = howlGain;

      const starter = ctx.createOscillator();
      starter.type = "square";
      starter.frequency.value = 58;
      const starterGain = ctx.createGain();
      starterGain.gain.value = 0;
      starter.connect(starterGain);
      starterGain.connect(mech);
      starter.start();
      this.starter = starter;
      this.starterGain = starterGain;

      this.gas = renderBuffer(ctx, 0.09, (t) => {
        const env = Math.exp(-t * 28) * (1 - Math.exp(-t * 400));
        const tone = Math.sin(Math.PI * 2 * (90 + 40 * Math.exp(-t * 30)) * t);
        return (tone * 0.65 + (Math.random() * 2 - 1) * 0.35) * env;
      });
      this.diesel = renderBuffer(ctx, 0.045, (t) => {
        const env = Math.exp(-t * 90);
        return ((Math.random() * 2 - 1) * 0.85 + Math.sin(Math.PI * 2 * 240 * t) * 0.3) * env;
      });
      this.clatter = renderBuffer(ctx, 0.02, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 220) * Math.sin(Math.PI * 2 * 1800 * t));
      this.pop = renderBuffer(ctx, 0.12, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 18) * (0.4 + 0.6 * Math.sin(Math.PI * 2 * 70 * t)));
      this.knock = renderBuffer(ctx, 0.04, (t) => {
        const env = Math.exp(-t * 80);
        return (Math.sin(Math.PI * 2 * 1800 * t) * 0.35 + (Math.random() * 2 - 1) * 0.65) * env;
      });
      this.tick = renderBuffer(ctx, 0.012, (t) => Math.sin(Math.PI * 2 * 3200 * t) * Math.exp(-t * 280));
      this.blow = renderBuffer(ctx, 0.28, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 8) * Math.sin(Math.PI * t * 12));
      this.chug = renderBuffer(ctx, 0.08, (t) => (Math.sin(Math.PI * 2 * 55 * t) * 0.7 + (Math.random() * 2 - 1) * 0.3) * Math.exp(-t * 22));
      this.clash = renderBuffer(ctx, 0.2, (t) => {
        const env = Math.exp(-t * 10);
        return (Math.sin(Math.PI * 2 * (400 * Math.exp(-t * 6)) * t) + (Math.random() * 2 - 1) * 0.5) * env;
      });
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.ready = this.ctx.state === "running";
  }

  update(sim: Simulation): void {
    if (!this.ctx || !this.master || !this.exhaust || !this.intake || !this.mech || !this.body || !this.bodyGain) {
      sim.events.length = 0;
      this.prevCrank = sim.crankDeg;
      return;
    }
    const now = this.ctx.currentTime;
    const vol = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(vol, now, 0.03);
    this.exhaust.gain.setTargetAtTime(this.mixExhaust, now, 0.04);
    this.intake.gain.setTargetAtTime(this.mixIntake, now, 0.04);
    this.mech.gain.setTargetAtTime(this.mixMech, now, 0.04);

    for (const event of sim.events) {
      if (event === "bang" || event === "punch" || event === "grind" || event === "clash") this.play(this.clash, 0.7, now, "mech");
      else if (event === "snap") this.play(this.tick, 0.5, now, "mech");
      else if (event === "vtec") this.howlLeft = 0.45;
      else if (event === "catch") this.play(this.gas, 0.6, now, "exhaust");
    }
    sim.events.length = 0;

    const diesel = sim.spec.fuel === "dizel";
    const n = Math.max(1, sim.cyls.length || LAYOUTS[sim.spec.layout].cylinders);
    const fireHz = Math.max(8, (Math.max(sim.rpm, 0) * n) / 120);
    const cranking = sim.cranking;
    const alive = sim.rpm > 280 && !sim.seized && !cranking && !sim.noFuel;
    const load = sim.throttle;
    const card = camCard(sim.camId);
    const lumpy = card.advertised >= 272 && sim.rpm < 1400 && alive;
    const vtec = sim.vtecEngaged > 0.55;

    this.body.type = diesel ? "square" : "sawtooth";
    this.body.frequency.setTargetAtTime(cranking ? (sim.batteryWeak ? 36 : 58) : Math.max(16, fireHz * (lumpy ? 0.5 : 1)), now, 0.05);
    const bodyAmp = cranking ? 0.08 : alive ? Math.min(0.12, 0.02 + sim.rpm / 18000) * (0.45 + load * 0.7) * (diesel ? 0.55 : 1) : 0;
    this.bodyGain.gain.setTargetAtTime(bodyAmp, now, 0.05);

    if (this.exhaustFilter && this.exhaustPeak) {
      const cut = 420 + load * 1600 + sim.rpm * 0.12 + (vtec ? 500 : 0) + (lumpy ? -180 : 0);
      this.exhaustFilter.frequency.setTargetAtTime(Math.max(180, cut), now, 0.05);
      const helm = 70 + fireHz * (diesel ? 1.4 : 2.1) * (0.7 + load * 0.5);
      this.exhaustPeak.frequency.setTargetAtTime(Math.max(50, Math.min(900, helm)), now, 0.08);
    }
    if (this.intakeFilter) {
      const howl = 500 + sim.rpm * 0.22 + (vtec ? 900 : 0) + this.howlLeft * 600;
      this.intakeFilter.frequency.setTargetAtTime(howl, now, 0.05);
    }

    if (this.turbo && this.turboGain) {
      const spool = sim.spec.aspiration === "turbo" && (alive || sim.boost > 0.15);
      const flutter = sim.turboFail ? Math.sin(sim.time * 90) * 400 : 0;
      this.turbo.frequency.setTargetAtTime(Math.max(80, 280 + sim.rpm * 0.22 + sim.boost * 1600 + flutter), now, 0.04);
      const whistle = spool ? Math.min(0.12, 0.01 + sim.boost * 0.08) * (vtec ? 0.8 : 1) : 0;
      this.turboGain.gain.setTargetAtTime(whistle, now, 0.05);
    }
    if (this.howl && this.howlGain) {
      this.howl.frequency.setTargetAtTime(900 + sim.rpm * 0.18, now, 0.05);
      this.howlLeft = Math.max(0, this.howlLeft - 1 / 60);
      const howlAmp = (vtec ? 0.03 + load * 0.04 : 0) + this.howlLeft * 0.08;
      this.howlGain.gain.setTargetAtTime(alive ? howlAmp : 0, now, 0.05);
    }
    if (this.starter && this.starterGain) {
      this.starter.frequency.setTargetAtTime(sim.batteryWeak ? 34 : 62, now, 0.05);
      this.starterGain.gain.setTargetAtTime(cranking ? 0.12 : 0, now, 0.03);
    }

    if (load < this.prevThrottle - 0.18 && this.prevBoost > 0.35) {
      this.play(this.blow, 0.45, now, "intake");
    }
    this.prevThrottle = load;
    this.prevBoost = sim.boost;
    if (sim.vtecEngaged > 0.55 && this.prevVtec <= 0.55) this.howlLeft = 0.5;
    this.prevVtec = sim.vtecEngaged;

    if (cranking) {
      this.chugAcc += 1 / 60;
      const gap = sim.batteryWeak ? 0.14 : 0.09;
      if (this.chugAcc > gap) {
        this.chugAcc = 0;
        this.play(this.chug, 0.35, now, "mech");
      }
      this.prevCrank = sim.crankDeg;
      return;
    }

    const red = redlineRpm(sim.spec);
    const limited = alive && sim.rpm >= red * 0.995;
    const fires = sim.firesSince(this.prevCrank);
    const rate = Math.max(40, sim.rpm * 6);
    let played = 0;
    for (const fire of fires) {
      if (played > 32) break;
      const miss = sim.isMisfire(fire.index);
      const when = now + Math.max(0, (fire.atDeg - this.prevCrank) / rate);
      const gap = 720 / n;
      const odd = Math.abs((fire.atDeg % 720) - fire.index * gap) > 20 ? 1.15 : 1;
      const lump = lumpy ? (fire.index % 2 === 0 ? 1.25 : 0.45) : 1;
      const cut = limited && fire.index % 2 === 0;
      if (cut || miss) {
        this.play(this.pop, (miss ? 0.35 : 0.22) * (0.4 + load), when, "exhaust");
      } else if (alive) {
        const pulse = diesel ? this.diesel : this.gas;
        const amp = (diesel ? 0.5 : 0.34) * (0.35 + load * 0.75) * odd * lump * (sim.seized ? 0 : 1);
        this.play(pulse, amp, when, "exhaust");
        if (diesel) this.play(this.clatter, 0.28 * (0.6 + load * 0.4), when - 0.002, "mech");
        if (load < 0.2) this.play(this.pop, 0.05, when, "intake");
      }
      played++;
    }
    this.prevCrank = sim.crankDeg;

    if (sim.rodStage >= 1 || sim.oil < 1) {
      this.knockAcc += 1 / 60;
      const gap = sim.rodStage >= 1 ? 0.09 : 0.16;
      if (this.knockAcc > gap) {
        this.knockAcc = 0;
        this.play(this.knock, sim.rodStage >= 1 ? 0.35 + sim.knock * 0.4 : 0.12, now, "mech");
      }
    } else this.knockAcc = 0;

    const lifter = sim.oil < 1.3 || sim.vtecBlocked || sim.cold;
    if (lifter && alive) {
      this.tickAcc += sim.rpm / 120 / 60;
      if (this.tickAcc > 1) {
        this.tickAcc = 0;
        this.play(this.tick, 0.18, now, "mech");
      }
    }
    if (sim.spec.timingDrive === "zincir" && alive && (sim.rpm < 1100 || sim.timing)) {
      if (Math.random() < 0.15) this.play(this.tick, 0.1, now, "mech");
    }
    if ((sim.cold && sim.rpm > 900 && sim.rpm < 2200) || sim.scenarioId === "water-pump") {
      if (Math.random() < 0.08) this.play(this.blow, 0.08, now, "mech");
    }
    if (sim.valveWarn && Math.random() < 0.04) this.play(this.clash, 0.25, now, "mech");
  }

  private play(buffer: AudioBuffer | null, gain: number, when: number, bus: Bus): void {
    if (!buffer || !this.ctx || gain <= 0.001) return;
    const dest = bus === "exhaust" ? this.exhaust : bus === "intake" ? this.intake : this.mech;
    if (!dest) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(dest);
    const t = Math.max(this.ctx.currentTime, when);
    try { src.start(t); } catch { /* zaman geride kaldı */ }
  }
}
