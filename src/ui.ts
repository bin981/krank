import {
  type EngineSpec,
  type Fuel,
  type Aspiration,
  type LayoutId,
  LAYOUTS,
  PRESETS,
  displacementCc,
  engineTitle,
  firingOrderLabel,
  redlineRpm,
  cylinderPressureBar,
  strokeOf,
  phaseDeg,
  nf0,
  nf1,
} from "./engine/model";
import type { FailId, Simulation } from "./engine/sim";
import type { ViewState } from "./view";
import type { CameraPreset } from "./scene/studio";

export class Hud {
  readonly spec: EngineSpec;
  private silent = false;
  private labelsOn = true;
  private spin = false;
  private mode: ViewState["mode"] = "solid";
  private shorts = false;
  private running = true;
  private savedRpm = 2400;

  constructor(
    private readonly onSpec: (spec: EngineSpec) => void,
    private readonly onCamera: (preset: CameraPreset) => void,
    private readonly onFail: (id: FailId) => void,
    private readonly onReset: () => void,
    private readonly onSound: () => void,
  ) {
    this.spec = { ...PRESETS[2].spec };
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

  sync(sim: Simulation, hover: string): void {
    const rpm = sim.indicatedRpm;
    const red = redlineRpm(sim.spec);
    const tach = document.querySelector("#rpm-read");
    if (tach) tach.textContent = nf0.format(rpm);
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
    if (hoverEl) hoverEl.textContent = hover;

    bar("#ab-rev", sim.abuse.rev);
    bar("#ab-heat", sim.abuse.heat);
    bar("#ab-oil", sim.abuse.oil);
    bar("#ab-boost", sim.abuse.boost);

    this.paintCyls(sim);
    this.paintGraph(sim);
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
    document.querySelector("#sound")?.addEventListener("click", () => this.onSound());
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

  private readDims(): void {
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

function sameSpec(a: EngineSpec, b: EngineSpec): boolean {
  return a.fuel === b.fuel && a.aspiration === b.aspiration && a.layout === b.layout
    && Math.abs(a.bore - b.bore) < 0.2 && Math.abs(a.stroke - b.stroke) < 0.2
    && Math.abs(a.compression - b.compression) < 0.15 && Math.abs(a.boostTarget - b.boostTarget) < 0.06;
}
