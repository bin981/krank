import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { EngineAssembly } from "./engine";
import { loadPbr, paintMaterial, type MapSet } from "./pbr";

/**
 * Gerçek atölye ve aile sedanı. Motor, kaputtaki yer tutucu kutunun yerine oturur.
 * Birimler metre, +Y yukarı, +Z öne.
 */
export class Garage {
  readonly group = new THREE.Group();
  private bonnet: THREE.Object3D | null = null;
  private hoodOpen = 0;
  private hoodTarget = 1;
  private readonly bay = new THREE.Group();
  private baySize = new THREE.Vector3(1.15, 0.62, 0.78);
  private ready = false;
  private pending: EngineAssembly | null = null;
  private readonly tools = new Map<string, THREE.Object3D>();
  private activeTool = "10";
  benchTop = new THREE.Vector3(3.2, 0.92, -1.2);
  focus = new THREE.Vector3(-2.2, 0.9, 1.1);
  onReady: ((center: THREE.Vector3) => void) | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.group.name = "workshop";
    void this.load(renderer);
  }

  toggleHood(): void {
    this.hoodTarget = this.hoodTarget > 0.5 ? 0 : 1;
  }

  mount(engine: EngineAssembly): void {
    this.pending = engine;
    if (this.ready) this.place();
  }

  showTool(id: string): void {
    this.activeTool = id;
    const key = id === "14" || id === "tornavida" ? "wrench" : id === "pense" ? "wrench" : "ratchet";
    for (const [name, obj] of this.tools) {
      const on = name === key;
      obj.position.y = (obj.userData.restY as number) + (on ? 0.12 : 0);
      obj.rotation.z = on ? 0.4 : (obj.userData.restZ as number) ?? 0;
    }
  }

  update(dt: number): void {
    if (!this.bonnet) return;
    this.hoodOpen += (this.hoodTarget - this.hoodOpen) * Math.min(1, dt * 3.2);
    this.bonnet.rotation.x = -this.hoodOpen * 1.05;
  }

  private async load(renderer: THREE.WebGLRenderer): Promise<void> {
    try {
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      const ktx2 = new KTX2Loader();
      ktx2.setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
      ktx2.detectSupport(renderer);
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.setKTX2Loader(ktx2);
      const base = import.meta.env.BASE_URL;
      const [building, car] = await Promise.all([
        loader.loadAsync(`${base}models/workshop/workshop-building.glb`),
        loader.loadAsync(`${base}models/cars/family-sedan.glb`),
      ]);
      this.dress(building.scene);
      this.group.add(building.scene);

      const sedan = car.scene;
      sedan.position.set(-2.15, 0, 0.85);
      this.dress(sedan);
      this.group.add(sedan);
      this.bonnet = sedan.getObjectByName("bonnet") ?? null;
      this.fitEngineBay(sedan);
      this.ready = true;
      this.place();
      this.onReady?.(this.focus.clone());

      void this.loadRest(loader, base);
      void this.loadFloor();
    } catch (err) {
      console.error("Atölye modeli yüklenemedi.", err);
    }
  }

  private async loadRest(loader: GLTFLoader, base: string): Promise<void> {
    const place = async (file: string, x: number, y: number, z: number, rotY = 0) => {
      const gltf = await loader.loadAsync(`${base}models/workshop/${file}`);
      gltf.scene.position.set(x, y, z);
      gltf.scene.rotation.y = rotY;
      this.dress(gltf.scene);
      this.group.add(gltf.scene);
      return gltf.scene;
    };
    try {
      await place("two-post-lift.glb", 2.7, 0, 1.1, Math.PI);
      const chest = await place("tool-chest-bench.glb", -5.4, 0, -1.6, 0.4);
      const salvage = await place("salvage-workbench.glb", 3.4, 0, -1.5, -0.6);
      await place("engine-hoist-stand.glb", 0.4, 0, -3.2, 0.8);
      const top = new THREE.Box3().setFromObject(salvage);
      this.benchTop.set(3.15, top.max.y + 0.02, -1.35);
      const chestBox = new THREE.Box3().setFromObject(chest);
      await this.loadProps(loader, base, chestBox.max.y);
    } catch (err) {
      console.warn("Atölye ekleri atlandı.", err);
    }
  }

  private async loadProps(loader: GLTFLoader, base: string, chestY: number): Promise<void> {
    const specs: { file: string; key: string; x: number; z: number }[] = [
      { file: "ratchet_wrench.glb", key: "ratchet", x: -5.15, z: -1.35 },
      { file: "combination-wrench.glb", key: "wrench", x: -5.55, z: -1.45 },
      { file: "retro_multimeter.glb", key: "meter", x: -4.9, z: -1.7 },
      { file: "metal_toolbox.glb", key: "box", x: -5.7, z: -1.9 },
      { file: "pump-oil-can.glb", key: "oil", x: -4.7, z: -1.45 },
    ];
    for (const spec of specs) {
      try {
        const gltf = await loader.loadAsync(`${base}models/props/${spec.file}`);
        const obj = gltf.scene;
        this.fitHeight(obj, spec.key === "box" ? 0.28 : 0.22);
        obj.position.set(spec.x, chestY + 0.01, spec.z);
        obj.userData.restY = obj.position.y;
        obj.userData.restZ = obj.rotation.z;
        this.dress(obj);
        this.group.add(obj);
        this.tools.set(spec.key, obj);
      } catch (err) {
        console.warn(spec.file, err);
      }
    }
    this.showTool(this.activeTool);
  }

  private async loadFloor(): Promise<void> {
    try {
      const lib = await loadPbr();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
      paintMaterial(mat, lib.concrete, "concrete");
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(28, 22), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -0.02;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    } catch (err) {
      console.warn("Zemin dokusu atlandı.", err);
    }
  }

  private fitEngineBay(sedan: THREE.Object3D): void {
    sedan.getObjectByName("bays")?.removeFromParent();
    // Krank ekseni. Kaput alt çizgisi ~0.95 m, şasi ~0.28 m.
    this.bay.position.set(0, 0.5, 1.5);
    this.baySize.set(1.15, 0.7, 0.95);
    sedan.add(this.bay);
    sedan.updateWorldMatrix(true, true);
    this.focus.copy(this.bay.getWorldPosition(new THREE.Vector3()));
  }

  private place(): void {
    const engine = this.pending;
    if (!engine) return;
    this.bay.clear();
    engine.root.traverse((obj) => {
      if (obj.userData.stand) obj.visible = false;
    });
    this.bay.add(engine.root);
    const span = Math.max(280, engine.blockMm);
    const scale = 0.6 / span;
    engine.root.rotation.set(0, 0, 0);
    engine.root.scale.setScalar(scale);
    engine.root.position.set(-0.06, 0, 0.02);
    engine.basePos.copy(engine.root.position);
    this.fillBay();
  }

  private fillBay(): void {
    const plastic = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.72, metalness: 0.04 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.4, metalness: 0.75 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0 });
    const dirty = new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: 0.84, metalness: 0.08 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd7a441, roughness: 0.45, metalness: 0.15 });
    const add = (mesh: THREE.Mesh, part?: string) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (part) mesh.userData.part = part;
      this.bay.add(mesh);
      return mesh;
    };

    const tray = add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.02, 0.85), new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.88, metalness: 0.12 })));
    tray.position.set(0.02, -0.22, 0.04);
    for (const x of [-0.34, 0.38]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.92), steel)).position.set(x, -0.2, 0.05);
    }
    for (const z of [-0.22, 0.28]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.035, 0.05), steel)).position.set(0.02, -0.18, z);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.1), rubber)).position.set(-0.32, -0.1, 0.05);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.08), rubber)).position.set(0.36, -0.08, -0.02);

    const firewall = add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.62, 0.04), dirty));
    firewall.position.set(0, 0.05, -0.46);
    const insulation = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.015), new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.95 })));
    insulation.position.set(0, 0.08, -0.43);

    const rad = add(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.045), new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.45, metalness: 0.55 })), "Radyatör");
    rad.position.set(0, 0.06, 0.58);
    const fan = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 20), plastic));
    fan.rotation.x = Math.PI / 2;
    fan.position.set(0.05, -0.02, 0.56);
    for (let i = 0; i < 6; i++) {
      const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.008), plastic));
      const a = (i / 6) * Math.PI * 2;
      blade.position.set(0.05 + Math.cos(a) * 0.08, -0.02 + Math.sin(a) * 0.08, 0.55);
      blade.rotation.z = a;
    }
    const hose = (y0: number, name: string) => {
      const h = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), rubber), name);
      h.rotation.x = Math.PI / 2;
      h.position.set(-0.22, y0, 0.38);
    };
    hose(0.12, "Üst hortum");
    hose(-0.12, "Alt hortum");

    const air = add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.22), plastic), "Hava filtresi kutusu");
    air.position.set(-0.48, 0.02, -0.12);
    const lid = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.24), new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.6 })), "Hava filtresi kapağı");
    lid.position.set(-0.48, 0.13, -0.12);
    const duct = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.36, 8), rubber), "Emme hortumu");
    duct.rotation.z = Math.PI / 2;
    duct.position.set(-0.22, 0.08, -0.18);

    const battery = new THREE.Group();
    battery.position.set(0.46, -0.06, -0.22);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.16), plastic);
    body.userData.part = "Akü";
    const hold = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.04), steel);
    hold.position.y = 0.09;
    hold.userData.part = "Akü kelepçesi";
    const neg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8), steel);
    neg.position.set(-0.06, 0.09, 0.04);
    neg.userData.part = "Eksi kutup";
    const pos = neg.clone();
    pos.position.x = 0.06;
    pos.userData.part = "Artı kutup";
    battery.add(body, hold, neg, pos);
    battery.userData.part = "Akü";
    this.bay.add(battery);

    const fuse = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), plastic), "Sigorta kutusu");
    fuse.position.set(0.48, 0.16, 0.05);
    const washer = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.12), new THREE.MeshStandardMaterial({ color: 0x8aa0b0, roughness: 0.28, metalness: 0.02, transparent: true, opacity: 0.72 })), "Cam suyu");
    washer.position.set(-0.5, -0.02, 0.32);
    const bottle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0xc5d0c8, roughness: 0.3, transparent: true, opacity: 0.85 })), "Genleşme kabı");
    bottle.position.set(0.5, 0.08, 0.22);
    const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8), yellow));
    cap.position.set(0.5, 0.17, 0.22);

    const master = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), steel), "Fren ana merkezi");
    master.rotation.x = Math.PI / 2;
    master.position.set(-0.12, 0.16, -0.4);
    const reservoir = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xd7e2dc, roughness: 0.25, transparent: true, opacity: 0.8 })), "Fren hidroliği");
    reservoir.position.set(-0.12, 0.22, -0.38);

    for (const x of [-0.55, 0.58]) {
      const tower = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.42, 12), steel), "Amortisör kulesi");
      tower.position.set(x, 0.12, 0.38);
      const liner = add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 12, 0, Math.PI, 0.2, 1.4), plastic), "Çamurluk davlumbazı");
      liner.scale.set(0.45, 0.9, 1);
      liner.position.set(x * 1.15, -0.08, 0.02);
    }

    const loom = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 7), rubber), "Kablo demeti");
    loom.rotation.z = Math.PI / 2;
    loom.position.set(0.1, 0.02, -0.38);
    const vac = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 6), rubber), "Vakum hortumu");
    vac.rotation.z = 0.4;
    vac.position.set(-0.05, 0.18, -0.2);

    const ao = document.createElement("canvas");
    ao.width = ao.height = 128;
    const g = ao.getContext("2d");
    if (g) {
      const grd = g.createRadialGradient(64, 64, 8, 64, 64, 60);
      grd.addColorStop(0, "rgba(0,0,0,0.55)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.55),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(ao), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -0.155, 0.02);
    this.bay.add(shadow);
  }

  private dress(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (typeof mat.emissiveIntensity === "number" && mat.emissiveIntensity > 0.8) mat.emissiveIntensity = 0.35;
      }
    });
  }

  private fitHeight(obj: THREE.Object3D, target: number): void {
    obj.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(obj);
    const h = box.getSize(new THREE.Vector3()).y || 1;
    obj.scale.setScalar(target / h);
  }
}

export function concreteMaterial(set: MapSet): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial();
  paintMaterial(mat, set, "concrete");
  return mat;
}
