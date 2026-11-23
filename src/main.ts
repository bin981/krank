import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./style.css";
import { peakTorqueRpm, verifyLayouts, type EngineSpec } from "./engine/model";
import { Simulation } from "./engine/sim";
import { EngineAudio } from "./engine/audio";
import { EngineAssembly } from "./scene/engine";
import { Studio } from "./scene/studio";
import { Hud } from "./ui";
import { Workshop } from "./workshop";
import { Hands } from "./hands";
import creditsMd from "../CREDITS.md?raw";

const WEBGL_MESSAGE =
  "Bu tarayıcı WebGL ile üç boyutlu görüntü üretemiyor. Donanım hızlandırmasını açıp sayfayı yenileyin, veya güncel bir Chrome, Firefox ya da Safari deneyin. Mobilde düşük güç modu ve eski ekran kartı sürücüleri de sahneyi boş bırakabilir.";
const LOST_MESSAGE =
  "Grafik bağlamı koptu ve sahne durdu. Sayfayı yenileyin. Düşük güç modu, başka bir sekme veya ekran kartı sürücüsü bağlamı kapatmış olabilir.";
const DRAW_MESSAGE =
  "Sahne çizilirken bir grafik hatası oluştu. Sayfayı yenileyin. Sorun sürerse donanım hızlandırmasını açın veya başka bir tarayıcı deneyin.";

const issues = verifyLayouts();
if (issues.length) console.error(issues);

const boot = document.querySelector("#boot-error");
const bootText = document.querySelector("#boot-error-text");
document.querySelector("#boot-reload")?.addEventListener("click", () => location.reload());

function showBootError(message: string): void {
  if (bootText) bootText.textContent = message;
  if (boot instanceof HTMLElement) boot.hidden = false;
}

const canvas = document.querySelector("#c");
const frame = document.querySelector("#frame");
if (!(canvas instanceof HTMLCanvasElement) || !(frame instanceof HTMLElement)) {
  showBootError(WEBGL_MESSAGE);
  throw new Error("Simülatör tuvali bulunamadı.");
}

let alive = true;
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  alive = false;
  showBootError(LOST_MESSAGE);
});

let studio: Studio;
try {
  if (!webglAvailable()) throw new Error("WebGL yok");
  studio = new Studio(canvas, frame);
} catch (err) {
  console.error(err);
  showBootError(WEBGL_MESSAGE);
  throw err;
}

const sim = new Simulation();
const audio = new EngineAudio();

const workshop = new Workshop(sim);
const hands = new Hands(studio.scene, sim);
hands.bind(() => studio.engineRoot(), () => studio.garageGroup());
hands.onTool = (tool) => studio.showTool(tool);
(window as unknown as { __krankUnscrew?: (part: string) => string }).__krankUnscrew = (part) => hands.unscrew(part);
document.querySelector("#hood")?.addEventListener("click", () => studio.toggleHood());
document.querySelector("#cover-toggle")?.addEventListener("click", (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  const on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.classList.toggle("on", on);
  studio.engineRoot()?.setCover(on);
});
document.querySelector("#hands-toggle")?.addEventListener("click", () => {
  const on = document.body.classList.toggle("hands");
  const tools = document.querySelector("#tools") as HTMLElement | null;
  if (tools) tools.hidden = !on;
});
const creditsBody = document.querySelector("#credits-body");
if (creditsBody) creditsBody.innerHTML = renderCredits(creditsMd);
document.querySelector("#credits-btn")?.addEventListener("click", () => {
  const box = document.querySelector("#credits") as HTMLElement | null;
  if (box) box.hidden = false;
});
document.querySelector("#credits-close")?.addEventListener("click", () => {
  const box = document.querySelector("#credits") as HTMLElement | null;
  if (box) box.hidden = true;
});
(window as unknown as { __krankSetScenario?: (id: string) => void }).__krankSetScenario = (id) => sim.setScenario(id);

const hud = new Hud(
  (spec) => applySpec(spec),
  (preset) => studio.frameTo(preset),
  (id) => sim.trigger(id),
  () => {
    sim.reset();
    rebuild(sim.spec, sim.targetRpm);
  },
  () => {
    void audio.start().then(() => hud.setSoundLabel(true));
  },
);

function rebuild(spec: EngineSpec, rpm: number): void {
  sim.setSpec(spec);
  sim.targetRpm = rpm;
  sim.rpm = rpm;
  sim.indicatedRpm = rpm;
  studio.setEngine(new EngineAssembly(spec));
  hud.showSpec(spec, rpm);
}

function applySpec(spec: EngineSpec): void {
  const rpm = Math.min(peakTorqueRpm(spec), sim.targetRpm > 0 ? sim.targetRpm : peakTorqueRpm(spec));
  const keep = sim.running ? Math.max(700, Math.min(rpm, peakTorqueRpm(spec))) : 0;
  rebuild(spec, keep || peakTorqueRpm(spec) * 0.65);
}

rebuild(hud.spec, 2400);
sim.throttle = 0.45;

const unlockAudio = () => {
  void audio.start().then(() => hud.setSoundLabel(true));
};
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("touchend", unlockAudio, { once: true });

const resize = () => studio.resize();
window.addEventListener("resize", resize);
const observer = new ResizeObserver(() => studio.resize());
observer.observe(frame);

document.fonts.ready.then(() => studio.setEngine(new EngineAssembly(sim.spec))).catch(() => {});

let last = performance.now();
function loop(now: number): void {
  if (!alive) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    const view = hud.view();
    if (view && hud.shortsOn !== studio.shorts) {
      studio.setShorts(hud.shortsOn);
      if (hud.shortsOn && sim.scenarioId !== "none") studio.frameTo("cine");
    }
    sim.throttle = hud.throttle;
    sim.requestedRpm = hud.rpm;
    sim.vibe = hud.vibe;
    sim.camId = hud.camId;
    sim.camLsa = hud.camLsa;
    sim.camAdvance = hud.camAdvance;
    audio.volume = hud.volume;
    audio.mixExhaust = hud.mixExhaust;
    audio.mixIntake = hud.mixIntake;
    audio.mixMech = hud.mixMech;
    if (!sim.workshop && !sim.seized && !sim.heatSeize && sim.rodStage < 2) sim.targetRpm = hud.rpm;
    sim.oilLevel = hud.oilLevel;
    sim.radiatorBlocked = hud.radiatorBlocked;
    sim.spec.boostTarget = hud.spec.boostTarget;
    sim.update(dt * hud.timeScale);
    hands.setTray(studio.benchPoint());
    studio.update(sim, view, dt);
    audio.update(sim);
    hud.sync(sim, studio.hover);
    workshop.sync();
  } catch (err) {
    alive = false;
    console.error(err);
    showBootError(DRAW_MESSAGE);
    return;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function renderCredits(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (!table.length) return;
    const rows = table.filter((row) => !/^\s*\|?\s*-{3,}/.test(row.replace(/\|/g, "")));
    const cells = rows.map((row) => row.split("|").slice(1, -1).map((c) => c.trim()));
    const head = cells[0] ?? [];
    const body = cells.slice(1).filter((c) => c.some(Boolean) && !c.every((x) => /^-+$/.test(x)));
    out.push("<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
    for (const row of body) out.push("<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
    out.push("</tbody></table>");
    table = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith("|")) {
      table.push(line);
      continue;
    }
    flush();
    if (line.startsWith("### ")) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) out.push(`<h3>${inline(line.slice(3))}</h3>`);
    else if (line.startsWith("# ")) out.push(`<h2>${inline(line.slice(2))}</h2>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join("");
}

function inline(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function webglAvailable(): boolean {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2", { failIfMajorPerformanceCaveat: false })
      ?? probe.getContext("webgl", { failIfMajorPerformanceCaveat: false });
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
