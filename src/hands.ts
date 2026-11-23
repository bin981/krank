import * as THREE from "three";
import type { Simulation } from "./engine/sim";
import type { EngineAssembly } from "./scene/engine";

type Tool = "10" | "12" | "14" | "tornavida" | "pense";

interface Job {
  part: string;
  tool: Tool;
  bolts: number;
  needs?: string;
  fixes?: "misfire" | "battery" | "glow";
}

const JOBS: Job[] = [
  { part: "Eksi kutup", tool: "10", bolts: 1 },
  { part: "Artı kutup", tool: "10", bolts: 1, needs: "Eksi kutup" },
  { part: "Akü kelepçesi", tool: "10", bolts: 2, needs: "Artı kutup" },
  { part: "Akü", tool: "10", bolts: 0, needs: "Akü kelepçesi", fixes: "battery" },
  { part: "Hava filtresi kapağı", tool: "tornavida", bolts: 4 },
  { part: "Supap kapağı", tool: "10", bolts: 6 },
  { part: "Bobin", tool: "10", bolts: 4, fixes: "misfire" },
  { part: "Buji", tool: "14", bolts: 1 },
  { part: "Kızdırma bujisi", tool: "12", bolts: 1, fixes: "glow" },
  { part: "Common-rail", tool: "12", bolts: 2 },
  { part: "Triger kapağı", tool: "10", bolts: 5 },
  { part: "Triger kayışı", tool: "pense", bolts: 0, needs: "Triger kapağı" },
  { part: "Triger zinciri", tool: "pense", bolts: 0, needs: "Triger kapağı" },
  { part: "Aksesuar kayışı", tool: "pense", bolts: 0 },
  { part: "Alternatör", tool: "14", bolts: 2, needs: "Aksesuar kayışı" },
];

interface Removed {
  object: THREE.Object3D;
  parent: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  job: Job;
}

/** Parça sökme: doğru alet, cıvata sayısı, tepsiye koyma. */
export class Hands {
  tool: Tool = "10";
  message = "Bir alet seç, sonra parçaya dokun.";
  private bolts = new Map<string, number>();
  private removed: Removed[] = [];
  private readonly tray = new THREE.Group();

  constructor(private readonly scene: THREE.Scene, private readonly sim: Simulation) {
    this.tray.position.set(6.6, 1.2, 1.1);
    this.scene.add(this.tray);
  }

  unscrew(part: string): string {
    let found: THREE.Object3D | null = null;
    this.scene.traverse((obj) => {
      if (!found && obj.userData.part === part) found = obj;
    });
    if (!found) {
      this.message = `${part} yok.`;
      return this.message;
    }
    this.click(null, found);
    const note = document.querySelector("#hands-note");
    if (note) note.textContent = this.message;
    return this.message;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.message = `${this.toolLabel(tool)} seçili.`;
  }

  click(_root: THREE.Object3D | null, hit: THREE.Object3D | null): void {
    if (!hit) return;
    let node: THREE.Object3D | null = hit;
    let name = "";
    while (node) {
      if (typeof node.userData.part === "string") {
        name = node.userData.part;
        break;
      }
      node = node.parent;
    }
    if (!node || !name) return;
    const already = this.removed.find((r) => r.object === node || r.job.part === name);
    if (already && (already.object === node || node.parent === this.tray)) {
      this.reinstall(already);
      return;
    }
    const job = JOBS.find((j) => j.part === name);
    if (!job) {
      this.message = `${name} elle sökülmüyor. Kapak, kayış, bobin veya alternatör dene.`;
      return;
    }
    if (job.needs && !this.removed.some((r) => r.job.part === job.needs)) {
      this.message = `Önce ${job.needs.toLocaleLowerCase("tr")} çıkmalı.`;
      return;
    }
    if (this.tool !== job.tool) {
      this.message = `${name} için ${this.toolLabel(job.tool)} gerekir.`;
      return;
    }
    const left = (this.bolts.get(name) ?? job.bolts) - (job.bolts === 0 ? job.bolts : 1);
    if (job.bolts === 0 || left <= 0) {
      this.bolts.set(name, 0);
      this.takeOff(node, job);
      return;
    }
    this.bolts.set(name, left);
    const live = node.children.filter((c) => c.userData.bolt && c.visible);
    const bolt = live[live.length - 1];
    if (bolt) {
      bolt.visible = false;
      bolt.position.y += 0.15;
    } else {
      node.rotation.y += 0.35;
    }
    this.message = `${name}: ${left} cıvata kaldı.`;
  }

  explode(on: boolean): void {
    const slider = document.querySelector("#explode") as HTMLInputElement | null;
    if (slider) {
      slider.value = on ? "70" : "0";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  private takeOff(object: THREE.Object3D, job: Job): void {
    const parent = object.parent ?? this.scene;
    const position = object.position.clone();
    const quaternion = object.quaternion.clone();
    this.tray.attach(object);
    const i = this.removed.length;
    object.position.set((i % 3) * 0.28, 0.05, Math.floor(i / 3) * 0.22);
    object.rotation.set(0.2, 0.4, 0);
    this.removed.push({ object, parent, position, quaternion, job });
    this.message = `${job.part} tepside. Yerine takmak için tekrar dokun.`;
    if (job.fixes === "misfire") {
      this.sim.misfireCyl = -1;
      if (this.sim.scenarioId === "misfire-coil") this.sim.setScenario("none");
      this.message = "Arızalı bobin çıktı. Yeni bobin takılınca tekleme biter.";
    }
    if (job.fixes === "battery") {
      this.sim.batteryWeak = false;
      if (this.sim.scenarioId === "weak-battery" || this.sim.scenarioId === "dead-battery") this.sim.setScenario("none");
      this.message = "Akü tepside. Yeni akü takılınca marş düzelir.";
    }
  }

  private reinstall(item: Removed): void {
    if (this.tool !== item.job.tool && item.job.bolts > 0) {
      this.message = `Takmak için de ${this.toolLabel(item.job.tool)} gerekir.`;
      return;
    }
    item.parent.attach(item.object);
    item.object.position.copy(item.position);
    item.object.quaternion.copy(item.quaternion);
    this.removed = this.removed.filter((r) => r !== item);
    this.bolts.set(item.job.part, item.job.bolts);
    this.message = `${item.job.part} yerine takıldı.`;
    if (item.job.fixes === "battery") this.sim.batteryWeak = false;
  }

  bind(rootGetter: () => EngineAssembly | null, extraGetter?: () => THREE.Object3D | null): void {
    document.querySelector("#tools")?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("button");
      const tool = btn?.dataset.tool as Tool | undefined;
      if (!tool) return;
      this.setTool(tool);
      document.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("on", b === btn));
    });
    document.querySelector("#explode-toggle")?.addEventListener("click", (ev) => {
      const on = !(ev.currentTarget as HTMLButtonElement).classList.contains("on");
      (ev.currentTarget as HTMLButtonElement).classList.toggle("on", on);
      this.explode(on);
    });
    const canvas = document.querySelector("#c");
    canvas?.addEventListener("pointerdown", (ev) => {
      if (!document.body.classList.contains("hands")) return;
      const engine = rootGetter();
      if (!engine) return;
      const rect = (canvas as HTMLCanvasElement).getBoundingClientRect();
      const pe = ev as PointerEvent;
      const x = ((pe.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((pe.clientY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      const cam = (window as unknown as { __krankCamera?: THREE.Camera }).__krankCamera;
      if (!cam) return;
      ray.setFromCamera(new THREE.Vector2(x, y), cam);
      const roots: THREE.Object3D[] = [engine.root];
      const extra = extraGetter?.();
      if (extra) roots.push(extra);
      const hits = ray.intersectObjects(roots, true);
      this.click(engine.root, hits[0]?.object ?? null);
      const note = document.querySelector("#hands-note");
      if (note) note.textContent = this.message;
    });
  }

  private toolLabel(tool: Tool): string {
    if (tool === "tornavida") return "Tornavida";
    if (tool === "pense") return "Pense";
    return `${tool} mm lokma`;
  }
}
