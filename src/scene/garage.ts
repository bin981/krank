import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { EngineAssembly } from "./engine";
import { loadPbr, paintMaterial, type MapSet } from "./pbr";
import { loadK24Scan } from "./k24";
import { mountProceduralBay } from "./bay";

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
  private k24Task: Promise<void> | null = null;
  private k24Root: THREE.Object3D | null = null;
  private k24Height = 0.55;
  private loader: GLTFLoader | null = null;
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
      this.loader = loader;
      const base = import.meta.env.BASE_URL;
      const [building, car] = await Promise.all([
        loader.loadAsync(`${base}models/workshop/workshop-building.glb`),
        loader.loadAsync(`${base}models/cars/family-sedan.glb`),
      ]);
      this.dress(building.scene);
      this.group.add(building.scene);

      const sedan = car.scene;
      sedan.position.set(-2.15, 0, 0.85);
      this.dress(sedan, true);
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
    if (this.k24Root) this.bay.add(this.k24Root);
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
    if (this.loader) mountProceduralBay(this.bay, this.loader);
    this.ensureScan(engine);
  }

  private ensureScan(engine: EngineAssembly): void {
    const phone = window.matchMedia("(max-width: 840px)").matches;
    if (!this.k24Task) {
      this.k24Task = loadK24Scan(phone).then((scan) => {
        scan.object.position.set(-0.02, -0.2, 0.02);
        this.bay.add(scan.object);
        this.k24Root = scan.object;
        this.k24Height = scan.height;
        (this.pending ?? engine).attachScan(scan.object, scan.object.position.clone(), scan.height);
        const stand = scan.object.clone(true);
        stand.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat?.clippingPlanes) {
            mesh.material = mat.clone();
            (mesh.material as THREE.MeshStandardMaterial).clippingPlanes = [];
          }
        });
        stand.position.set(0.45, 0.92, -3.15);
        stand.rotation.y += 0.8;
        this.group.add(stand);
      }).catch((err) => {
        console.error("K24 taraması yüklenemedi.", err);
      });
    } else if (this.k24Root) {
      engine.attachScan(this.k24Root, this.k24Root.position.clone(), this.k24Height);
    }
  }


  private dress(root: THREE.Object3D, car = false): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (!mat?.isMaterial) continue;
        if (typeof mat.emissiveIntensity === "number" && mat.emissiveIntensity > 0.8) mat.emissiveIntensity = 0.35;
        // Body paint is a KTX2 with a red smear on one side. Drop it for a solid clearcoat.
        const paint = car && (mat.name.includes("paint") || mat.map != null);
        if (paint) {
          mat.map = null;
          mat.aoMap = null;
          if (mat.name.includes("paint")) {
            mat.color.set(0x1a4f86);
            mat.metalness = 0.48;
            mat.roughness = 0.36;
            const coat = mat as THREE.MeshPhysicalMaterial;
            if (coat.isMeshPhysicalMaterial) {
              coat.clearcoat = 0.4;
              coat.clearcoatRoughness = 0.28;
            }
          }
          mat.needsUpdate = true;
        }
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
