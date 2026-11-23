import {
  type EngineSpec,
  type Fuel,
  type Aspiration,
  type LayoutId,
  LAYOUTS,
  PRESETS,
  presetByName,
  displacementCc,
  engineTitle,
  firingOrderLabel,
  redlineRpm,
  cylinderPressureBar,
  strokeOf,
  phaseDeg,
  activeCam,
  camLift,
  camCard,
  valvePoints,
  CAM_CARDS,
  valvetrainLabel,
  injectionLabel,
  nf0,
  nf1,
} from "./engine/model";
import type { FailId, Simulation } from "./engine/sim";
import { SCENARIOS, scenarioById } from "./scenarios";
import type { ViewState } from "./view";
import type { CameraPreset } from "./scene/studio";

export class Hud {
  readonly spec: EngineSpec;
  private silent = false;
  private labelsOn = false;
  private spin = false;
  private mode: ViewState["mode"] = "solid";
  private shorts = false;
  private running = true;
  private savedRpm = 2400;
  private tour = false;
  private slow = false;
  camId = "stock";
  camLsa = 110;
  camAdvance = 0;
  vibe: "off" | "low" | "real" = "low";
  volume = 0.8;
  mixExhaust = 0.85;
  mixIntake = 0.55;
  mixMech = 0.4;
  private diagSecret = "";
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];

  constructor(
    private readonly onSpec: (spec: EngineSpec) => void,
    private readonly onCamera: (preset: CameraPreset) => void,
    private readonly onFail: (id: FailId) => void,
    private readonly onReset: () => void,
    private readonly onSound: () => void,
  ) {
    this.spec = presetByName("2.0 Turbo");
    this.bind();
    this.paintSpec();
    this.buildCyls();
  }

  view(): ViewState {
    return {
      mode: this.mode,
      explode: num("explode") / 100,
      labels: this.shorts ? false : this.labelsOn,
      spin: this.spin && !this.shorts,
      cut: 0,
    };
  }

  get shortsOn(): boolean {
    return this.shorts;
  }

  get throttle(): number {
    return num("throttle") / 100;
  }

  get rpm(): number {
    return this.running ? num("rpm") : 0;
  }

  get oilLevel(): number {
    return num("oil") / 100;
  }

  get radiatorBlocked(): boolean {
    return (document.querySelector("#radiator") as HTMLInputElement).checked;
  }

  get timeScale(): number {
    if (this.tour) return 0.22;
    return this.slow ? 0.3 : 1;
  }

  sync(sim: Simulation, hover: string): void {
    const rpm = sim.indicatedRpm;
    const red = redlineRpm(sim.spec);
    const tach = document.querySelector("#rpm-read");
    if (tach) tach.textContent = nf0.format(rpm);
    const hud = document.querySelector("#hud-rpm");
    if (hud) hud.textContent = nf0.format(rpm);
    document.querySelector("#hud-gauge")?.classList.toggle("bad", rpm > red || sim.seized);
    document.querySelector("#hud-gauge")?.classList.toggle("warn", !sim.seized && rpm > red * 0.92 && rpm <= red);
    document.querySelector(".tach")?.classList.toggle("bad", rpm > red || sim.seized);
    document.querySelector(".tach")?.classList.toggle("warn", !sim.seized && rpm > red * 0.92 && rpm <= red);
    text("#torque", `${nf0.format(sim.torqueNm)} Nm`);
    text("#power", `${nf0.format(sim.powerPs)} bg`);
    text("#cc", `${nf0.format(displacementCc(sim.spec))} cc`);
    text("#boost-read", sim.spec.aspiration === "turbo" ? `${nf2(sim.boost)} bar` : "—");
    text("#oil-read", `${nf1.format(sim.oil)} bar`);
    text("#temp", `${nf0.format(sim.coolant)} °C`);
    const tempEl = document.querySelector("#temp");
    if (tempEl) (tempEl as HTMLElement).style.color = sim.coolant > 110 ? "#ff4d1c" : "";
    const oilEl = document.querySelector("#oil-read");
    if (oilEl) (oilEl as HTMLElement).style.color = sim.oil < 1.2 ? "#ffb020" : "";

    text("#bc-title", engineTitle(sim.spec));
    text("#bc-sub", `Ateşleme ${firingOrderLabel(sim.spec.layout)}`);
    text("#bc-rpm", nf0.format(rpm));
    text("#bc-torque", `${nf0.format(sim.torqueNm)} Nm`);
    text("#bc-power", `${nf0.format(sim.powerPs)} bg`);
    text("#bc-boost", sim.spec.aspiration === "turbo" ? `${nf2(sim.boost)} bar` : "");
    const msg = document.querySelector("#bc-msg");
    if (msg) msg.textContent = sim.messageLevel === "ok" ? "" : sim.message;

    const banner = document.querySelector("#banner") as HTMLElement;
    banner.hidden = sim.messageLevel === "ok";
    banner.textContent = sim.message;
    banner.className = `banner ${sim.messageLevel}`;
    const status = document.querySelector("#status") as HTMLElement;
    status.textContent = sim.message;
    status.className = `status ${sim.messageLevel}`;

    const hoverEl = document.querySelector("#hover");
    const blurb = PARTS[hover];
    if (hoverEl) hoverEl.textContent = blurb ? "" : hover;
    const card = document.querySelector("#part-card") as HTMLElement | null;
    if (card) {
      card.hidden = !blurb;
      if (blurb) {
        text("#part-name", hover);
        text("#part-blurb", blurb);
      }
    }
    if (this.tour && sim.cyls[0]) {
      const phase = phaseDeg(sim.crankDeg, sim.cyls[0].fireDeg);
      const stroke = strokeOf(phase, sim.spec.fuel);
      text("#tour-title", stroke.label);
      text("#tour-text", STROKES[stroke.id]);
    }
    const arc = document.querySelector("#gauge-arc") as SVGPathElement | null;
    if (arc) {
      const ratio = Math.max(0, Math.min(1, rpm / (red * 1.05)));
      arc.style.strokeDashoffset = String(100 - ratio * 100);
      arc.style.stroke = rpm > red ? "#ff4d1c" : rpm > red * 0.92 ? "#ffb020" : "#e2ff4d";
    }
    this.paintCluster(sim);
    this.paintObd(sim);
    const smoke = document.querySelector("#smoke") as HTMLElement | null;
    if (smoke) {
      smoke.hidden = sim.smoke === "none";
      smoke.className = `smoke ${sim.smoke}`;
      smoke.textContent = sim.smoke === "white" ? "Beyaz duman" : sim.smoke === "blue" ? "Mavi duman" : sim.smoke === "black" ? "Siyah duman" : "";
    }
    const hook = document.querySelector("#bc-hook");
    if (hook) {
      const sc = scenarioById(sim.scenarioId);
      hook.textContent = sc ? sc.name : "Motoru izle";
    }

    bar("#ab-rev", sim.abuse.rev);
    bar("#ab-heat", sim.abuse.heat);
    bar("#ab-oil", sim.abuse.oil);
    bar("#ab-boost", sim.abuse.boost);

    this.paintCyls(sim);
    this.paintGraph(sim);
    this.paintValves(sim);
    this.paintSpecCard();
    const turboBtn = document.querySelector("#fail-turbo") as HTMLButtonElement;
    turboBtn.disabled = sim.spec.aspiration !== "turbo" || sim.turboFail;
  }

  showSpec(spec: EngineSpec, rpm: number): void {
    this.silent = true;
    Object.assign(this.spec, spec);
    this.paintSpec();
    const slider = document.querySelector("#rpm") as HTMLInputElement;
    const red = redlineRpm(spec);
    slider.max = String(Math.round(red * 1.15));
    slider.value = String(Math.round(Math.min(rpm, Number(slider.max))));
    const pct = (red / Number(slider.max)) * 100;
    slider.style.background = `linear-gradient(90deg, #3c4332 0 ${pct}%, #6a2c24 ${pct}%)`;
    text("#redline", `Kırmızı bölge ${nf0.format(red)}`);
    this.savedRpm = Number(slider.value);
    this.buildCyls();
    this.silent = false;
  }

  private bind(): void {
    document.querySelectorAll("#presets, #fuel, #aspiration, #layout").forEach((el) => {
      el.addEventListener("click", (ev) => {
        const btn = (ev.target as HTMLElement).closest("button");
        if (!btn || this.silent) return;
        const group = (btn.parentElement as HTMLElement).id;
        if (group === "presets") {
          const preset = PRESETS.find((p) => p.name === btn.dataset.name);
          if (!preset) return;
          Object.assign(this.spec, preset.spec);
          this.paintSpec();
          this.emit();
          return;
        }
        this.mark(btn.parentElement as HTMLElement, btn);
        this.genericize();
        if (group === "fuel") this.spec.fuel = btn.dataset.value as Fuel;
        if (group === "aspiration") this.spec.aspiration = btn.dataset.value as Aspiration;
        if (group === "layout") this.spec.layout = btn.dataset.value as LayoutId;
        this.clampCr();
        this.emit();
      });
    });

    for (const id of ["bore", "stroke", "cr", "boost"] as const) {
      document.querySelector("#" + id)?.addEventListener("input", () => {
        if (this.silent) return;
        this.readDims();
        this.emit();
      });
    }
    document.querySelector("#oil")?.addEventListener("input", () => {
      text("#oil-val", `%${nf0.format(num("oil"))}`);
    });

    document.querySelector("#viewmode")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      if (!btn) return;
      this.mode = btn.dataset.value as ViewState["mode"];
      this.mark(btn.parentElement as HTMLElement, btn);
    });
    document.querySelector("#labels")?.addEventListener("click", (ev) => {
      this.labelsOn = !this.labelsOn;
      press(ev.currentTarget as HTMLButtonElement, this.labelsOn);
    });
    document.querySelector("#spin")?.addEventListener("click", (ev) => {
      this.spin = !this.spin;
      press(ev.currentTarget as HTMLButtonElement, this.spin);
    });
    document.querySelector(".cams")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      if (!btn?.dataset.cam) return;
      this.onCamera(btn.dataset.cam as CameraPreset);
    });
    document.querySelectorAll("[data-fail]").forEach((btn) => {
      btn.addEventListener("click", () => this.onFail((btn as HTMLElement).dataset.fail as FailId));
    });
    document.querySelector("#reset")?.addEventListener("click", () => this.onReset());
    document.querySelector("#run")?.addEventListener("click", () => this.toggleRun());
    document.querySelector("#shorts")?.addEventListener("click", () => this.setShorts(!this.shorts));
    document.querySelector("#exit-shorts")?.addEventListener("click", () => this.setShorts(false));
    document.querySelector("#tour")?.addEventListener("click", (ev) => {
      this.tour = !this.tour;
      press(ev.currentTarget as HTMLButtonElement, this.tour);
      const card = document.querySelector("#tour-card") as HTMLElement;
      card.hidden = !this.tour;
      if (this.tour) this.onCamera("side");
    });
    document.querySelector("#slow")?.addEventListener("click", (ev) => {
      this.slow = !this.slow;
      press(ev.currentTarget as HTMLButtonElement, this.slow);
    });
    document.querySelector("#cine")?.addEventListener("click", (ev) => {
      const on = !(ev.currentTarget as HTMLButtonElement).classList.contains("on");
      press(ev.currentTarget as HTMLButtonElement, on);
      this.setShorts(on);
      this.onCamera(on ? "cine" : "threequarter");
    });
    document.querySelector("#dock")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      if (!btn?.dataset.sheet) return;
      const name = btn.dataset.sheet;
      const sheet = name === "bay" ? "motor" : name;
      const open = document.body.dataset.sheet === sheet && name !== "bay" ? "" : sheet;
      document.body.dataset.sheet = open;
      document.body.classList.toggle("sheet-motor", open === "motor");
      document.body.classList.toggle("sheet-drive", open === "drive");
      document.body.classList.toggle("sheet-data", open === "data");
      document.querySelectorAll("#dock button").forEach((b) => {
        b.classList.toggle("on", (b as HTMLElement).dataset.sheet === open);
      });
    });
    document.querySelector("#sound")?.addEventListener("click", () => this.onSound());
    document.querySelector("#cam-pick")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      if (!btn?.dataset.camId) return;
      this.camId = btn.dataset.camId;
      const card = CAM_CARDS.find((c) => c.id === this.camId);
      if (card) {
        this.camLsa = card.lsa;
        const lsa = document.querySelector("#lsa") as HTMLInputElement | null;
        if (lsa) lsa.value = String(card.lsa);
      }
      this.mark(btn.parentElement as HTMLElement, btn);
    });
    document.querySelector("#lsa")?.addEventListener("input", () => {
      this.camLsa = num("lsa");
      text("#lsa-val", `${this.camLsa}°`);
    });
    document.querySelector("#cam-adv")?.addEventListener("input", () => {
      this.camAdvance = num("cam-adv");
      const sign = this.camAdvance > 0 ? "avans " : this.camAdvance < 0 ? "rötar " : "";
      text("#adv-val", `${sign}${this.camAdvance}°`);
    });
    document.querySelector("#vibe")?.addEventListener("change", (ev) => {
      this.vibe = (ev.target as HTMLSelectElement).value as typeof this.vibe;
    });
    const mix = (id: string, set: (v: number) => void, label: string) => {
      document.querySelector("#" + id)?.addEventListener("input", () => {
        const v = num(id) / 100;
        set(v);
        text("#" + label, `%${Math.round(v * 100)}`);
      });
    };
    mix("vol", (v) => { this.volume = v; }, "vol-val");
    mix("mix-ex", (v) => { this.mixExhaust = v; }, "mix-ex-val");
    mix("mix-in", (v) => { this.mixIntake = v; }, "mix-in-val");
    mix("mix-me", (v) => { this.mixMech = v; }, "mix-me-val");
    this.fillScenarios();
    document.querySelector("#scenario-cat")?.addEventListener("change", () => this.fillScenarios());
    document.querySelector("#scenario-list")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      if (!btn?.dataset.scenario) return;
      this.onScenario(btn.dataset.scenario);
    });
    document.querySelector("#diag-start")?.addEventListener("click", () => this.startDiagnosis());
    document.querySelector("#diag-choices")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      if (!btn?.dataset.scenario || !this.diagSecret) return;
      const ok = btn.dataset.scenario === this.diagSecret;
      const result = document.querySelector("#diag-result") as HTMLElement;
      const answer = scenarioById(this.diagSecret);
      result.textContent = ok ? "Doğru teşhis." : `Yanlış. Doğrusu: ${answer?.name ?? ""}. ${answer?.hint ?? ""}`;
      result.className = `status ${ok ? "ok" : "bad"}`;
    });
    document.querySelector("#shorts-clean")?.addEventListener("click", () => {
      document.body.classList.toggle("clean");
    });
    document.querySelector("#shorts-rec")?.addEventListener("click", () => this.toggleRecord());
    document.querySelector("#drawer-left")?.addEventListener("click", () => {
      document.body.classList.toggle("show-left");
      document.body.classList.remove("show-right");
    });
    document.querySelector("#drawer-right")?.addEventListener("click", () => {
      document.body.classList.toggle("show-right");
      document.body.classList.remove("show-left");
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.code === "Space") {
        ev.preventDefault();
        this.toggleRun();
      } else if (ev.key === "r" || ev.key === "R") this.onReset();
      else if (ev.key === "c" || ev.key === "C") this.setMode("cutaway");
      else if (ev.key === "x" || ev.key === "X") this.setMode("xray");
      else if (ev.key === "s" || ev.key === "S") this.setShorts(!this.shorts);
      else if (ev.key === "1") this.onFail("rod");
      else if (ev.key === "2") this.onFail("gasket");
      else if (ev.key === "3") this.onFail("turbo");
      else if (ev.key === "4") this.onFail("timing");
      else if (ev.key === "5") this.onFail("seizure");
    });
  }

  setSoundLabel(on: boolean): void {
    const btn = document.querySelector("#sound") as HTMLButtonElement;
    btn.textContent = on ? "Ses açık" : "Sesi aç";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  private setShorts(on: boolean): void {
    this.shorts = on;
    document.body.classList.toggle("shorts", on);
    if (!on) press(document.querySelector("#cine") as HTMLButtonElement, false);
    const broadcast = document.querySelector("#broadcast") as HTMLElement;
    broadcast.hidden = !on;
    press(document.querySelector("#shorts") as HTMLButtonElement, on);
    document.body.classList.remove("show-left", "show-right");
  }

  private setMode(mode: ViewState["mode"]): void {
    this.mode = this.mode === mode ? "solid" : mode;
    const wrap = document.querySelector("#viewmode") as HTMLElement;
    const btn = wrap.querySelector(`[data-value="${this.mode}"]`) as HTMLButtonElement;
    this.mark(wrap, btn);
  }

  private toggleRun(): void {
    const slider = document.querySelector("#rpm") as HTMLInputElement;
    if (this.running) {
      this.savedRpm = Number(slider.value);
      this.running = false;
    } else {
      this.running = true;
      if (Number(slider.value) < 400) slider.value = String(this.savedRpm || 900);
    }
    const btn = document.querySelector("#run") as HTMLButtonElement;
    btn.textContent = this.running ? "Çalışıyor" : "Durdu";
    press(btn, this.running);
  }

  private emit(): void {
    if (this.silent) return;
    this.clampCr();
    this.onSpec({ ...this.spec });
  }

  private genericize(): void {
    delete this.spec.presetId;
    delete this.spec.code;
    delete this.spec.redline;
    delete this.spec.vtecRpm;
    delete this.spec.note;
    delete this.spec.valvetrain;
    delete this.spec.injection;
    delete this.spec.timingDrive;
  }

  private readDims(): void {
    this.genericize();
    this.spec.bore = num("bore");
    this.spec.stroke = num("stroke");
    this.spec.compression = num("cr");
    this.spec.boostTarget = num("boost");
    this.paintNumbers();
  }

  private clampCr(): void {
    if (this.spec.fuel === "dizel") this.spec.compression = Math.max(14, Math.min(22, this.spec.compression < 13 ? 16 : this.spec.compression));
    else this.spec.compression = Math.max(8, Math.min(13.5, this.spec.compression > 14 ? 10.5 : this.spec.compression));
    const cr = document.querySelector("#cr") as HTMLInputElement;
    cr.min = this.spec.fuel === "dizel" ? "14" : "8";
    cr.max = this.spec.fuel === "dizel" ? "22" : "13.5";
    cr.value = String(this.spec.compression);
    this.paintNumbers();
  }

  private paintSpec(): void {
    this.markValue("#fuel", this.spec.fuel);
    this.markValue("#aspiration", this.spec.aspiration);
    this.markValue("#layout", this.spec.layout);
    setVal("bore", this.spec.bore);
    setVal("stroke", this.spec.stroke);
    setVal("cr", this.spec.compression);
    setVal("boost", this.spec.boostTarget);
    const boostWrap = document.querySelector("#boost-wrap") as HTMLElement;
    boostWrap.hidden = this.spec.aspiration !== "turbo";
    this.clampCr();
    const box = document.querySelector("#presets") as HTMLElement;
    if (!box.childElementCount) {
      for (const preset of PRESETS) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = preset.name;
        b.dataset.name = preset.name;
        b.title = preset.blurb;
        box.appendChild(b);
      }
    }
    box.querySelectorAll("button").forEach((b) => {
      const p = PRESETS.find((x) => x.name === b.dataset.name);
      b.classList.toggle("on", !!p && sameSpec(p.spec, this.spec));
    });
  }

  private onScenario(id: string): void {
    const simHolder = (window as unknown as { __krankSetScenario?: (id: string) => void }).__krankSetScenario;
    simHolder?.(id);
  }

  private fillScenarios(): void {
    const cat = document.querySelector("#scenario-cat") as HTMLSelectElement | null;
    const list = document.querySelector("#scenario-list");
    if (!cat || !list) return;
    const cats = ["Hepsi", ...new Set(SCENARIOS.map((s) => s.cat))];
    if (!cat.childElementCount) {
      for (const c of cats) {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        cat.appendChild(o);
      }
    }
    const chosen = cat.value || "Hepsi";
    list.innerHTML = "";
    for (const s of SCENARIOS.filter((x) => chosen === "Hepsi" || x.cat === chosen)) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.scenario = s.id;
      b.textContent = s.name;
      list.appendChild(b);
    }
  }

  private startDiagnosis(): void {
    const pool = SCENARIOS.filter((s) => s.codes.length > 0);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.diagSecret = pick.id;
    this.onScenario(pick.id);
    const box = document.querySelector("#diag") as HTMLElement;
    box.hidden = false;
    const choices = document.querySelector("#diag-choices");
    if (!choices) return;
    choices.innerHTML = "";
    for (const s of pool) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.scenario = s.id;
      b.textContent = s.name;
      choices.appendChild(b);
    }
    const result = document.querySelector("#diag-result");
    if (result) result.textContent = "";
    const symptom = document.querySelector("#symptom");
    if (symptom) symptom.textContent = "Belirti gizli. OBD ve dumanı oku.";
  }

  private paintCluster(sim: Simulation): void {
    const lamp = (id: string, on: boolean) => document.querySelector(id)?.classList.toggle("on", on);
    lamp("#lamp-bat", sim.lamps.bat || sim.voltage < 12.2);
    lamp("#lamp-oil", sim.lamps.oil || sim.oil < 1.1);
    lamp("#lamp-temp", sim.lamps.temp || sim.coolant > 110);
    lamp("#lamp-cel", sim.lamps.cel || sim.scenarioId !== "none" && sim.scenarioId !== "warm");
    lamp("#lamp-glow", sim.lamps.glow || (sim.spec.fuel === "dizel" && sim.glow > 0.05 && sim.glow < 0.98));
    text("#cluster-oil", `${nf1.format(sim.oil)} bar`);
    text("#cluster-temp", `${nf0.format(sim.coolant)} °C`);
    text("#cluster-boost", sim.spec.aspiration === "turbo" ? `${nf1.format(sim.boost)} bar` : "—");
    text("#cluster-volt", `${nf1.format(sim.voltage)} V`);
  }

  private paintObd(sim: Simulation): void {
    const codes = document.querySelector("#obd-codes");
    const live = document.querySelector("#obd-live");
    if (!codes || !live) return;
    const def = scenarioById(sim.scenarioId);
    const hidden = this.diagSecret && this.diagSecret === sim.scenarioId;
    codes.innerHTML = "";
    const list = hidden ? ["—"] : (def?.codes.length ? def.codes : ["Kod yok"]);
    for (const code of list) {
      const li = document.createElement("li");
      li.textContent = code;
      codes.appendChild(li);
    }
    if (!hidden && def) {
      const symptom = document.querySelector("#symptom");
      if (symptom && !this.diagSecret) symptom.textContent = def.hint;
    }
    const rows: [string, string][] = [
      ["Devir", `${nf0.format(sim.indicatedRpm)}`],
      ["Hararet", `${nf0.format(sim.coolant)} °C`],
      ["MAP/Boost", `${nf1.format(sim.boost)} bar`],
      ["Rail", `${nf0.format(sim.railBar)}`],
      ["Akü", `${nf1.format(sim.voltage)} V`],
      ["STFT", `${nf0.format(sim.stft)} %`],
      ["LTFT", `${nf0.format(sim.ltft)} %`],
      ["Vakum", `${nf0.format(sim.vacuum)} kPa`],
    ];
    live.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  private toggleRecord(): void {
    const canvas = document.querySelector("#c") as HTMLCanvasElement | null;
    const btn = document.querySelector("#shorts-rec") as HTMLButtonElement | null;
    if (!canvas || typeof MediaRecorder === "undefined") {
      if (btn) btn.textContent = "Kayıt yok";
      return;
    }
    if (this.recorder && this.recorder.state === "recording") {
      this.recorder.stop();
      if (btn) btn.textContent = "Kaydet";
      return;
    }
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    this.recChunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime });
    this.recorder.ondataavailable = (ev) => { if (ev.data.size) this.recChunks.push(ev.data); };
    this.recorder.onstop = () => {
      const blob = new Blob(this.recChunks, { type: mime });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "krank-shorts.webm";
      a.click();
    };
    this.recorder.start();
    if (btn) btn.textContent = "Durdur";
  }

  private paintSpecCard(): void {
    const card = document.querySelector("#spec-card");
    if (!card) return;
    const spec = this.spec;
    const cc = displacementCc(spec);
    const rows: [string, string][] = [
      ["Hacim", `${nf0.format(cc)} cc`],
      ["Düzen", `${LAYOUTS[spec.layout].label}`],
      ["Çap × strok", `${nf1.format(spec.bore)} × ${nf1.format(spec.stroke)}`],
      ["Sıkıştırma", `${nf1.format(spec.compression)} : 1`],
      ["Ateşleme", firingOrderLabel(spec.layout)],
      ["Supap", valvetrainLabel(spec)],
      ["Enjeksiyon", injectionLabel(spec)],
      ["Triger", spec.timingDrive === "zincir" ? "Zincir" : spec.timingDrive === "kayış" ? "Kayış" : "Kayış"],
      ["Kırmızı bölge", `${nf0.format(redlineRpm(spec))} dev/dk`],
    ];
    if (spec.vtecRpm) rows.push(["VTEC", `${nf0.format(spec.vtecRpm)} dev/dk`]);
    card.innerHTML = `<h3>${spec.code ?? engineTitle(spec)}</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${spec.note ? `<p>${spec.note}</p>` : ""}`;
  }

  private paintValves(sim: Simulation): void {
    const canvas = document.querySelector("#vlift") as HTMLCanvasElement | null;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 110;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const lobes = activeCam(sim.spec, sim.vtecEngaged > 0.55, sim.camId, sim.camLsa, sim.camAdvance);
    const samples = 180;
    const intake: number[] = [];
    const exhaust: number[] = [];
    for (let i = 0; i < samples; i++) {
      const phase = (i / (samples - 1)) * 720;
      intake.push(camLift(phase, lobes.intake));
      exhaust.push(camLift(phase, lobes.exhaust));
    }
    ctx.fillStyle = "rgba(226,255,77,0.08)";
    for (let i = 0; i < samples; i++) {
      if (intake[i] > 0.05 && exhaust[i] > 0.05) {
        const x = (i / (samples - 1)) * w;
        ctx.fillRect(x, 0, w / samples + 1, h);
      }
    }
    const draw = (values: number[], color: string) => {
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / (samples - 1)) * w;
        const y = h - 8 - v * (h - 18);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    };
    draw(exhaust, "#c7b6a2");
    draw(intake, "#7eb6ff");
    this.paintDegree(sim, lobes);
    const phase = phaseDeg(sim.crankDeg, sim.cyls[0]?.fireDeg ?? 0);
    ctx.strokeStyle = "#ff4d1c";
    ctx.beginPath();
    ctx.moveTo((phase / 720) * w, 0);
    ctx.lineTo((phase / 720) * w, h);
    ctx.stroke();
  }

  private paintDegree(sim: Simulation, lobes: ReturnType<typeof activeCam>): void {
    const card = camCard(sim.camId);
    const pts = valvePoints(lobes, card.liftMm);
    const fmt = (deg: number) => `${Math.round(deg)}°`;
    text("#cam-events", `IVO ${fmt(pts.ivo)} · IVC ${fmt(pts.ivc)} · EVO ${fmt(pts.evo)} · EVC ${fmt(pts.evc)} @ 1 mm · Bindirme ${pts.overlap}° · Vakum ${nf0.format(sim.vacuum)} kPa`);
    const warn = document.querySelector("#valve-warn") as HTMLElement | null;
    if (warn) warn.hidden = !sim.valveWarn;
    const canvas = document.querySelector("#degree-wheel") as HTMLCanvasElement | null;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.38;
    ctx.strokeStyle = "#34392c";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const mark = (deg: number, color: string) => {
      const a = (-Math.PI / 2) + (deg / 720) * Math.PI * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
      ctx.lineTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
      ctx.stroke();
    };
    mark(pts.ivo, "#7eb6ff");
    mark(pts.ivc, "#7eb6ff");
    mark(pts.evo, "#c7b6a2");
    mark(pts.evc, "#c7b6a2");
    const phase = phaseDeg(sim.crankDeg, sim.cyls[0]?.fireDeg ?? 0);
    mark(phase, "#e2ff4d");
    ctx.fillStyle = "#f3f0e4";
    ctx.font = "16px Oswald, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(card.name, cx, cy - 6);
    ctx.fillStyle = "#a39c8c";
    ctx.font = "12px Manrope, sans-serif";
    ctx.fillText(`Bindirme ${pts.overlap}°`, cx, cy + 14);
  }

  private paintNumbers(): void {
    text("#bore-val", `${nf1.format(this.spec.bore)} mm`);
    text("#stroke-val", `${nf1.format(this.spec.stroke)} mm`);
    text("#cr-val", `${nf1.format(this.spec.compression)} : 1`);
    text("#boost-val", `${nf2(this.spec.boostTarget)} bar`);
    text("#disp", `${nf0.format(displacementCc(this.spec))} cc · ${LAYOUTS[this.spec.layout].label}`);
    text("#order", firingOrderLabel(this.spec.layout));
    const boostWrap = document.querySelector("#boost-wrap") as HTMLElement;
    boostWrap.hidden = this.spec.aspiration !== "turbo";
  }

  private buildCyls(): void {
    const n = LAYOUTS[this.spec.layout].cylinders;
    const box = document.querySelector("#cyls") as HTMLElement;
    const pips = document.querySelector("#bc-pips") as HTMLElement;
    box.innerHTML = "";
    pips.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const row = document.createElement("div");
      row.className = "cyl";
      row.innerHTML = `<b>${i + 1}</b><div class="track"><i class="power"></i><i class="exhaust"></i><i class="intake"></i><i class="compression"></i></div><em></em>`;
      box.appendChild(row);
      const pip = document.createElement("i");
      pips.appendChild(pip);
    }
  }

  private paintCyls(sim: Simulation): void {
    const rows = document.querySelectorAll("#cyls .cyl");
    const pips = document.querySelectorAll("#bc-pips i");
    sim.cyls.forEach((cyl, i) => {
      const phase = phaseDeg(sim.crankDeg, cyl.fireDeg);
      const stroke = strokeOf(phase, sim.spec.fuel);
      const row = rows[i] as HTMLElement | undefined;
      if (!row) return;
      const bits = row.querySelectorAll("i");
      bits.forEach((bit) => bit.classList.remove("on"));
      row.querySelector(`.${stroke.id}`)?.classList.add("on");
      const label = row.querySelector("em");
      if (label) label.textContent = sim.isMisfire(cyl.index) && stroke.id === "power" ? "Tekleme" : stroke.label;
      row.classList.toggle("hot", stroke.id === "power" && !sim.isMisfire(cyl.index));
      const pip = pips[i] as HTMLElement | undefined;
      if (pip) pip.className = stroke.id;
    });
  }

  private paintGraph(sim: Simulation): void {
    const canvas = document.querySelector("#graph") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 120;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const leakIndex = [...sim.leakCyls][0] ?? 0;
    const cyl = sim.cyls[leakIndex] ?? sim.cyls[0];
    text("#graph-cyl", `Silindir ${cyl.index + 1}`);
    const samples = 180;
    let peak = 1;
    const values: number[] = [];
    for (let i = 0; i < samples; i++) {
      const phase = (i / samples) * 720;
      const leak = sim.gasket && sim.leakCyls.has(cyl.index);
      const p = cylinderPressureBar(phase, sim.spec, sim.boost, sim.throttle, leak);
      values.push(p);
      peak = Math.max(peak, p);
    }
    const colors = ["#ff4d1c", "#c7b6a2", "#7eb6ff", "#ffb020"];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = 0.13;
      ctx.fillRect((i * w) / 4, 0, w / 4, h);
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    values.forEach((p, i) => {
      const x = (i / (samples - 1)) * w;
      const y = h - 8 - (p / (peak * 1.05)) * (h - 16);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#e2ff4d";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const phase = phaseDeg(sim.crankDeg, cyl.fireDeg);
    const x = (phase / 720) * w;
    ctx.strokeStyle = "#ff4d1c";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    text("#peak", `Tepe ${nf1.format(peak)} bar · imleç krank açısında`);
  }

  private mark(group: HTMLElement, active: HTMLElement): void {
    group.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
    active.classList.add("on");
  }

  private markValue(sel: string, value: string): void {
    const group = document.querySelector(sel) as HTMLElement;
    const btn = group.querySelector(`[data-value="${value}"]`) as HTMLElement;
    if (btn) this.mark(group, btn);
  }
}

function num(id: string): number {
  return Number((document.querySelector("#" + id) as HTMLInputElement).value);
}

function setVal(id: string, value: number): void {
  (document.querySelector("#" + id) as HTMLInputElement).value = String(value);
}

function text(sel: string, value: string): void {
  const el = document.querySelector(sel);
  if (el) el.textContent = value;
}

function press(btn: HTMLButtonElement, on: boolean): void {
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function bar(sel: string, value: number): void {
  const el = document.querySelector(sel) as HTMLElement;
  const v = Math.max(0, Math.min(1, value));
  el.style.width = `${v * 100}%`;
  el.classList.toggle("warn", v > 0.55 && v < 0.9);
  el.classList.toggle("bad", v >= 0.9);
}

function nf2(n: number): string {
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const STROKES: Record<string, string> = {
  intake: "Piston aşağı inerken emme supabı açılır. Benzinde hava-yakıt karışımı, dizelde temiz hava silindire dolar.",
  compression: "İki supap da kapalı. Piston yükseldikçe yükü sıkıştırır; sıcaklık ve basınç artar.",
  power: "Benzinde buji çakar, dizelde püsküren yakıt sıcak havada tutuşur. Genleşen gaz pistonu aşağı iter. Krank bu itişi döndürür.",
  exhaust: "Egzoz supabı açılır. Piston yanmış gazı manifolda ve turboya doğru süpürür.",
};

const PARTS: Record<string, string> = {
  "Krank mili": "Doğrusal piston hareketini döndürür. Ana muylular yataklarda döner, kol muyluları biyelin büyük ucunu taşır. Karşı ağırlıklar dengeyi sağlar.",
  "Krank kasnağı": "Triger kayışı ve aksesuarlar bu kasnaktan tahrik alır.",
  "Volan": "Krankın ucundaki ağır disk devri düzgün tutar ve marş dişlisini taşır.",
  "Biyel": "Pistonu krank kol muylusuna bağlar. Gövde I kesitlidir; büyük uç kapaklı ve cıvatalı, küçük uç piston pimine geçer.",
  "Piston": "Alüminyum gövde, segman yuvaları ve etek. Pim yuvasından biyele bağlanır. Tepe, yanma odasının tabanıdır.",
  "Emme supabı": "Emme zamanında açılır, taze dolguyu silindire alır.",
  "Egzoz supabı": "Egzoz zamanında açılır, yanmış gazı dışarı bırakır. Daha sıcak çalışır.",
  "Emme manifoldu": "Havayı silindirlere dağıtan kollektör.",
  "Egzoz manifoldu": "Silindirlerden çıkan gazı birleştirir. Turboda bu gaz türbini döndürür.",
  "Triger kayışı": "Krank ile eksantrik millerini birlikte döndürür. Koparsa supaplar pistonla çarpışabilir.",
  "Turboşarj": "Egzoz türbini kompresörü çevirir, motora basınçlı hava basar.",
  "Yağ karteri": "Yağın toplandığı alt hazne. Seviye düşünce film incelir ve biyel yatağı zarar görür.",
  "Soğutma suyu deposu": "Soğutma sıvısının genleşme kabı. Conta yanınca burada kabarcık görülür.",
  "Buji": "Sıkışmış karışımı kıvılcımla ateşler.",
  "Enjektör": "Dizel yakıtı sıcak, sıkışmış havanın içine püskürtür.",
  "Kızdırma bujisi": "Soğuk dizelde yanma odasını ısıtır.",
  "Karter": "Krankı taşıyan döküm gövde.",
  "Blok": "Silindirlerin açıldığı ana gövde.",
  "Kapak": "Üstteki supap kapağı. Kamlar ve yağ bunun altındadır.",
  "Motor plakası": "Seçili motorun adı ve düzeni.",
};

function sameSpec(a: EngineSpec, b: EngineSpec): boolean {
  if (a.presetId || b.presetId) return a.presetId === b.presetId;
  return a.fuel === b.fuel && a.aspiration === b.aspiration && a.layout === b.layout
    && Math.abs(a.bore - b.bore) < 0.2 && Math.abs(a.stroke - b.stroke) < 0.2
    && Math.abs(a.compression - b.compression) < 0.15 && Math.abs(a.boostTarget - b.boostTarget) < 0.06;
}
