import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Simulation } from "../engine/sim";
import type { ViewState } from "../view";
import { EngineAssembly } from "./engine";

export type CameraPreset = "threequarter" | "side" | "top" | "front" | "shorts";

export class Studio {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly css: CSS2DRenderer;
  readonly controls: OrbitControls;
  readonly clipPlanes: THREE.Plane[] = [];
  readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.06);
  readonly fireLight = new THREE.PointLight(0xff6a2a, 0, 2.4, 2);
  hover = "";
  shorts = false;

  private engine: EngineAssembly | null = null;
  private readonly frameEl: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private desired: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private center = new THREE.Vector3(0, 1.2, 0);
  private dist = 7;
  private preset: CameraPreset = "threequarter";
  private interacting = false;

  constructor(canvas: HTMLCanvasElement, frame: HTMLElement) {
    this.frameEl = frame;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 80);
    this.scene.background = new THREE.Color(0x10120e);
    this.scene.fog = new THREE.Fog(0x10120e, 14, 32);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    env.dispose();
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff1dc, 2.8);
    key.position.set(5.5, 8.5, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 28;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.00035;
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xd7d2c4, 0.18));
    this.scene.add(new THREE.HemisphereLight(0xc9d4e4, 0x2a261c, 0.55));
    const rim = new THREE.DirectionalLight(0xc5dcff, 1.55);
    rim.position.set(-6, 4, -4);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffe2c4, 0.65);
    fill.position.set(-2, 2.2, 6);
    this.scene.add(fill);
    const kick = new THREE.DirectionalLight(0xe7ffb0, 0.35);
    kick.position.set(0, 1.5, -6);
    this.scene.add(kick);

    this.fireLight.castShadow = false;
    this.scene.add(this.fireLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(10, 80),
      new THREE.MeshStandardMaterial({ color: 0x141611, roughness: 0.88, metalness: 0.12 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(12, 24, 0x3c4334, 0x23281f);
    const gridMat = grid.material;
    const mats = Array.isArray(gridMat) ? gridMat : [gridMat];
    for (const m of mats) {
      m.transparent = true;
      m.opacity = 0.45;
    }
    grid.position.y = 0.004;
    this.scene.add(grid);

    const spot = radialTexture();
    const backdrop = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 64),
      new THREE.MeshBasicMaterial({ map: spot, transparent: true, depthWrite: false }),
    );
    backdrop.position.set(0, 1.6, -4.2);
    this.scene.add(backdrop);

    this.css = new CSS2DRenderer();
    this.css.domElement.style.position = "absolute";
    this.css.domElement.style.inset = "0";
    this.css.domElement.style.pointerEvents = "none";
    frame.appendChild(this.css.domElement);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 18;
    this.controls.target.copy(this.center);
    this.controls.addEventListener("start", () => {
      this.desired = null;
      this.interacting = true;
    });

    canvas.addEventListener("pointermove", (ev) => this.pick(ev));
    canvas.addEventListener("pointerleave", () => {
      this.hover = "";
    });

    this.resize();
  }

  setEngine(engine: EngineAssembly): void {
    if (this.engine) {
      this.scene.remove(this.engine.root);
      this.engine.dispose();
    }
    this.engine = engine;
    this.scene.add(engine.root);
    engine.root.position.set(0, -engine.feetY * engine.root.scale.y, 0);
    engine.basePos.copy(engine.root.position);
    engine.root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(engine.root);
    box.getCenter(this.center);
    const size = box.getSize(new THREE.Vector3());
    this.dist = Math.max(size.x, size.y, size.z) * 1.48;
    this.center.y = box.min.y + size.y * 0.46;
    this.frameTo(this.shorts ? "shorts" : this.preset === "shorts" ? "threequarter" : this.preset, true);
    engine.refreshBadge();
  }

  setShorts(on: boolean): void {
    this.shorts = on;
    this.camera.fov = on ? 30 : 34;
    this.camera.updateProjectionMatrix();
    this.frameTo(on ? "shorts" : "threequarter", false);
    this.resize();
  }

  frameTo(preset: CameraPreset, instant = false): void {
    this.preset = preset;
    const t = this.center.clone();
    const d = this.dist;
    const pos = new THREE.Vector3();
    if (preset === "side") pos.set(d * 1.2, t.y + d * 0.05, 0.2);
    else if (preset === "top") pos.set(0.15, t.y + d * 1.15, 0.15);
    else if (preset === "front") pos.set(t.x * 0.2, t.y + d * 0.05, d * 1.05);
    else if (preset === "shorts") pos.set(t.x + d * 0.38, t.y + d * 0.02, d * 0.58);
    else pos.set(t.x + d * 0.78, t.y + d * 0.34, t.z + d * 0.86);
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(t);
      this.desired = null;
      this.controls.update();
    } else {
      this.desired = { pos, target: t };
    }
  }

  resize(): void {
    const w = this.frameEl.clientWidth || 1;
    const h = this.frameEl.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.css.setSize(w, h);
  }

  update(sim: Simulation, view: ViewState, dt: number): void {
    this.controls.autoRotate = view.spin && !this.desired;
    this.controls.autoRotateSpeed = 0.8;
    if (this.desired) {
      this.camera.position.lerp(this.desired.pos, 0.1);
      this.controls.target.lerp(this.desired.target, 0.1);
      if (this.camera.position.distanceTo(this.desired.pos) < 0.04) this.desired = null;
    }
    if (this.interacting || view.spin || this.desired) this.controls.update();
    else this.camera.lookAt(this.controls.target);
    this.engine?.update(sim, view, dt, this.fireLight);
    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
  }

  private pick(ev: PointerEvent): void {
    if (!this.engine) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.engine.root, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (typeof obj.userData.part === "string") {
          this.hover = obj.userData.part;
          return;
        }
        obj = obj.parent;
      }
    }
    this.hover = "";
  }
}

function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d");
  if (g) {
    const grd = g.createRadialGradient(256, 256, 20, 256, 256, 250);
    grd.addColorStop(0, "rgba(255,244,220,0.18)");
    grd.addColorStop(0.45, "rgba(255,244,220,0.05)");
    grd.addColorStop(1, "rgba(255,244,220,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
