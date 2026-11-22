import {
  type EngineSpec,
  type CylGeom,
  presetByName,
  buildCylinders,
  computeDims,
  redlineRpm,
  estimatePower,
  smoothstep,
  clamp,
} from "./model";
import { applyScenario, scenarioById } from "../scenarios";

export type FailId = "rod" | "gasket" | "turbo" | "timing" | "seizure";
export type VibeMode = "off" | "low" | "real";
export type KeyPos = "off" | "acc" | "on" | "start";

export class Simulation {
  spec: EngineSpec = presetByName("2.0 Turbo");
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

  /** Atölye açıkken kontak ve akü devri yönetir. Dinamometrede kapalıdır. */
  workshop = false;
  key: KeyPos = "on";
  batteryIn = true;
  negOn = true;
  posOn = true;
  holdDown = true;
  batteryWeak = false;
  cranking = false;
  caught = true;
  crankAge = 0;
  /** Kullanıcının istediği devir; atölyede motor tutunca hedef olur. */
  requestedRpm = 2400;
  vtecForce = false;
  /** 0..1, pim kayması. */
  vtecEngaged = 0;
  /** 0..1 kızdırma. */
  glow = 0;
  voltage = 12.6;
  bayMessage = "";
  bayLevel: "ok" | "warn" | "bad" = "ok";
  /** Kapalı / Az / Gerçekçi. Az varsayılan. prefers-reduced-motion Kapalı sayılır. */
  vibe: VibeMode = "low";
  scenarioId = "none";
  scenarioAge = 0;
  smoke: "none" | "white" | "blue" | "black" = "none";
  lamps = { bat: false, oil: false, temp: false, cel: false, glow: false };
  misfireCyl = -1;
  vtecBlocked = false;
  noFuel = false;
  limp = false;
  starterDead = false;
  noCrank = false;
  alternatorDead = false;
  boostLeak = false;
  cold = false;
  railBar = 400;
  stft = 0;
  ltft = 0;
  camId = "stock";
  /** Lob ayrım açısı, kam derecesi. */
  camLsa = 110;
  /** Krank derecesi. Artı = avans. */
  camAdvance = 0;
  vacuum = 62;
  valveWarn = false;
  private clashAcc = 0;

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

  setWorkshop(on: boolean): void {
    if (on === this.workshop) return;
    this.workshop = on;
    if (on) {
      this.key = "off";
      this.caught = false;
      this.cranking = false;
      this.crankAge = 0;
      this.targetRpm = 0;
      this.rpm = Math.min(this.rpm, 400);
      this.bayMessage = "Kontak kapalı. Akü bağlıysa marşa bas.";
      this.bayLevel = "ok";
    } else {
      this.cranking = false;
      this.caught = true;
      this.key = "on";
      this.targetRpm = this.requestedRpm;
    }
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
    if (this.misfireCyl === index) return true;
    if (!this.gasket || !this.leakCyls.has(index)) return false;
    const cycle = Math.floor(atDeg / 720);
    return (index * 17 + cycle * 13) % 10 < 7;
  }

  /** 0 = yok, 0.1 = Az (sağlıklı titreşimin onda biri), 0.35 = Gerçekçi. */
  vibeGain(): number {
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || this.vibe === "off") return 0;
    return this.vibe === "low" ? 0.1 : 0.35;
  }

  setScenario(id: string): void {
    this.scenarioId = id;
    this.scenarioAge = 0;
    this.misfireCyl = -1;
    this.vtecBlocked = false;
    this.noFuel = false;
    this.limp = false;
    this.starterDead = false;
    this.noCrank = false;
    this.alternatorDead = false;
    this.boostLeak = false;
    this.cold = false;
    this.batteryWeak = false;
    this.stft = 0;
    this.ltft = 0;
    this.railBar = this.spec.fuel === "dizel" ? 1400 : 3.5;
    this.smoke = "none";
    if (id !== "none") scenarioById(id)?.prime?.(this);
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

    this.stepWorkshop(dt);
    const vtecSwitch = spec.vtecRpm ?? 5500;
    const wantVtec = !this.vtecBlocked && spec.valvetrain === "dohc16-vtec" && (this.vtecForce || this.rpm >= vtecSwitch);
    const prevVtec = this.vtecEngaged;
    this.vtecEngaged += ((wantVtec ? 1 : 0) - this.vtecEngaged) * (1 - Math.exp(-dt / 0.07));
    if (prevVtec < 0.55 && this.vtecEngaged >= 0.55) this.events.push("vtec");

    let goal = this.targetRpm;
    if (this.heatSeize) goal = Math.min(goal, 650);
    if (this.seized || this.rodStage === 2 || this.noFuel) goal = 0;
    if (this.limp) goal = Math.min(goal, 2200);
    const tau = this.seized || this.rodStage === 2 ? 0.22 : this.heatSeize ? 0.8 : 0.55;
    this.rpm += (goal - this.rpm) * (1 - Math.exp(-dt / tau));
    this.rpm = clamp(this.rpm, 0, red * 1.25);

    const gain = this.vibeGain();
    let wobble = 0;
    const healthySpin = !this.seized && this.rodStage === 0 && !this.gasket && !this.timing && !this.heatSeize && this.misfireCyl < 0;
    const pulse = Math.max(0, Math.sin(this.time * 2.4));
    if (healthySpin && this.rpm > 550 && this.rpm < 1100) {
      wobble = Math.sin(this.time * 2.2) * 4 * gain;
    }
    if (gain > 0 && pulse > 0.65) {
      if (this.gasket && !this.seized) wobble += Math.sin(this.time * 17) * 6 * gain;
      if (this.misfireCyl >= 0 && !this.seized) wobble += Math.sin(this.time * 13) * 5 * gain;
      if (this.rodStage === 1) wobble += Math.sin(this.time * 23) * 8 * this.knock * gain;
      if (this.timing && !this.seized) wobble += Math.sin(this.time * 19) * 7 * gain;
    }

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
      : estimatePower(spec, this.rpm, this.throttle, this.boost, this.vtecEngaged > 0.55);
    const health = (this.gasket ? 0.84 : 1) * (this.turboFail && spec.aspiration === "turbo" ? 0.95 : 1);
    const cardAdv = this.camId === "stock" ? 0 : this.camId === "c272" ? 272 : this.camId === "c288" ? 288 : 304;
    const camK = cardAdv > 0 ? (cardAdv - 250) / 380 : 0;
    const camShape = camK === 0 ? 1 : this.rpm < 3400 ? 1 - camK * 1.15 : 1 + camK * 0.5;
    const shaped = clamp(camShape, 0.5, 1.28);
    this.torqueNm = est.torqueNm * health * shaped;
    this.powerKw = est.powerKw * health * shaped;
    this.powerPs = est.powerPs * health * shaped;

    const idleWindow = healthySpin && this.rpm > 450 && this.rpm < 1400;
    const idleVibe = idleWindow ? (1 - (this.rpm - 450) / 950) * 0.04 * gain : 0;
    let fault = 0;
    const hit = pulse > 0.72 ? 1 : 0;
    if (this.rodStage === 1) fault += hit * (0.22 + this.knock * 0.12);
    if (this.rodStage === 2) fault += 0.28;
    if (this.gasket && !this.seized) fault += hit * 0.12;
    if (this.misfireCyl >= 0 && !this.seized) fault += hit * 0.1;
    if (this.timing) fault += hit * 0.16;
    if (this.heatSeize && !this.seized) fault += hit * 0.1;
    const wantShake = (idleVibe + fault) * (gain > 0 ? 1 : 0);
    this.shake += (wantShake - this.shake) * (1 - Math.exp(-dt / 0.08));
    if (this.seized && this.rodStage !== 2) this.shake *= Math.max(0, 1 - dt * 0.4);

    if (this.message === "Motor düzgün çalışıyor" && (this.gasket || this.turboFail || this.rodStage > 0 || this.timing)) {
      /* mesaj arıza tarafından yönetilir */
    }
    this.stepVoltage();
    applyScenario(this, dt);
    const lift = this.camId === "c304" ? 13.4 : this.camId === "c288" ? 12.2 : this.camId === "c272" ? 11.2 : 9.2;
    this.vacuum = clamp(80 - this.throttle * 58 - Math.max(0, (this.camId === "stock" ? 0 : lift - 9)) * 4 - Math.abs(this.camAdvance) * 0.6, 6, 88);
    this.valveWarn = (lift >= 12.2 || this.camAdvance >= 8 || this.camId === "c304") && this.rpm > 2600;
    if (this.valveWarn && this.rpm > 4300 && (this.camAdvance >= 8 || lift >= 13)) {
      this.clashAcc += dt;
      if (this.clashAcc > 2.4 && !this.timing) {
        this.timing = true;
        this.say("Supap pistona bindi — avans ve kalkış fazla", "bad");
        this.events.push("clash");
      }
    } else this.clashAcc *= 0.92;
  }

  private electrical(): boolean {
    return this.batteryIn && this.negOn && this.posOn;
  }

  private stepWorkshop(dt: number): void {
    const diesel = this.spec.fuel === "dizel";
    if (this.workshop && diesel && (this.key === "on" || this.key === "start")) {
      this.glow = Math.min(1, this.glow + dt / 3);
    } else {
      this.glow = Math.max(0, this.glow - dt / 1.4);
    }
    if (!this.workshop) {
      this.cranking = false;
      this.caught = true;
      return;
    }
    const power = this.electrical();
    if (this.key === "start" && !power) {
      this.cranking = false;
      this.targetRpm = 0;
      this.bayMessage = "Marş basmıyor. Akü kutuları veya akünün kendisi eksik.";
      this.bayLevel = "bad";
      return;
    }
    if (this.key === "start" && (this.starterDead || this.noCrank)) {
      this.cranking = false;
      this.targetRpm = 0;
      if (this.scenarioAge % 0.45 < dt) this.events.push("snap");
      this.bayMessage = this.starterDead ? "Selenoid tıklıyor, volan dönmüyor." : "Marş için voltaj yetmiyor.";
      this.bayLevel = "bad";
      return;
    }
    if (this.key === "start" && power && !this.seized && !this.noFuel) {
      this.cranking = true;
      this.crankAge += dt;
      this.bayMessage = "Marş motoru çeviriyor.";
      this.bayLevel = "ok";
      if (this.batteryWeak) {
        this.targetRpm = 85;
        this.bayMessage = "Akü zayıf — marş yavaş, voltaj motoru tutturmuyor.";
        this.bayLevel = "warn";
        return;
      }
      if (this.crankAge > 1.05) {
        this.caught = true;
        this.cranking = false;
        this.crankAge = 0;
        this.key = "on";
        this.events.push("catch");
        this.bayMessage = "Motor tuttu. Kontak ON'da kaldı.";
        this.bayLevel = "ok";
      }
      this.targetRpm = 230;
      return;
    }
    this.cranking = false;
    if (this.key !== "start") this.crankAge = 0;
    if (!power || this.key === "off" || this.key === "acc") {
      if (this.caught && !power) {
        this.bayMessage = "Akü devresi açık — motor durdu.";
        this.bayLevel = "bad";
      }
      this.caught = false;
      this.targetRpm = 0;
      return;
    }
    if (this.caught) this.targetRpm = Math.max(780, this.requestedRpm);
    else this.targetRpm = 0;
  }

  private stepVoltage(): void {
    if (!this.batteryIn) {
      this.voltage = 0;
      return;
    }
    if (this.cranking) {
      this.voltage = this.batteryWeak ? 8.3 : 10.4;
      return;
    }
    if (this.caught && this.rpm > 700 && this.electrical()) {
      this.voltage = 14.1;
      return;
    }
    this.voltage = this.batteryWeak ? 12.05 : 12.6;
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
