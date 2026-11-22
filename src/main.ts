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

const issues = verifyLayouts();
if (issues.length) console.error(issues);

const canvas = document.querySelector("#c") as HTMLCanvasElement;
const frame = document.querySelector("#frame") as HTMLElement;

let studio: Studio;
try {
  studio = new Studio(canvas, frame);
} catch (err) {
  const box = document.querySelector("#boot-error") as HTMLElement;
  box.hidden = false;
  box.textContent = "WebGL başlatılamadı. Güncel bir masaüstü tarayıcı gerekli.";
  throw err;
}

const sim = new Simulation();
const audio = new EngineAudio();

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

window.addEventListener("pointerdown", () => {
  void audio.start().then(() => hud.setSoundLabel(true));
}, { once: true });

const resize = () => studio.resize();
window.addEventListener("resize", resize);
const observer = new ResizeObserver(() => studio.resize());
observer.observe(frame);

document.fonts.ready.then(() => studio.setEngine(new EngineAssembly(sim.spec))).catch(() => {});

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const view = hud.view();
  if (view && hud.shortsOn !== studio.shorts) studio.setShorts(hud.shortsOn);
  sim.throttle = hud.throttle;
  if (!sim.seized && !sim.heatSeize && sim.rodStage < 2) sim.targetRpm = hud.rpm;
  sim.oilLevel = hud.oilLevel;
  sim.radiatorBlocked = hud.radiatorBlocked;
  sim.spec.boostTarget = hud.spec.boostTarget;
  sim.update(dt);
  studio.update(sim, view, dt);
  audio.update(sim);
  hud.sync(sim, studio.hover);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
