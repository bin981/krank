import {
  type EngineSpec,
  type CylGeom,
  PRESETS,
  buildCylinders,
  computeDims,
  redlineRpm,
  estimatePower,
  smoothstep,
  clamp,
} from "./model";

export type FailId = "rod" | "gasket" | "turbo" | "timing" | "seizure";

export class Simulation {
  spec: EngineSpec = { ...PRESETS[2].spec };
  cyls: CylGeom[] = [];
  throttle = 0.45;
  /** 0..1 yağ seviyesi. Düşük seviye yağ basıncını çökertir. */
  oilLevel = 1;
  radiatorBlocked = false;

  targetRpm = 2400;
  rpm = 2400;
  /** Devir saatinde görünen, rölanti salınımı dahil. */
  indicatedRpm = 2400;
  /** Sürekli artan krank açısı, derece. */
  crankDeg = 15;
  running = true;

  coolant = 90;
  oil = 3.2;
  boost = 0.2;
  torqueNm = 0;
  powerKw = 0;
  powerPs = 0;

  shake = 0;
  knock = 0;
  time = 0;

  rodStage: 0 | 1 | 2 = 0;
  rodAge = 0;
  rodCylinder = 1;
  punch = false;
  gasket = false;
  leakCyls = new Set<number>();
  turboFail = false;
  timing = false;
  heatSeize = false;
  seized = false;

  message = "Motor düzgün çalışıyor";
  messageLevel: "ok" | "warn" | "bad" = "ok";

  abuse = { rev: 0, heat: 0, oil: 0, boost: 0 };
  events: string[] = [];

  constructor() {
    this.rebuildCyls();
  }

  setSpec(spec: EngineSpec): void {
    this.spec = { ...spec };
    this.rebuildCyls();
    this.clearFailures();
    const red = redlineRpm(this.spec);
    this.targetRpm = clamp(this.targetRpm, 0, red * 1.18);
    this.rpm = clamp(this.rpm, 0, red * 1.18);
  }

  reset(): void {
    const red = redlineRpm(this.spec);
    this.throttle = 0.45;
    this.oilLevel = 1;
    this.radiatorBlocked = false;
    this.targetRpm = Math.min(2200, red * 0.45);
    this.rpm = this.targetRpm;
    this.crankDeg = 20;
    this.running = true;
    this.coolant = 90;
    this.oil = 3;
    this.boost = 0;
    this.clearFailures();
  }

  clearFailures(): void {
    this.rodStage = 0;
    this.rodAge = 0;
    this.punch = false;
    this.gasket = false;
    this.leakCyls.clear();
    this.turboFail = false;
    this.timing = false;
    this.heatSeize = false;
    this.seized = false;
    this.knock = 0;
    this.shake = 0;
    this.abuse = { rev: 0, heat: 0, oil: 0, boost: 0 };
    this.message = "Motor düzgün çalışıyor";
    this.messageLevel = "ok";
    this.events.push("reset");
  }

  trigger(id: FailId): void {
    if (this.seized && id !== "gasket") return;
    if (id === "rod" && this.rodStage === 0) {
      this.rodStage = 1;
      this.rodAge = 0;
      this.rodCylinder = Math.min(1, this.cyls.length - 1);
      this.knock = 0.15;
      this.say("Biyelde vuruntu başlıyor — yatak eziliyor", "warn");
      this.events.push("knock");
      this.abuse.rev = Math.max(this.abuse.rev, 0.85);
    } else if (id === "gasket" && !this.gasket) {
      this.gasket = true;
      const n = this.cyls.length;
      const a = Math.max(0, Math.floor(n / 2) - 1);
      this.leakCyls = new Set([a, Math.min(n - 1, a + 1)]);
      this.say("Conta kaçırıyor — su, yanma odasına giriyor", "warn");
      this.events.push("hiss");
      this.abuse.heat = 0.2;
    } else if (id === "turbo" && this.spec.aspiration === "turbo" && !this.turboFail) {
      this.turboFail = true;
      this.say("Turbo yatakları dağıldı — yağ yanıyor", "bad");
      this.events.push("whine");
      this.abuse.boost = 1;
    } else if (id === "timing" && !this.timing && !this.seized) {
      this.timing = true;
      this.say("Triger kayışı koptu", "bad");
      this.events.push("snap");
    } else if (id === "seizure" && !this.seized) {
      this.heatSeize = true;
      this.coolant = Math.max(this.coolant, 122);
      this.say("Aşırı hararet — yağ filmi yırtılıyor", "bad");
      this.abuse.heat = 1;
    }
  }

  /** Piston-supap çarpışması gibi dış olaylar. */
  impact(text: string): void {
    if (this.seized) return;
    this.events.push("bang");
    this.seize(text);
  }

  private seize(text: string): void {
    if (this.seized) return;
    this.seized = true;
    this.running = false;
    this.targetRpm = 0;
    this.say(text, "bad");
  }

  private say(text: string, level: "ok" | "warn" | "bad"): void {
    this.message = text;
    this.messageLevel = level;
  }

  isMisfire(index: number, atDeg = this.crankDeg): boolean {
    if (!this.gasket || !this.leakCyls.has(index)) return false;
    const cycle = Math.floor(atDeg / 720);
    return (index * 17 + cycle * 13) % 10 < 7;
  }

  update(dt: number): void {
    this.time += dt;
    const spec = this.spec;
    const red = redlineRpm(spec);

    if (this.rodStage === 1) {
      this.rodAge += dt;
      this.knock = clamp(this.rodAge / 2.15, 0, 1);
      if (this.rodAge > 2.25) {
        this.rodStage = 2;
        this.rodAge = 0;
        this.say("Biyel kırıldı", "bad");
        this.events.push("bang");
      }
    } else if (this.rodStage === 2) {
      this.rodAge += dt;
      this.knock = 1;
      if (!this.punch && this.rodAge > 0.38) {
        this.punch = true;
        this.events.push("punch");
        this.say("Biyel bloğu delip çıkıyor", "bad");
      }
      if (this.rodAge > 1.15) this.seize("Biyel bloğu deldi — motor kilitlendi");
    }

    if (this.heatSeize && !this.seized) {
      this.coolant = Math.min(145, this.coolant + dt * 3.2);
      if (this.coolant > 132) {
        this.seize("Motor sardı — piston gömlekte kilitlendi");
        this.events.push("grind");
      }
    }

    if (!this.seized && this.rodStage < 2) this.accumulateAbuse(red, dt);

    let goal = this.targetRpm;
    if (this.heatSeize) goal = Math.min(goal, 650);
    if (this.seized || this.rodStage === 2) goal = 0;
    const tau = this.seized || this.rodStage === 2 ? 0.22 : this.heatSeize ? 0.8 : 0.55;
    this.rpm += (goal - this.rpm) * (1 - Math.exp(-dt / tau));
    this.rpm = clamp(this.rpm, 0, red * 1.25);

    let wobble = 0;
    const healthySpin = !this.seized && this.rodStage === 0 && !this.gasket && !this.timing && !this.heatSeize;
    if (healthySpin && this.rpm > 550 && this.rpm < 1100) {
      wobble = Math.sin(this.time * 2.2) * 4;
    }
    if (this.gasket && !this.seized) wobble += Math.sin(this.time * 23) * 28;
    if (this.rodStage === 1) wobble += Math.sin(this.time * 47) * 40 * this.knock;
    if (this.timing && !this.seized) wobble += Math.sin(this.time * 31) * 22;

    const spin = Math.max(0, this.rpm + wobble);
    this.indicatedRpm = spin;
    this.crankDeg += spin * 6 * dt;

    const spool0 = spec.fuel === "dizel" ? 1250 : 1900;
    const spool1 = spec.fuel === "dizel" ? 2500 : 3600;
    let boostTarget = 0;
    if (spec.aspiration === "turbo" && !this.turboFail && !this.seized && this.rpm > 400) {
      boostTarget = spec.boostTarget * this.throttle * smoothstep(spool0, spool1, this.rpm);
    }
    const boostTau = boostTarget > this.boost ? 0.65 : 0.38;
    this.boost += (boostTarget - this.boost) * (1 - Math.exp(-dt / boostTau));
    if (this.boost < 0.01) this.boost = 0;

    const heatLoad = 86 + this.throttle * 16 + (this.rpm / red) * 10 + this.boost * 3.5;
    let coolTarget = this.radiatorBlocked ? Math.max(130, heatLoad + 18) : heatLoad;
    if (this.gasket) coolTarget += 16;
    if (this.heatSeize) coolTarget = 142;
    const coolTau = this.radiatorBlocked || this.gasket || this.heatSeize ? 4.5 : 11;
    this.coolant += (coolTarget - this.coolant) * (1 - Math.exp(-dt / coolTau));

    let oil = (0.65 + this.rpm / 1000 * 0.58) * (0.12 + 0.88 * this.oilLevel);
    if (this.coolant > 115) oil *= 0.72;
    if (this.rodStage === 1) oil *= 0.62;
    if (this.rodStage === 2) oil *= 0.28;
    if (this.seized || this.rpm < 200) oil *= 0.2;
    this.oil += (oil - this.oil) * (1 - Math.exp(-dt / 0.35));

    const est = this.seized || this.rpm < 250
      ? { torqueNm: 0, powerKw: 0, powerPs: 0 }
      : estimatePower(spec, this.rpm, this.throttle, this.boost);
    const health = (this.gasket ? 0.84 : 1) * (this.turboFail && spec.aspiration === "turbo" ? 0.95 : 1);
    this.torqueNm = est.torqueNm * health;
    this.powerKw = est.powerKw * health;
    this.powerPs = est.powerPs * health;

    const idleWindow = healthySpin && this.rpm > 450 && this.rpm < 1400;
    const idleVibe = idleWindow ? (1 - (this.rpm - 450) / 950) * 0.04 : 0;
    let fault = 0;
    if (this.rodStage === 1) fault += 0.62 + this.knock * 0.38;
    if (this.rodStage === 2) fault += 1;
    if (this.gasket && !this.seized) fault += 0.34;
    if (this.timing) fault += 0.48;
    if (this.heatSeize && !this.seized) fault += 0.44;
    if (this.seized && this.rodStage !== 2) fault += 0.2;
    const wantShake = idleVibe + fault;
    this.shake += (wantShake - this.shake) * (1 - Math.exp(-dt / 0.08));
    if (this.seized && this.rodStage !== 2) this.shake *= Math.max(0, 1 - dt * 0.4);

    if (this.message === "Motor düzgün çalışıyor" && (this.gasket || this.turboFail || this.rodStage > 0 || this.timing)) {
      /* mesaj arıza tarafından yönetilir */
    }
  }

  /** Bu karede sesin çalacağı ateşlemeler. Krank derecesi cinsinden anlar. */
  firesSince(prevCrank: number): { index: number; atDeg: number }[] {
    const delta = this.crankDeg - prevCrank;
    if (delta <= 0 || delta > 3000 || this.rpm < 180) return [];
    const start = prevCrank;
    const out: { index: number; atDeg: number }[] = [];
    for (const c of this.cyls) {
      let t = c.fireDeg;
      while (t <= start) t += 720;
      for (; t <= start + delta + 1e-6; t += 720) {
        if (this.isMisfire(c.index, t)) continue;
        out.push({ index: c.index, atDeg: t });
      }
    }
    return out;
  }

  private accumulateAbuse(red: number, dt: number): void {
    const a = this.abuse;
    if (this.rpm > red * 1.01 && this.throttle > 0.55 && this.rodStage === 0) a.rev = Math.min(1.2, a.rev + dt / 3.2);
    else a.rev = Math.max(0, a.rev - dt / 5);

    if (this.coolant > 114 && !this.gasket) a.heat = Math.min(1.2, a.heat + dt / 6);
    else if (this.gasket && this.coolant > 116 && !this.heatSeize) a.heat = Math.min(1.2, a.heat + dt / 8);
    else a.heat = Math.max(0, a.heat - dt / 6);

    if (this.oil < 1.05 && this.rpm > 2000 && this.rodStage === 0) a.oil = Math.min(1.2, a.oil + dt / 5);
    else a.oil = Math.max(0, a.oil - dt / 5);

    if (this.spec.aspiration === "turbo" && this.boost > 2.02 && this.throttle > 0.78 && !this.turboFail) {
      a.boost = Math.min(1.2, a.boost + dt / 5.5);
    } else a.boost = Math.max(0, a.boost - dt / 5);

    if (a.rev >= 1 || a.oil >= 1) this.trigger("rod");
    if (a.heat >= 1 && !this.gasket) this.trigger("gasket");
    else if (a.heat >= 1 && this.gasket && !this.heatSeize && !this.seized) this.trigger("seizure");
    if (a.boost >= 1) this.trigger("turbo");
  }

  private rebuildCyls(): void {
    this.cyls = buildCylinders(this.spec, computeDims(this.spec));
  }
}
