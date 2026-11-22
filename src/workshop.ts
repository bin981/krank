import type { Simulation, KeyPos } from "./engine/sim";
import { nf1 } from "./engine/model";

interface Step {
  text: string;
  done: (sim: Simulation) => boolean;
}

interface Lesson {
  id: string;
  title: string;
  steps: Step[];
}

const LESSONS: Lesson[] = [
  {
    id: "battery",
    title: "Aküyü sök ve tak",
    steps: [
      { text: "Önce eksi kutbu sök", done: (s) => !s.negOn && s.posOn },
      { text: "Sonra artı kutbu sök", done: (s) => !s.negOn && !s.posOn },
      { text: "Kelepçeyi aç", done: (s) => !s.holdDown && !s.negOn && !s.posOn },
      { text: "Aküyü yuvasından çıkar", done: (s) => !s.batteryIn },
      { text: "Aküyü yerine koy", done: (s) => s.batteryIn && !s.posOn && !s.negOn },
      { text: "Kelepçeyi tak", done: (s) => s.batteryIn && s.holdDown && !s.posOn },
      { text: "Önce artı kutbu bağla", done: (s) => s.batteryIn && s.holdDown && s.posOn && !s.negOn },
      { text: "En son eksi kutbu bağla", done: (s) => s.batteryIn && s.holdDown && s.posOn && s.negOn },
    ],
  },
  {
    id: "start",
    title: "Motoru çalıştır",
    steps: [
      { text: "Akü devresi tam olsun", done: (s) => s.batteryIn && s.posOn && s.negOn && !s.batteryWeak },
      { text: "Kontağı ON yap", done: (s) => s.key === "on" || s.key === "start" || s.caught },
      { text: "Dizelde kızdırma bitsin", done: (s) => s.spec.fuel !== "dizel" || s.glow > 0.95 || s.caught },
      { text: "START ile marşa bas", done: (s) => s.cranking || s.caught || s.crankAge > 0.2 },
      { text: "Motor tutsun", done: (s) => s.caught && s.rpm > 650 },
    ],
  },
  {
    id: "vtec",
    title: "VTEC devreye girişini gözlemle",
    steps: [
      { text: "B16 veya B18 seç", done: (s) => s.spec.valvetrain === "dohc16-vtec" },
      { text: "Deviri geçişin üstüne al veya yüksek kamı izle", done: (s) => s.spec.valvetrain === "dohc16-vtec" && (s.vtecForce || s.rpm >= (s.spec.vtecRpm ?? 5500) - 80) },
      { text: "Pim kilitlensin", done: (s) => s.vtecEngaged > 0.7 },
    ],
  },
];

export class Workshop {
  tab: "build" | "bay" | "lesson" = "build";
  private progress: Record<string, number> = {};
  private drag: { id: string; x: number; y: number; ox: number; oy: number } | null = null;
  private moved = 0;
  probePos: "+" | "−" | "" = "+";
  probeNeg: "+" | "−" | "" = "−";

  constructor(private readonly sim: Simulation) {
    this.bindTabs();
    this.bindKey();
    this.bindBay();
    this.bindFaults();
    this.renderLessons();
  }

  sync(): void {
    const key = document.querySelector("#key");
    key?.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", (b as HTMLElement).dataset.key === this.sim.key);
    });
    const glow = document.querySelector("#glow-lamp") as HTMLElement | null;
    if (glow) {
      const show = this.sim.workshop && this.sim.spec.fuel === "dizel" && (this.sim.key === "on" || this.sim.key === "start") && this.sim.glow < 0.98;
      glow.hidden = !show;
      glow.textContent = `Kızdırma ${Math.round(this.sim.glow * 100)}%`;
    }
    const bat = document.querySelector("#battery") as HTMLElement | null;
    bat?.classList.toggle("out", !this.sim.batteryIn);
    document.querySelector("#cap-pos")?.classList.toggle("off", !this.sim.posOn);
    document.querySelector("#cap-neg")?.classList.toggle("off", !this.sim.negOn);
    document.querySelector("#hold")?.classList.toggle("off", !this.sim.holdDown);
    const msg = document.querySelector("#bay-msg");
    if (msg) {
      msg.textContent = this.sim.bayMessage;
      msg.className = `status ${this.sim.bayLevel}`;
    }
    const meter = document.querySelector("#meter-v");
    if (meter) {
      const reading = this.meterReading();
      meter.textContent = reading == null ? "— V" : `${nf1.format(reading)} V`;
    }
    const watch = document.querySelector("#vtec-watch") as HTMLButtonElement | null;
    if (watch) {
      const has = this.sim.spec.valvetrain === "dohc16-vtec";
      watch.hidden = !has;
      watch.classList.toggle("on", this.sim.vtecForce);
      watch.setAttribute("aria-pressed", this.sim.vtecForce ? "true" : "false");
    }
    const state = document.querySelector("#vtec-state");
    if (state) {
      if (this.sim.spec.valvetrain !== "dohc16-vtec") state.textContent = "Bu motorda VTEC yok.";
      else {
        const rpm = this.sim.spec.vtecRpm ?? 5500;
        state.textContent = this.sim.vtecEngaged > 0.55
          ? `VTEC kilitli · yüksek kam · geçiş ${nf1.format(rpm)} dev/dk`
          : `Düşük kam · pim açık · geçiş ${nf1.format(rpm)} dev/dk`;
      }
    }
    this.renderLessons();
  }

  private meterReading(): number | null {
    if (!this.probePos || !this.probeNeg || this.probePos === this.probeNeg) return null;
    if (!this.sim.batteryIn) return 0;
    const sign = this.probePos === "+" && this.probeNeg === "−" ? 1 : -1;
    return sign * this.sim.voltage;
  }

  private bindTabs(): void {
    document.querySelector("#left-tabs")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      const tab = btn?.dataset.tab as Workshop["tab"] | undefined;
      if (!tab) return;
      this.show(tab);
    });
    document.querySelector("#dock")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      if (btn?.dataset.sheet === "bay") this.show("bay");
      if (btn?.dataset.sheet === "motor") this.show("build");
    });
  }

  show(tab: Workshop["tab"]): void {
    this.tab = tab;
    this.sim.setWorkshop(tab === "bay" || tab === "lesson");
    document.querySelectorAll("#left-tabs button").forEach((b) => {
      b.classList.toggle("on", (b as HTMLElement).dataset.tab === tab);
    });
    for (const id of ["build", "bay", "lesson"] as const) {
      const el = document.querySelector(`#tab-${id}`) as HTMLElement | null;
      if (el) el.hidden = id !== tab;
    }
  }

  private bindKey(): void {
    const key = document.querySelector("#key");
    if (!key) return;
    let pointer = false;
    const press = (ev: Event) => {
      const btn = (ev.target as HTMLElement).closest("button");
      const pos = btn?.dataset.key as KeyPos | undefined;
      if (!pos) return false;
      this.sim.workshop = true;
      if (pos === "start") {
        this.sim.key = "start";
        this.sim.crankAge = 0;
        const up = () => {
          if (this.sim.key === "start") this.sim.key = "on";
          window.removeEventListener("pointerup", up);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("pointerup", up);
        window.addEventListener("mouseup", up);
      } else {
        this.sim.key = pos;
        if (pos === "off" || pos === "acc") this.sim.caught = false;
      }
      return true;
    };
    key.addEventListener("pointerdown", (ev) => {
      pointer = press(ev);
    });
    key.addEventListener("mousedown", (ev) => {
      if (pointer) {
        pointer = false;
        return;
      }
      press(ev);
    });
  }

  private bindFaults(): void {
    document.querySelector("#weak-bat")?.addEventListener("change", (ev) => {
      this.sim.batteryWeak = (ev.target as HTMLInputElement).checked;
      this.sim.bayMessage = this.sim.batteryWeak ? "Zayıf akü arızası seçildi." : "Akü sağlıklı.";
      this.sim.bayLevel = this.sim.batteryWeak ? "warn" : "ok";
    });
    document.querySelector("#vtec-watch")?.addEventListener("click", () => {
      this.sim.vtecForce = !this.sim.vtecForce;
    });
    for (const id of ["probe-pos", "probe-neg"] as const) {
      document.querySelector("#" + id)?.addEventListener("click", () => {
        const which = id === "probe-pos" ? "probePos" : "probeNeg";
        this[which] = this[which] === "+" ? "−" : this[which] === "−" ? "" : "+";
        const el = document.querySelector("#" + id) as HTMLElement;
        const name = id === "probe-pos" ? "Kırmızı" : "Siyah";
        el.textContent = `${name} uç: ${this[which] || "boş"}`;
      });
    }
  }

  private bindBay(): void {
    const scene = document.querySelector("#bay-scene");
    if (!scene) return;
    scene.addEventListener("pointerdown", (ev) => {
      const t = ev.target as HTMLElement;
      const handle = t.closest("[data-drag]") as HTMLElement | null;
      if (!handle) return;
      ev.preventDefault();
      try { handle.setPointerCapture((ev as PointerEvent).pointerId); } catch { /* sentetik işaretçi */ }
      this.drag = { id: handle.dataset.drag || "", x: (ev as PointerEvent).clientX, y: (ev as PointerEvent).clientY, ox: handle.offsetLeft, oy: handle.offsetTop };
      this.moved = 0;
    });
    scene.addEventListener("pointermove", (ev) => {
      if (!this.drag) return;
      const pe = ev as PointerEvent;
      const dx = pe.clientX - this.drag.x;
      const dy = pe.clientY - this.drag.y;
      this.moved += Math.abs(dx) + Math.abs(dy);
      const el = scene.querySelector(`[data-drag="${this.drag.id}"]`) as HTMLElement;
      el.style.left = `${this.drag.ox + dx}px`;
      el.style.top = `${this.drag.oy + dy}px`;
    });
    const end = () => {
      if (!this.drag) return;
      const id = this.drag.id;
      const el = scene.querySelector(`[data-drag="${id}"]`) as HTMLElement;
      const far = this.moved > 28;
      this.drag = null;
      if (id === "pos" || id === "neg") this.toggleTerm(id, far);
      else if (id === "hold") this.toggleHold(far);
      else if (id === "battery") this.toggleBattery(far);
      el.style.left = "";
      el.style.top = "";
    };
    scene.addEventListener("pointerup", end);
    scene.addEventListener("pointercancel", end);
  }

  private toggleTerm(which: "pos" | "neg", pulled: boolean): void {
    const on = which === "pos" ? this.sim.posOn : this.sim.negOn;
    const removing = on && (pulled || !pulled);
    if (on) {
      if (which === "pos" && this.sim.negOn) {
        this.sim.bayMessage = "Kıvılcım riski: önce eksi (−) kutbu sök.";
        this.sim.bayLevel = "bad";
        this.sim.events.push("snap");
        return;
      }
      if (which === "pos") this.sim.posOn = false;
      else this.sim.negOn = false;
      this.sim.bayMessage = which === "neg" ? "Eksi kutup ayrıldı." : "Artı kutup ayrıldı.";
      this.sim.bayLevel = "ok";
      return;
    }
    if (!this.sim.batteryIn) {
      this.sim.bayMessage = "Akü yuvada değil.";
      this.sim.bayLevel = "warn";
      return;
    }
    if (which === "neg" && !this.sim.posOn) {
      this.sim.bayMessage = "Önce artı (+) kutbu bağla, eksi en son gelsin.";
      this.sim.bayLevel = "bad";
      return;
    }
    if (which === "pos") this.sim.posOn = true;
    else this.sim.negOn = true;
    this.sim.bayMessage = which === "pos" ? "Artı kutup bağlandı." : "Eksi kutup bağlandı. Devre tamam.";
    this.sim.bayLevel = "ok";
    void removing;
  }

  private toggleHold(pulled: boolean): void {
    if (this.sim.holdDown) {
      if (this.sim.posOn || this.sim.negOn) {
        this.sim.bayMessage = "Kelepçeden önce kutupları sök.";
        this.sim.bayLevel = "warn";
        return;
      }
      this.sim.holdDown = false;
      this.sim.bayMessage = "Kelepçe açıldı.";
      this.sim.bayLevel = "ok";
    } else {
      if (!this.sim.batteryIn) {
        this.sim.bayMessage = "Önce aküyü yerleştir.";
        this.sim.bayLevel = "warn";
        return;
      }
      this.sim.holdDown = true;
      this.sim.bayMessage = "Kelepçe takıldı.";
      this.sim.bayLevel = "ok";
    }
    void pulled;
  }

  private toggleBattery(pulled: boolean): void {
    if (this.sim.batteryIn) {
      if (this.sim.posOn || this.sim.negOn || this.sim.holdDown) {
        this.sim.bayMessage = "Aküyü çıkarmadan önce kutuplar ve kelepçe açılmalı.";
        this.sim.bayLevel = "warn";
        return;
      }
      this.sim.batteryIn = false;
      this.sim.bayMessage = "Akü çıkarıldı.";
      this.sim.bayLevel = "ok";
    } else {
      this.sim.batteryIn = true;
      this.sim.posOn = false;
      this.sim.negOn = false;
      this.sim.holdDown = false;
      this.sim.bayMessage = "Akü yuvaya kondu. Sırayla kelepçe, artı, eksi.";
      this.sim.bayLevel = "ok";
    }
    void pulled;
  }

  private renderLessons(): void {
    const root = document.querySelector("#lessons");
    const score = document.querySelector("#lesson-score");
    if (!root) return;
    let done = 0;
    let total = 0;
    root.innerHTML = "";
    for (const lesson of LESSONS) {
      let cursor = this.progress[lesson.id] ?? 0;
      if (cursor < lesson.steps.length && lesson.steps[cursor].done(this.sim)) {
        cursor += 1;
        this.progress[lesson.id] = cursor;
      }
      done += cursor;
      total += lesson.steps.length;
      const block = document.createElement("section");
      block.className = "lesson";
      const h = document.createElement("h3");
      h.textContent = `${lesson.title} · ${cursor}/${lesson.steps.length}`;
      block.appendChild(h);
      const ol = document.createElement("ol");
      lesson.steps.forEach((step, i) => {
        const li = document.createElement("li");
        li.textContent = step.text;
        if (i < cursor) li.classList.add("done");
        else if (i === cursor) li.classList.add("now");
        ol.appendChild(li);
      });
      block.appendChild(ol);
      root.appendChild(block);
    }
    if (score) score.textContent = `Puan ${done}/${total}`;
  }
}
