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
  transaxle: THREE.Object3D;
  coolant: THREE.Object3D;
  washer: THREE.Object3D;
  master: THREE.Object3D;
  boot: THREE.Object3D;
  fuse: THREE.Object3D;
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
    placeRealParts(root, kit);
  }).catch((err) => {
    console.warn("Motor yuvası parçaları atlandı.", err);
  });
  return root;
}

function buildShell(root: THREE.Group): void {
  const plastic = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.78,
    metalness: 0.04,
    envMapIntensity: 0.55,
    roughnessMap: dustMap(),
  });
  void new THREE.TextureLoader()
    .loadAsync(`${import.meta.env.BASE_URL}textures/bay/SurfaceImperfections008/color.webp`)
    .then((tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
      tex.colorSpace = THREE.NoColorSpace;
      plastic.roughnessMap = tex;
      plastic.needsUpdate = true;
    })
    .catch(() => undefined);
  const steel = wornBolt();
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, metalness: 0, roughnessMap: dustMap() });
  const satin = satinSteel(0x1c1e22);
  const bodyPaint = satinSteel(0x1a4f86);
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

  buildFirewall(add, satin, rubber, steel);
  buildCoreSupport(add, plastic, steel, rubber);
  buildSubframe(add, steel);
  for (const x of [-0.48, 0.48] as const) {
    const side = strutSide(x, bodyPaint, steel, rubber);
    root.add(side);
  }
  buildRadiator(add, plastic, rubber, steel);
  buildAirbox(add, plastic, rubber);

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
  const lamp = new THREE.PointLight(0xfff2e0, 0.28, 1.8, 2);
  lamp.position.set(0.05, 0.36, 0.22);
  root.add(lamp);
}

function strutSide(x: number, body: THREE.Material, steel: THREE.Material, rubber: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.14, 0.62), body);
  apron.position.set(x * 0.86, -0.08, 0.08);
  apron.userData.part = "İç çamurluk";
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.62), body);
  shelf.position.set(x * 0.98, -0.015, 0.08);
  // Low stamped dome: about 10 cm above the apron, 15 cm top plate. No cone.
  const domePts = [
    new THREE.Vector2(0.155, 0),
    new THREE.Vector2(0.148, 0.012),
    new THREE.Vector2(0.11, 0.04),
    new THREE.Vector2(0.078, 0.072),
    new THREE.Vector2(0.074, 0.09),
    new THREE.Vector2(0.02, 0.1),
  ];
  const dome = new THREE.Mesh(new THREE.LatheGeometry(domePts, 36), body);
  dome.position.set(x * 0.95, -0.015, 0.14);
  dome.userData.part = "Amortisör kulesi";
  const bead = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.006, 6, 28), rubber);
  bead.rotation.x = Math.PI / 2;
  bead.position.set(x * 0.95, -0.01, 0.14);
  const plate = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8), body);
  plate.scale.y = 0.16;
  plate.position.set(x * 0.95, 0.078, 0.14);
  g.add(apron, shelf, dome, bead, plate);
  for (let s = 0; s < 3; s++) {
    const a = (s / 3) * Math.PI * 2 + 0.5;
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 6), steel);
    stud.position.set(x * 0.95 + Math.cos(a) * 0.042, 0.092, 0.14 + Math.sin(a) * 0.042);
    g.add(stud);
  }
  const liner = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 16, 12, x > 0 ? 0.15 : Math.PI * 0.85, Math.PI * 0.55, 0.55, 1.1),
    grimePlastic(),
  );
  liner.scale.set(x > 0 ? 0.38 : 0.55, 0.62, 0.85);
  liner.position.set(x * (x > 0 ? 1.38 : 1.22), -0.08, 0.12);
  liner.userData.part = "Çamurluk davlumbazı";
  g.add(liner);
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
  steel: THREE.Material,
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
  const cowlMat = new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.72, metalness: 0.04 });
  const cowl = add(new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 0.16), cowlMat), "Kaput ızgarası");
  cowl.position.set(0, 0.22, -0.28);
  const motor = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.05), cowlMat), "Silecek motoru");
  motor.position.set(0.08, 0.2, -0.22);
  for (const x of [-0.22, 0.28]) {
    const arm = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.012), steel));
    arm.position.set(x, 0.22, -0.2);
  }
  const loom = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 8), rubber), "Kablo demeti");
  loom.rotation.z = Math.PI / 2;
  loom.position.set(0, 0.16, -0.34);
  for (const x of [-0.22, 0.16]) {
    const hose = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), rubber), "Kalorifer hortumu");
    hose.rotation.x = 1.1;
    hose.position.set(x, 0.06, -0.26);
  }
  for (const x of [-0.28, 0.22]) {
    const grommet = add(new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 6, 12), rubber));
    grommet.rotation.y = Math.PI / 2;
    grommet.position.set(x, 0.12, -0.35);
    const wire = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 7), rubber));
    wire.rotation.x = Math.PI / 2;
    wire.position.set(x, 0.12, -0.28);
  }
}

function buildCoreSupport(
  add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh,
  plastic: THREE.Material,
  steel: THREE.Material,
  rubber: THREE.Material,
): void {
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.62, metalness: 0.22 });
  const panel = add(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.2, 0.016), dark), "Ön panel");
  panel.position.set(0, -0.02, 0.52);
  for (let i = 0; i < 5; i++) {
    const rib = add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.18, 0.022), dark));
    rib.position.set(-0.32 + i * 0.16, -0.02, 0.53);
  }
  for (const x of [-0.22, 0.22]) {
    const hole = add(new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 6, 14), dark));
    hole.position.set(x, -0.02, 0.532);
  }
  const latch = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.03), steel), "Kaput kilidi");
  latch.position.set(0, 0.1, 0.53);
  const hook = add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), steel));
  hook.position.set(0, 0.13, 0.54);
  const cable = add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.28, 6), rubber), "Kilit teli");
  cable.rotation.z = Math.PI / 2;
  cable.position.set(0.16, 0.1, 0.52);
  const horn = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12), steel), "Korna");
  horn.rotation.z = Math.PI / 2;
  horn.position.set(-0.28, -0.02, 0.5);
  const guide = add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.04), plastic), "Hava yönlendirici");
  guide.position.set(0, -0.14, 0.5);
  guide.rotation.x = -0.4;
}

function buildSubframe(add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh, steel: THREE.Material): void {
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.7, metalness: 0.45 });
  const pan = add(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.012, 0.7), dark), "Motor altlığı");
  pan.position.set(0.02, -0.28, 0.04);
  for (const x of [-0.28, 0.3]) {
    const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.78), steel));
    rail.position.set(x, -0.25, 0.04);
  }
  for (const z of [-0.24, 0.32]) {
    const cross = add(new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.04, 0.05), steel), "Travers");
    cross.position.set(0.02, -0.24, z);
  }
}

function buildRadiator(
  add: (mesh: THREE.Mesh, part?: string) => THREE.Mesh,
  plastic: THREE.Material,
  rubber: THREE.Material,
  steel: THREE.Material,
): void {
  const finMat = new THREE.MeshStandardMaterial({
    color: 0x5e656a,
    roughness: 0.38,
    metalness: 0.82,
    normalMap: finNormal(),
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  const core = add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.32, 0.022), finMat), "Radyatör");
  core.position.set(0, 0.02, 0.44);
  for (const side of [-1, 1]) {
    const tank = add(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 14), plastic));
    tank.position.set(side * 0.3, 0.02, 0.44);
    const bulge = add(new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8), plastic));
    bulge.scale.y = 1.6;
    bulge.position.set(side * 0.3, 0.02, 0.44);
  }
  const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.04, 8), plastic));
  neck.position.set(0.3, 0.2, 0.44);
  const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8), steel));
  cap.position.set(0.3, 0.226, 0.44);
  const shroud = add(new THREE.Mesh(new THREE.RingGeometry(0.15, 0.185, 28), plastic), "Fan muhafazası");
  shroud.position.set(0, 0.02, 0.4);
  const fan = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 20), plastic), "Fan");
  fan.rotation.x = Math.PI / 2;
  fan.position.set(0, 0.02, 0.388);
  for (let b = 0; b < 6; b++) {
    const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.004), plastic));
    const a = (b / 6) * Math.PI * 2;
    blade.position.set(Math.cos(a) * 0.06, 0.02 + Math.sin(a) * 0.06, 0.388);
    blade.rotation.z = a;
  }
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

function finNormal(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    const img = g.createImageData(4, 64);
    for (let y = 0; y < 64; y++) {
      const ny = Math.sin((y % 4) / 4 * Math.PI) * 0.55;
      const nz = Math.sqrt(Math.max(0.05, 1 - ny * ny));
      const r = 128;
      const gg = Math.round((ny * 0.5 + 0.5) * 255);
      const b = Math.round((nz * 0.5 + 0.5) * 255);
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 28);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function placeRealParts(root: THREE.Object3D, kit: BayKit): void {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.55, metalness: 0.35 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0 });

  const box = prep(kit.transaxle);
  box.scale.setScalar(1);
  box.rotation.y = Math.PI;
  box.position.set(0.54, -0.16, 0.04);
  box.userData.part = "Şanzıman";
  root.add(box);

  const coolant = prep(kit.coolant);
  coolant.position.set(0.2, 0.1, 0.46);
  coolant.rotation.y = -0.5;
  coolant.userData.part = "Genleşme kabı";
  root.add(coolant);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 8), rubber);
  feed.rotation.z = 1.1;
  feed.position.set(0.16, 0.14, 0.4);
  feed.userData.part = "Üst hortum";
  feed.castShadow = true;
  root.add(feed);

  const washer = prep(kit.washer);
  shortenWasherNeck(washer);
  washer.position.set(-0.18, 0.0, 0.48);
  washer.rotation.y = -0.3;
  washer.userData.part = "Cam suyu";
  root.add(washer);

  const master = prep(kit.master);
  master.rotation.y = -Math.PI / 2;
  master.position.set(-0.3, 0.1, -0.16);
  master.userData.part = "Fren ana merkezi";
  root.add(master);
  const booster = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.07, 24), steel);
  booster.rotation.x = Math.PI / 2;
  booster.position.set(-0.3, 0.14, -0.28);
  booster.userData.part = "Fren servosu";
  booster.castShadow = true;
  root.add(booster);
  for (const x of [-0.33, -0.27]) {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.18, 6), steel);
    line.position.set(x, 0.0, -0.2);
    line.userData.part = "Fren hattı";
    root.add(line);
  }

  const boot = prep(kit.boot);
  boot.rotation.y = Math.PI / 2;
  boot.position.set(-0.26, 0.1, 0.02);
  boot.userData.part = "Emme hortumu";
  root.add(boot);

  const fuse = prep(kit.fuse);
  fuse.position.set(0.32, 0.02, 0.02);
  fuse.rotation.y = -0.4;
  fuse.userData.part = "Sigorta kutusu";
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.37, 0.012, 0.17),
    new THREE.MeshStandardMaterial({ color: 0x121416, roughness: 0.55, metalness: 0.08 }),
  );
  lid.position.y = 0.08;
  lid.name = "fuse-lid";
  lid.userData.part = "Sigorta kapağı";
  lid.castShadow = true;
  fuse.add(lid);
  root.add(fuse);
}

function prep(source: THREE.Object3D): THREE.Object3D {
  const obj = source.clone(true);
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return obj;
}

/** The washer's filler is a 0.37 m pipe along +X. Keep a short neck and the cap on the tank. */
function shortenWasherNeck(root: THREE.Object3D): void {
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || mesh.name !== "reservoir") return;
    const src = mesh.geometry.getAttribute("position");
    const v = new THREE.Vector3();
    const inv = mesh.matrixWorld.clone().invert();
    const arr = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
      if (v.x > 0.06) v.x = 0.06;
      v.applyMatrix4(inv);
      arr[i * 3] = v.x;
      arr[i * 3 + 1] = v.y;
      arr[i * 3 + 2] = v.z;
    }
    const geo = mesh.geometry.clone();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    mesh.geometry = geo;
  });
}

function dustMap(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#b8b8b8";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 220; i++) {
      const v = 40 + Math.random() * 180;
      g.fillStyle = `rgba(${v},${v},${v},0.45)`;
      g.beginPath();
      g.arc(Math.random() * 128, Math.random() * 128, 0.6 + Math.random() * 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function grimePlastic(): THREE.MeshStandardMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#1a1a1a";
    g.fillRect(0, 0, 128, 128);
    const dirt = g.createLinearGradient(0, 0, 0, 128);
    dirt.addColorStop(0, "rgba(0,0,0,0)");
    dirt.addColorStop(0.45, "rgba(40,32,22,0.05)");
    dirt.addColorStop(1, "rgba(70,54,32,0.72)");
    g.fillStyle = dirt;
    g.fillRect(0, 0, 128, 128);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.02,
    roughnessMap: dustMap(),
    envMapIntensity: 0.35,
  });
  void new THREE.TextureLoader()
    .loadAsync(`${import.meta.env.BASE_URL}textures/bay/SurfaceImperfections008/color.webp`)
    .then((tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
      tex.colorSpace = THREE.NoColorSpace;
      mat.roughnessMap = tex;
      mat.needsUpdate = true;
    })
    .catch(() => undefined);
  return mat;
}

function wornBolt(): THREE.MeshStandardMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#8e8e8e";
    g.fillRect(0, 0, 32, 64);
    g.fillStyle = "#2e2e2e";
    g.fillRect(0, 0, 32, 7);
    g.fillRect(0, 57, 32, 7);
  }
  const rough = new THREE.CanvasTexture(canvas);
  rough.colorSpace = THREE.NoColorSpace;
  return new THREE.MeshStandardMaterial({
    color: 0xc8b89a,
    roughness: 0.5,
    metalness: 0.84,
    roughnessMap: rough,
    envMapIntensity: 0.7,
  });
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
    dirt.addColorStop(1, "rgba(48,36,22,0.62)");
    g.fillStyle = dirt;
    g.fillRect(0, 0, 128, 128);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.32,
    envMapIntensity: 0.85,
  });
}

function placeBattery(root: THREE.Object3D, template: THREE.Object3D): void {
  const bat = template.clone(true);
  bat.position.set(0.34, -0.02, 0.2);
  bat.rotation.y = -0.7;
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
  const load = (file: string) => loader.loadAsync(`${base}models/bay/${file}`);
  const [battery, alternator, transaxle, coolant, washer, master, boot, fuse] = await Promise.all([
    load("car_battery_cc-by.glb"),
    load("alternator_toyota_cc-by-sa.glb"),
    load("transaxle_quaife_qtek5.glb"),
    load("coolant_expansion_tank.glb"),
    load("washer_fluid_reservoir.glb"),
    load("brake_master_cylinder.glb"),
    load("intake_boot_vw.glb"),
    load("fuse_relay_panel.glb"),
  ]);
  return {
    battery: battery.scene,
    alternator: alternator.scene,
    transaxle: transaxle.scene,
    coolant: coolant.scene,
    washer: washer.scene,
    master: master.scene,
    boot: boot.scene,
    fuse: fuse.scene,
  };
}
