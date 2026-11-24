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
    placeBattery(root, kit.battery);
    placeAlternator(root, kit.alternator);
  }).catch((err) => {
    console.warn("Motor yuvası parçaları atlandı.", err);
  });
  return root;
}

function buildShell(root: THREE.Group): void {
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.62, metalness: 0.06 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9094, roughness: 0.38, metalness: 0.78 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92, metalness: 0 });
  const satin = satinSteel(0x1c1e22);
  const bodyPaint = satinSteel(0x1a4f86);
  const alu = new THREE.MeshStandardMaterial({ color: 0xb7bcc0, roughness: 0.42, metalness: 0.72 });
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

  buildFirewall(add, satin, rubber);
  for (const x of [-0.48, 0.48] as const) {
    const side = strutSide(x, bodyPaint, steel, rubber);
    root.add(side);
  }
  buildRadiator(add, alu, plastic, rubber, steel);
  buildAirbox(add, plastic, rubber);
  buildBottle(add, -0.4, -0.08, 0.24, 0x2f6fbe, 0xd7e4ee, "Cam suyu");
  buildBottle(add, 0.42, -0.02, 0.28, 0xe2b000, 0xdfe8c8, "Genleşme kabı");

  const master = add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 12), steel), "Fren ana merkezi");
  master.rotation.x = Math.PI / 2;
  master.position.set(-0.08, 0.12, -0.3);

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

function strutSide(x: number, body: THREE.Material, steel: THREE.Material, rubber: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.58), body);
  apron.position.set(x, -0.08, 0.06);
  apron.userData.part = "İç çamurluk";
  const domePts = [
    new THREE.Vector2(0.18, 0),
    new THREE.Vector2(0.16, 0.03),
    new THREE.Vector2(0.1, 0.1),
    new THREE.Vector2(0.07, 0.2),
    new THREE.Vector2(0.062, 0.25),
    new THREE.Vector2(0.095, 0.268),
    new THREE.Vector2(0.014, 0.28),
  ];
  const dome = new THREE.Mesh(new THREE.LatheGeometry(domePts, 32), body);
  dome.position.set(x * 0.9, -0.1, 0.16);
  dome.userData.part = "Amortisör kulesi";
  const bead = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.008, 6, 24), rubber);
  bead.rotation.x = Math.PI / 2;
  bead.position.set(x * 0.9, -0.08, 0.16);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.01, 16), steel);
  plate.position.set(x * 0.9, 0.19, 0.16);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 6), steel);
  nut.position.set(x * 0.9, 0.202, 0.16);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), rubber);
  cap.scale.y = 0.65;
  cap.position.set(x * 0.9, 0.216, 0.16);
  g.add(apron, dome, bead, plate, nut, cap);
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * Math.PI * 2 + 0.4;
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.022, 6), steel);
    stud.position.set(x * 0.9 + Math.cos(a) * 0.04, 0.204, 0.16 + Math.sin(a) * 0.04);
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 6), steel);
    flange.position.set(stud.position.x, 0.192, stud.position.z);
    g.add(stud, flange);
  }
  g.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
  });
  return g;
}

function buildFirewall(
  add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh,
  satin: THREE.Material,
  rubber: THREE.Material,
): void {
  const panel = add(new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.5, 0.012), satin), "Ateş duvarı");
  panel.position.set(0, 0.04, -0.36);
  for (let i = 0; i < 4; i++) {
    const rib = add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.4, 0.028), satin));
    rib.position.set(-0.36 + i * 0.24, 0.04, -0.342);
  }
  const crease = add(new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.012, 0.02), satin));
  crease.position.set(0, 0.08, -0.346);
  const pad = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.016), rubber), "Ateş duvarı yalıtımı");
  pad.position.set(0.02, 0.02, -0.33);
  const cowl = add(new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.045, 0.09), new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.7, metalness: 0.04 })), "Kaput ızgarası");
  cowl.position.set(0, 0.28, -0.33);
  for (const x of [-0.28, 0.22]) {
    const grommet = add(new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 6, 12), rubber));
    grommet.rotation.y = Math.PI / 2;
    grommet.position.set(x, 0.1, -0.35);
    const wire = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 7), rubber), "Kablo demeti");
    wire.rotation.x = Math.PI / 2;
    wire.position.set(x, 0.1, -0.27);
  }
}

function buildRadiator(
  add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh,
  alu: THREE.Material,
  plastic: THREE.Material,
  rubber: THREE.Material,
  steel: THREE.Material,
): void {
  const core = add(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.32, 0.028), alu), "Radyatör");
  core.position.set(0, 0.02, 0.44);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, roughness: 0.35, metalness: 0.85 });
  for (let i = 0; i < 18; i++) {
    const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.003, 0.034), finMat));
    fin.position.set(0, -0.125 + i * 0.016, 0.44);
  }
  for (const side of [-1, 1]) {
    const tank = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 12), plastic));
    tank.position.set(side * 0.31, 0.02, 0.44);
  }
  const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.04, 8), plastic));
  neck.position.set(0.31, 0.2, 0.44);
  const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8), steel));
  cap.position.set(0.31, 0.226, 0.44);
  const fan = add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.018, 16), plastic));
  fan.rotation.x = Math.PI / 2;
  fan.position.set(0.0, 0.02, 0.4);
  hoseCurve(add, rubber, steel, new THREE.Vector3(-0.12, 0.16, 0.22), new THREE.Vector3(-0.05, 0.2, 0.36), new THREE.Vector3(0.12, 0.16, 0.44), "Üst hortum");
  hoseCurve(add, rubber, steel, new THREE.Vector3(-0.1, -0.08, 0.2), new THREE.Vector3(-0.02, -0.1, 0.34), new THREE.Vector3(0.1, -0.08, 0.44), "Alt hortum");
}

function hoseCurve(
  add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh,
  rubber: THREE.Material,
  steel: THREE.Material,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  name: string,
): void {
  const curve = new THREE.QuadraticBezierCurve3(a, b, c);
  add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.014, 8, false), rubber), name);
  for (const t of [0.08, 0.92]) {
    const p = curve.getPoint(t);
    const clamp = add(new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.003, 5, 10), steel));
    clamp.position.copy(p);
    clamp.lookAt(curve.getPoint(Math.min(0.98, t + 0.05)));
  }
}

function buildAirbox(
  add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh,
  plastic: THREE.Material,
  rubber: THREE.Material,
): void {
  const body = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.16), plastic), "Hava filtresi kutusu");
  body.position.set(-0.46, 0.0, 0.08);
  const lid = add(new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.02, 0.17), plastic), "Hava filtresi kapağı");
  lid.position.set(-0.46, 0.08, 0.08);
  for (const z of [-0.04, 0.04]) {
    const clip = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.025), plastic));
    clip.position.set(-0.56, 0.06, 0.08 + z);
  }
  const snorkel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.16, 10), plastic), "Hava girişi");
  snorkel.rotation.x = Math.PI / 2;
  snorkel.position.set(-0.46, 0.02, 0.22);
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.34, 0.06, 0.08),
    new THREE.Vector3(-0.22, 0.14, 0.0),
    new THREE.Vector3(-0.1, 0.18, -0.06),
  ]);
  add(new THREE.Mesh(new THREE.TubeGeometry(path, 12, 0.02, 8, false), rubber), "Emme hortumu");
  for (let i = 0; i < 7; i++) {
    const p = path.getPoint(i / 6);
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 5, 10), rubber));
    ring.position.copy(p);
    ring.lookAt(path.getPoint(Math.min(0.98, i / 6 + 0.08)));
  }
}

function buildBottle(
  add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh,
  x: number,
  y: number,
  z: number,
  capColor: number,
  fluidColor: number,
  part: string,
): void {
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0xf4f1ea,
    roughness: 0.28,
    metalness: 0.02,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const shell = add(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.15, 16), shellMat), part);
  shell.position.set(x, y, z);
  const fluid = add(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.08, 14), new THREE.MeshStandardMaterial({ color: fluidColor, roughness: 0.2, transparent: true, opacity: 0.85 })));
  fluid.position.set(x, y - 0.02, z);
  const label = bottleLabel();
  const tag = add(new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.05), new THREE.MeshStandardMaterial({ map: label, transparent: true, roughness: 0.5 })));
  tag.position.set(x + 0.048, y, z);
  const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.016, 10), new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.4 })));
  cap.position.set(x, y + 0.082, z);
}

function bottleLabel(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 96;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "rgba(255,255,255,0.15)";
    g.fillRect(0, 0, 64, 96);
    g.strokeStyle = "#222";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(8, 28);
    g.lineTo(56, 28);
    g.moveTo(8, 62);
    g.lineTo(56, 62);
    g.stroke();
    g.fillStyle = "#222";
    g.font = "12px sans-serif";
    g.fillText("MAX", 16, 24);
    g.fillText("MIN", 18, 78);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function satinSteel(hex: number): THREE.MeshStandardMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  const color = new THREE.Color(hex);
  if (g) {
    g.fillStyle = `#${color.getHexString()}`;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 400; i++) {
      const v = 18 + Math.random() * 24;
      g.fillStyle = `rgba(${v},${v},${v},${0.04 + Math.random() * 0.05})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    const dirt = g.createLinearGradient(0, 0, 0, 128);
    dirt.addColorStop(0, "rgba(0,0,0,0)");
    dirt.addColorStop(0.62, "rgba(0,0,0,0)");
    dirt.addColorStop(1, "rgba(20,16,12,0.38)");
    g.fillStyle = dirt;
    g.fillRect(0, 0, 128, 128);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.58, metalness: 0.18 });
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
  // Inboard of the accessory belt, which lives on the scan at about x=-0.29.
  alt.rotation.y = Math.PI / 2;
  alt.position.set(-0.18, 0.04, 0.0);
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
  const [battery, alternator] = await Promise.all([
    loader.loadAsync(`${base}models/bay/car_battery_cc-by.glb`),
    loader.loadAsync(`${base}models/bay/alternator_toyota_cc-by-sa.glb`),
  ]);
  return { battery: battery.scene, alternator: alternator.scene };
}
