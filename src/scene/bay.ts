import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * Procedural engine bay, one group. A scanned bay GLB can replace this group
 * later through `swapBay` without touching the car or the engine.
 */
export const BAY_NAME = "engine-bay";

interface BayKit {
  battery: THREE.Object3D;
  alternator: THREE.Object3D;
  wall: THREE.MeshStandardMaterial;
  fender: THREE.MeshStandardMaterial;
}

let kitPromise: Promise<BayKit> | null = null;

/** Replace the procedural shell with a scanned bay. The group stays put. */
export function swapBay(bay: THREE.Object3D, scanned: THREE.Object3D): void {
  const shell = bay.getObjectByName(BAY_NAME);
  if (!shell) return;
  shell.clear();
  shell.add(scanned);
}

export function mountProceduralBay(bay: THREE.Object3D, loader: GLTFLoader): THREE.Group {
  const root = new THREE.Group();
  root.name = BAY_NAME;
  buildShell(root);
  bay.add(root);
  void loadKit(loader).then((kit) => {
    if (!root.parent) return;
    paintNamed(root, "bay-wall", kit.wall);
    paintNamed(root, "bay-fender", kit.fender);
    placeBattery(root, kit.battery);
    placeAlternator(root, kit.alternator);
  }).catch((err) => {
    console.warn("Motor yuvası parçaları atlandı.", err);
  });
  return root;
}

function buildShell(root: THREE.Group): void {
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.72, metalness: 0.04 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.4, metalness: 0.75 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd7a441, roughness: 0.45, metalness: 0.15 });
  const add = (mesh: THREE.Mesh, part?: string) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (part) mesh.userData.part = part;
    root.add(mesh);
    return mesh;
  };

  const tray = add(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.02, 0.72), steel));
  tray.position.set(0.02, -0.22, 0.02);
  for (const x of [-0.32, 0.36]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.78), steel)).position.set(x, -0.2, 0.04);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6e726e, roughness: 0.72, metalness: 0.35 });
  const fenderMat = new THREE.MeshStandardMaterial({ color: 0x1a4f86, roughness: 0.45, metalness: 0.25 });
  wallMat.name = "bay-wall";
  fenderMat.name = "bay-fender";

  const firewall = add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.58, 0.035), wallMat), "Ateş duvarı");
  firewall.position.set(0, 0.04, -0.36);
  giveUv2(firewall.geometry);
  const insulation = add(new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.36, 0.012), new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.95 })));
  insulation.position.set(0, 0.06, -0.33);
  for (const x of [-0.5, 0.5]) {
    const apron = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.62), wallMat));
    apron.position.set(x, 0.02, 0.0);
    giveUv2(apron.geometry);
  }

  const coreMat = new THREE.MeshStandardMaterial({ color: 0x1a1e22, roughness: 0.55, metalness: 0.35 });
  const rad = add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.38, 0.03), coreMat), "Radyatör");
  rad.position.set(0, 0.02, 0.44);
  for (let i = 0; i < 16; i++) {
    const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.004, 0.036), new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.4, metalness: 0.7 })));
    fin.position.set(0, -0.15 + i * 0.022, 0.44);
  }
  for (const side of [-1, 1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.05), plastic)).position.set(side * 0.36, 0.02, 0.44);
  }
  const shroud = add(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.34, 0.012), plastic));
  shroud.position.set(0, 0.02, 0.41);
  const fan = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 18), plastic));
  fan.rotation.x = Math.PI / 2;
  fan.position.set(0.02, 0.02, 0.395);

  const hose = (x: number, y0: number, z: number, len: number, name: string) => {
    const h = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, len, 10), rubber), name);
    h.rotation.x = Math.PI / 2;
    h.position.set(x, y0, z);
  };
  hose(-0.16, 0.16, 0.3, 0.26, "Üst hortum");
  hose(-0.16, -0.06, 0.28, 0.24, "Alt hortum");

  const air = add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.18), plastic), "Hava filtresi kutusu");
  air.position.set(-0.46, 0.02, 0.02);
  const lid = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.025, 0.2), new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.6 })), "Hava filtresi kapağı");
  lid.position.set(-0.46, 0.11, 0.02);
  const duct = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.22, 10), rubber), "Emme hortumu");
  duct.rotation.z = Math.PI / 2;
  duct.position.set(-0.24, 0.08, -0.08);

  const washer = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0x8aa0b0, roughness: 0.28, metalness: 0.02, transparent: true, opacity: 0.72 })), "Cam suyu");
  washer.position.set(-0.42, -0.04, 0.22);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.018, 10), yellow)).position.set(-0.42, 0.04, 0.22);
  const bottle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0xc5d0c8, roughness: 0.3, transparent: true, opacity: 0.85 })), "Genleşme kabı");
  bottle.position.set(0.4, 0.04, 0.26);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.018, 8), yellow)).position.set(0.4, 0.12, 0.26);

  const master = add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 12), steel), "Fren ana merkezi");
  master.rotation.x = Math.PI / 2;
  master.position.set(-0.08, 0.12, -0.3);

  for (const x of [-0.46, 0.46]) {
    const tower = closedTower(fenderMat, steel);
    tower.position.set(x, -0.06, 0.16);
    tower.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    root.add(tower);
    const liner = add(new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 14, x > 0 ? 0.2 : Math.PI * 0.8, Math.PI * 0.55, 0.35, 1.15), fenderMat), "Çamurluk davlumbazı");
    liner.scale.set(0.55, 0.7, 0.85);
    liner.position.set(x * 1.15, -0.02, 0.08);
    giveUv2(liner.geometry);
  }

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
    new THREE.PlaneGeometry(0.9, 0.62),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(ao), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -0.2, 0.02);
  root.add(shadow);
  const lamp = new THREE.PointLight(0xfff2e0, 0.55, 2.2, 2);
  lamp.position.set(0.05, 0.42, 0.12);
  root.add(lamp);
}

function closedTower(body: THREE.Material, steel: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = "strut-tower";
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.125, 0.28, 24), body);
  shell.position.y = 0.1;
  shell.userData.part = "Amortisör kulesi";
  giveUv2(shell.geometry);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.078, 0.03, 24), body);
  lip.position.y = 0.25;
  giveUv2(lip.geometry);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 16), steel);
  plate.position.y = 0.27;
  const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 12), steel);
  bearing.position.y = 0.284;
  g.add(shell, lip, plate, bearing);
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * Math.PI * 2;
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.028, 6), steel);
    stud.position.set(Math.cos(a) * 0.042, 0.286, Math.sin(a) * 0.042);
    g.add(stud);
  }
  return g;
}

function giveUv2(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute("uv");
  if (uv && !geo.getAttribute("uv2")) geo.setAttribute("uv2", uv);
}

function paintNamed(root: THREE.Object3D, name: string, source: THREE.MeshStandardMaterial): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat?.name !== name) return;
    mesh.material = source;
  });
}

function placeBattery(root: THREE.Object3D, template: THREE.Object3D): void {
  const bat = template.clone(true);
  bat.position.set(-0.36, -0.16, -0.2);
  bat.rotation.y = 0.4;
  bat.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.part = mesh.name === "terminals" ? "Artı kutup" : "Akü";
  });
  bat.userData.part = "Akü";
  root.add(bat);
}

function placeAlternator(root: THREE.Object3D, template: THREE.Object3D): void {
  const alt = template.clone(true);
  // Accessory drive is the -X end. Keep the casting upright, pulley toward the belt.
  alt.rotation.y = 1.1;
  alt.position.set(-0.3, -0.02, 0.2);
  alt.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.part = "Alternatör";
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat?.isMeshStandardMaterial) return;
    const next = mat.clone();
    next.color.set(0x3e4340);
    next.roughness = 0.62;
    next.metalness = 0.42;
    mesh.material = next;
  });
  root.add(alt);
}

function loadKit(loader: GLTFLoader): Promise<BayKit> {
  if (!kitPromise) kitPromise = buildKit(loader);
  return kitPromise;
}

async function buildKit(loader: GLTFLoader): Promise<BayKit> {
  await MeshoptDecoder.ready;
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = import.meta.env.BASE_URL;
  const [battery, alternator, wall, fender] = await Promise.all([
    loader.loadAsync(`${base}models/bay/car_battery_cc-by.glb`),
    loader.loadAsync(`${base}models/bay/alternator_toyota_cc-by-sa.glb`),
    wallMaterial(base),
    fenderMaterial(base),
  ]);
  return { battery: battery.scene, alternator: alternator.scene, wall, fender };
}

async function wallMaterial(base: string): Promise<THREE.MeshStandardMaterial> {
  const [color, normal, rough, grime] = await Promise.all([
    map(base, "PaintedMetal014/color.webp", true),
    map(base, "PaintedMetal014/normal.webp", false),
    map(base, "PaintedMetal014/roughness.webp", false),
    map(base, "SurfaceImperfections008/color.webp", false),
  ]);
  const mat = new THREE.MeshStandardMaterial({
    name: "bay-wall",
    map: color,
    normalMap: normal,
    roughnessMap: rough,
    aoMap: grime,
    color: 0x6a645c,
    roughness: 0.9,
    metalness: 0.22,
    aoMapIntensity: 0.85,
  });
  mat.normalScale.set(0.7, 0.7);
  return mat;
}

async function fenderMaterial(base: string): Promise<THREE.MeshStandardMaterial> {
  const [color, normal, rough] = await Promise.all([
    map(base, "blue_metal_plate/color.webp", true),
    map(base, "blue_metal_plate/normal.webp", false),
    map(base, "blue_metal_plate/roughness.webp", false),
  ]);
  const mat = new THREE.MeshStandardMaterial({
    name: "bay-fender",
    map: color,
    normalMap: normal,
    roughnessMap: rough,
    color: 0xd5e4f2,
    roughness: 0.55,
    metalness: 0.35,
  });
  mat.normalScale.set(0.6, 0.6);
  return mat;
}

function map(base: string, file: string, color: boolean): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(`${base}textures/bay/${file}`).then((tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.2, 2.2);
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  });
}
