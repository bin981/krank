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
    if (view && hud.shortsOn !== studio.shorts) studio.setShorts(hud.shortsOn);
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
