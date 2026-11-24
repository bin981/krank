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
  private hoodStrut: THREE.Mesh | null = null;
  private workLamp: THREE.SpotLight | null = null;
  private readonly strutLocal = new THREE.Vector3(0.4, -0.15, 0.35);
  private readonly strutAnchor = new THREE.Vector3();
  private readonly strutDir = new THREE.Vector3();
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
    if (this.hoodStrut) {
      const top = this.bonnet.localToWorld(this.strutLocal.clone());
      const len = this.strutDir.subVectors(this.strutAnchor, top).length();
      this.hoodStrut.position.copy(top).addScaledVector(this.strutDir, 0.5);
      this.hoodStrut.quaternion.setFromUnitVectors(Garage.up, this.strutDir.normalize());
      this.hoodStrut.scale.set(1, Math.max(0.05, len), 1);
      this.hoodStrut.visible = this.hoodOpen > 0.2;
    }
  }

  private static readonly up = new THREE.Vector3(0, 1, 0);

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
      if (this.bonnet) this.dressHood(this.bonnet);
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
    this.strutAnchor.copy(this.bay.localToWorld(new THREE.Vector3(0.42, 0.02, 0.18)));
    if (this.workLamp) {
      const target = new THREE.Object3D();
      target.position.set(0, 0.06, 0.08);
      this.bay.add(target);
      this.workLamp.target = target;
    }
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
        scan.object.position.set(-0.06, -0.2, 0.02);
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


  private dressHood(bonnet: THREE.Object3D): void {
    bonnet.updateWorldMatrix(true, true);
    const inv = bonnet.matrixWorld.clone().invert();
    const step = 0.08;
    const cells = new Map<string, { y: number; n: number }>();
    const v = new THREE.Vector3();
    const normal = new THREE.Vector3();
    bonnet.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || mesh.name.startsWith("washer")) return;
      const pos = mesh.geometry.getAttribute("position");
      const nor = mesh.geometry.getAttribute("normal");
      if (!pos || !nor) return;
      for (let i = 0; i < pos.count; i += 4) {
        normal.fromBufferAttribute(nor, i).transformDirection(mesh.matrixWorld);
        if (normal.y > -0.45) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
        if (v.z < 0.08 || v.z > 1.05 || Math.abs(v.x) > 0.58) continue;
        const ix = Math.round(v.x / step);
        const iz = Math.round(v.z / step);
        const key = `${ix},${iz}`;
        const cell = cells.get(key);
        if (!cell) cells.set(key, { y: v.y, n: 1 });
        else {
          cell.y += v.y;
          cell.n += 1;
        }
      }
    });
    const fibre = new THREE.MeshStandardMaterial({ color: 0x2a261f, roughness: 0.96, metalness: 0 });
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.4 });
    const at = (ix: number, iz: number) => cells.get(`${ix},${iz}`);
    const positions: number[] = [];
    const indices: number[] = [];
    const indexOf = new Map<string, number>();
    const vertex = (ix: number, iz: number, y: number) => {
      const key = `${ix},${iz}`;
      const existing = indexOf.get(key);
      if (existing != null) return existing;
      const id = positions.length / 3;
      indexOf.set(key, id);
      positions.push(ix * step, y - 0.01, iz * step);
      return id;
    };
    let ySum = 0;
    let yCount = 0;
    for (const [key, cell] of cells) {
      const [ix, iz] = key.split(",").map(Number);
      const y = cell.y / cell.n;
      ySum += y;
      yCount += 1;
      const right = at(ix + 1, iz);
      const up = at(ix, iz + 1);
      const diag = at(ix + 1, iz + 1);
      if (!right || !up || !diag) continue;
      const a = vertex(ix, iz, y);
      const b = vertex(ix + 1, iz, right.y / right.n);
      const c = vertex(ix + 1, iz + 1, diag.y / diag.n);
      const d = vertex(ix, iz + 1, up.y / up.n);
      indices.push(a, b, c, a, c, d);
    }
    if (indices.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const pad = new THREE.Mesh(geo, fibre);
      pad.userData.part = "Kaput yalıtımı";
      pad.castShadow = false;
      pad.receiveShadow = true;
      bonnet.add(pad);
      const yOf = (x: number, z: number) => {
        const ix = Math.round(x / step);
        const iz = Math.round(z / step);
        const cell = at(ix, iz) ?? at(ix, iz + 1) ?? at(ix, iz - 1);
        return (cell ? cell.y / cell.n : ySum / Math.max(1, yCount)) - 0.016;
      };
      const bar = (x0: number, z0: number, x1: number, z1: number, hole: boolean) => {
        const y = (yOf(x0, z0) + yOf(x1, z1)) / 2;
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 0.03) return;
        const shape = new THREE.Shape();
        shape.moveTo(-len / 2, -0.008);
        shape.lineTo(len / 2, -0.008);
        shape.lineTo(len / 2, 0.008);
        shape.lineTo(-len / 2, 0.008);
        if (hole && len > 0.07) {
          const path = new THREE.Path();
          path.absellipse(0, 0, Math.min(0.012, len * 0.22), 0.005, 0, Math.PI * 2, false, 0);
          shape.holes.push(path);
        }
        const extruded = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false });
        extruded.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(extruded, ribMat);
        mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
        mesh.rotation.y = Math.atan2(-dz, dx);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        bonnet.add(mesh);
      };
      const xs = [-0.5, 0.5];
      for (const x of xs) {
        for (let z = 0.16; z < 0.96; z += 0.12) bar(x, z, x, z + 0.12, true);
      }
      for (let x = -0.5; x < 0.5; x += 0.16) {
        bar(x, 0.16, x + 0.16, 0.16, true);
        bar(x, 0.96, x + 0.16, 0.96, true);
      }
      for (let t = 0; t < 1; t += 0.14) {
        const x0 = -0.42 + t * 0.84;
        const z0 = 0.22 + t * 0.68;
        bar(x0, z0, x0 + 0.12, z0 + 0.1, false);
        bar(-x0, z0, -x0 - 0.12, z0 + 0.1, false);
      }
      this.strutLocal.set(0.48, yOf(0.48, 0.28), 0.28);
    }
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x2c3136, roughness: 0.42, metalness: 0.72, envMapIntensity: 0.6 });
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1, 10), strutMat);
    strut.userData.part = "Kaput amortisörü";
    strut.castShadow = true;
    this.hoodStrut = strut;
    this.group.add(strut);
    const phone = window.matchMedia("(max-width: 840px)").matches;
    const lamp = new THREE.SpotLight(0xffc48a, phone ? 90 : 420, 2.6, 0.58, 0.5, 2);
    lamp.position.set(0, this.strutLocal.y - 0.02, 0.55);
    lamp.castShadow = !phone;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.bias = -0.001;
    lamp.shadow.normalBias = 0.02;
    lamp.name = "hood-lamp";
    bonnet.add(lamp);
    this.workLamp = lamp;
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
        if (!car) continue;
        if (/glass|windshield|lens/.test(mat.name) && !mat.name.includes("paint")) {
          mat.color.set(0x1e3338);
          mat.metalness = 0;
          mat.roughness = 0.06;
          mat.envMapIntensity = 1.5;
          const glass = mat as THREE.MeshPhysicalMaterial;
          if (glass.isMeshPhysicalMaterial) {
            glass.transmission = 0.62;
            glass.thickness = 0.04;
            glass.ior = 1.5;
            glass.attenuationColor = new THREE.Color(0x0c1c22);
            glass.attenuationDistance = 0.35;
          }
          mat.needsUpdate = true;
        } else if (/trim|chrome/.test(mat.name) && !mat.name.includes("paint")) {
          mat.map = null;
          mat.color.set(0x1c1e22);
          mat.metalness = 0.72;
          mat.roughness = 0.32;
          mat.envMapIntensity = 0.9;
          mat.needsUpdate = true;
        } else if (mat.name.includes("paint")) {
          mat.map = null;
          mat.aoMap = null;
          mat.color.set(0x1a4f86);
          mat.metalness = 0.62;
          mat.roughness = 0.22;
          mat.envMapIntensity = 1.2;
          const coat = mat as THREE.MeshPhysicalMaterial;
          if (coat.isMeshPhysicalMaterial) {
            coat.clearcoat = 1;
            coat.clearcoatRoughness = 0.06;
            coat.clearcoatNormalMap = flakeNormal();
            coat.clearcoatNormalScale.set(0.18, 0.18);
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

function flakeNormal(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    const img = g.createImageData(64, 64);
    for (let i = 0; i < 64 * 64; i++) {
      const nx = (Math.random() - 0.5) * 0.45;
      const ny = (Math.random() - 0.5) * 0.45;
      const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
      img.data[i * 4] = (nx * 0.5 + 0.5) * 255;
      img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function concreteMaterial(set: MapSet): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial();
  paintMaterial(mat, set, "concrete");
  return mat;
}
