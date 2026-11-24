import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { loadPbr } from "./pbr";

export interface K24Scan {
  object: THREE.Object3D;
  mesh: THREE.Mesh;
  height: number;
  length: number;
}

/** Honda K24Z3 taraması. Üç düzlemli doku, yükseklikle renk, sahte kir. */
export async function loadK24Scan(phone: boolean): Promise<K24Scan> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const file = phone ? "honda_k24z3_scan_120k_clean.glb" : "honda_k24z3_scan_280k_clean.glb";
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/engines/${file}`);
  const lib = await loadPbr();
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && !mesh) mesh = m;
  });
  if (!mesh) throw new Error("K24 tarama boş");
  const scan = mesh as THREE.Mesh;
  let geo = scan.geometry;
  // COLOR_0 is baked AO. Welding would average it and can drop the interleaved layout.
  if (!geo.getAttribute("color")) {
    try {
      geo = mergeVertices(geo, 1e-4);
    } catch {
      /* indeksli haliyle devam */
    }
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    bakeCavity(geo);
  }
  if (!geo.getAttribute("color")) {
    const pos = geo.getAttribute("position");
    const ao = new Float32Array(pos.count * 3);
    ao.fill(0.86);
    geo.setAttribute("color", new THREE.BufferAttribute(ao, 3));
  }
  scan.geometry = geo;
  const rawBox = new THREE.Box3().setFromObject(gltf.scene);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  scan.material = k24Material(lib.iron.color, lib.iron.rough, lib.alu.color, rawSize.y);
  scan.castShadow = true;
  scan.receiveShadow = true;
  scan.name = "k24";
  dressWeakSpots(scan);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const long = Math.max(size.x, size.z);
  const scale = 0.74 / Math.max(0.2, long);
  gltf.scene.scale.setScalar(scale);
  if (size.z > size.x) gltf.scene.rotation.y = Math.PI / 2;
  gltf.scene.updateWorldMatrix(true, true);
  const fitted = new THREE.Box3().setFromObject(gltf.scene);
  const fittedSize = fitted.getSize(new THREE.Vector3());
  return { object: gltf.scene, mesh: scan, height: fittedSize.y, length: Math.max(fittedSize.x, fittedSize.z) };
}

/** Cover the scan's filled holes: pulley cup, flywheel face, exhaust cap, intake lump. Positions are in mesh-local units. */
function dressWeakSpots(mesh: THREE.Mesh): void {
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a342e, roughness: 0.62, metalness: 0.55 });
  const alu = new THREE.MeshStandardMaterial({ color: 0x6a7278, roughness: 0.46, metalness: 0.72 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.38, metalness: 0.8 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    mesh.add(m);
    return m;
  };

  // Crank pulley faces -Z. Hub covers the dark crescent; the serpentine belt is the drive below.
  const hub = add(new THREE.CylinderGeometry(0.16, 0.18, 0.035, 24), steel);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(-0.1, -0.58, -0.7);
  const bolt = add(new THREE.CylinderGeometry(0.04, 0.04, 0.022, 6), iron);
  bolt.rotation.x = Math.PI / 2;
  bolt.position.set(-0.1, -0.58, -0.725);
  buildAccessoryDrive(add, rubber, steel, alu);

  // Exhaust side is -X, which faces the radiator. Keep the pipes against the head
  // and show a shield, so the filled face is covered without pipes floating on the core.
  for (let i = 0; i < 4; i++) {
    const runner = add(new THREE.CylinderGeometry(0.04, 0.045, 0.16, 8), iron);
    runner.rotation.z = Math.PI / 2;
    runner.position.set(-0.78, 0.18, -0.24 + i * 0.18);
  }
  const collector = add(new THREE.CylinderGeometry(0.055, 0.055, 0.7, 12), iron);
  collector.rotation.x = Math.PI / 2;
  collector.position.set(-0.86, 0.08, 0.02);

  // The invented lump is outboard of the intake on +X. The hose stays beside the cover.
  const hose = add(new THREE.CylinderGeometry(0.09, 0.1, 0.42, 14), rubber);
  hose.rotation.x = Math.PI / 2;
  hose.position.set(0.84, 0.55, 0.12);
  const neck = add(new THREE.CylinderGeometry(0.055, 0.06, 0.2, 10), rubber);
  neck.rotation.z = Math.PI / 2;
  neck.position.set(0.68, 0.52, 0.22);
}

type DriveAdd = (geo: THREE.BufferGeometry, mat: THREE.Material) => THREE.Mesh;

/** Poly-V belt on the accessory face. Path radius matches each pulley so the ribs sit in the grooves. */
function buildAccessoryDrive(add: DriveAdd, rubber: THREE.Material, steel: THREE.Material, alu: THREE.Material): void {
  const z = -0.665;
  const pulleys = [
    { name: "crank", x: -0.1, y: -0.58, r: 0.26 },
    { name: "ac", x: 0.24, y: -0.4, r: 0.12 },
    { name: "alt", x: 0.04, y: -0.1, r: 0.095 },
    { name: "idler", x: -0.24, y: -0.26, r: 0.055 },
    { name: "ten", x: -0.3, y: -0.46, r: 0.065 },
  ];
  const points = beltPoints(pulleys);
  const ribs = 6;
  const spacing = 0.0075;
  for (let i = 0; i < ribs; i++) {
    const zOff = (i - (ribs - 1) / 2) * spacing;
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p.x, p.y, z + zOff)),
      true,
      "catmullrom",
      0.05,
    );
    const tube = add(new THREE.TubeGeometry(curve, points.length, 0.0026, 5, true), rubber);
    tube.name = "serpentine";
  }
  for (const p of pulleys) {
    const hubR = Math.max(0.02, p.r - 0.02);
    const hub = add(new THREE.CylinderGeometry(hubR, hubR, ribs * spacing + 0.01, p.name === "crank" ? 28 : 18), p.name === "crank" ? steel : alu);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(p.x, p.y, z);
    for (let i = 0; i < ribs; i++) {
      const zOff = (i - (ribs - 1) / 2) * spacing;
      const groove = add(new THREE.TorusGeometry(p.r + 0.004, 0.0022, 5, p.name === "crank" ? 36 : 22), steel);
      groove.position.set(p.x, p.y, z + zOff);
    }
  }
  const ac = add(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 16), alu);
  ac.rotation.x = Math.PI / 2;
  ac.position.set(0.24, -0.4, -0.5);
  ac.userData.part = "Klima kompresörü";
  const clutch = add(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), steel);
  clutch.rotation.x = Math.PI / 2;
  clutch.position.set(0.24, -0.4, -0.58);
  const pivot = { x: -0.18, y: -0.4 };
  const arm = add(new THREE.BoxGeometry(0.16, 0.02, 0.018), steel);
  arm.position.set((pivot.x - 0.3) / 2, (pivot.y - 0.46) / 2, z + 0.02);
  arm.rotation.z = Math.atan2(-0.46 - pivot.y, -0.3 - pivot.x);
  const spring = add(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), steel);
  spring.position.set(-0.16, -0.34, z + 0.015);
  spring.rotation.z = 0.5;
}

function beltPoints(pulleys: { x: number; y: number; r: number }[]): { x: number; y: number }[] {
  const cx = pulleys.reduce((s, p) => s + p.x, 0) / pulleys.length;
  const cy = pulleys.reduce((s, p) => s + p.y, 0) / pulleys.length;
  const ordered = [...pulleys].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const n = ordered.length;
  const tangent = (a: (typeof ordered)[0], b: (typeof ordered)[0]) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);
    const beta = Math.acos(Math.max(-1, Math.min(1, (a.r - b.r) / dist)));
    let best: { p1: { x: number; y: number }; p2: { x: number; y: number }; dist: number } | null = null;
    for (const sign of [1, -1]) {
      const ang = theta + sign * beta;
      const p1 = { x: a.x + a.r * Math.cos(ang), y: a.y + a.r * Math.sin(ang) };
      const p2 = { x: b.x + b.r * Math.cos(ang), y: b.y + b.r * Math.sin(ang) };
      const out = Math.hypot((p1.x + p2.x) / 2 - cx, (p1.y + p2.y) / 2 - cy);
      if (!best || out > best.dist) best = { p1, p2, dist: out };
    }
    return best!;
  };
  const legs = ordered.map((p, i) => tangent(p, ordered[(i + 1) % n]));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const c = ordered[i];
    const incoming = legs[(i - 1 + n) % n];
    const outgoing = legs[i];
    const a0 = Math.atan2(incoming.p2.y - c.y, incoming.p2.x - c.x);
    const a1 = Math.atan2(outgoing.p1.y - c.y, outgoing.p1.x - c.x);
    let sweep = a1 - a0;
    while (sweep < 0) sweep += Math.PI * 2;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    const midDist = (sw: number) => {
      const a = a0 + sw / 2;
      return Math.hypot(c.x + c.r * Math.cos(a) - cx, c.y + c.r * Math.sin(a) - cy);
    };
    const other = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
    const use = midDist(sweep) >= midDist(other) ? sweep : other;
    const steps = Math.max(3, Math.ceil(Math.abs(use) / 0.28));
    for (let s = 0; s <= steps; s++) {
      const a = a0 + use * (s / steps);
      pts.push({ x: c.x + c.r * Math.cos(a), y: c.y + c.r * Math.sin(a) });
    }
    const next = incoming && outgoing;
    if (next) {
      const a = outgoing.p1;
      const b = outgoing.p2;
      pts.push({ x: a.x * 0.35 + b.x * 0.65, y: a.y * 0.35 + b.y * 0.65 });
    }
  }
  return pts;
}

function bakeCavity(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  if (!pos || !nor || pos.count > 220000) return;
  const ao = new Float32Array(pos.count * 3);
  const cell = 0.02;
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    let occ = 0;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const j of list) {
            if (j === i) continue;
            const ox = pos.getX(j) - x;
            const oy = pos.getY(j) - y;
            const oz = pos.getZ(j) - z;
            const len = Math.hypot(ox, oy, oz);
            if (len < 1e-5 || len > cell * 1.6) continue;
            const facing = (ox * nx + oy * ny + oz * nz) / len;
            if (facing > 0.2) occ += facing * (1 - len / (cell * 1.6));
          }
        }
      }
    }
    const v = Math.max(0.42, 1 - Math.min(0.62, occ * 0.15));
    ao[i * 3] = ao[i * 3 + 1] = ao[i * 3 + 2] = v;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(ao, 3));
}

function k24Material(
  colorMap: THREE.Texture,
  roughMap: THREE.Texture | undefined,
  aluMap: THREE.Texture,
  heightM: number,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb7b7b7,
    metalness: 0.42,
    vertexColors: true,
    envMapIntensity: 0.7,
    roughness: 0.78,
  });
  mat.customProgramCacheKey = () => "k24-triplanar";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tIron = { value: colorMap };
    shader.uniforms.tAlu = { value: aluMap };
    shader.uniforms.tIronR = { value: roughMap ?? colorMap };
    shader.uniforms.triScale = { value: 2.4 };
    shader.uniforms.uHeight = { value: Math.max(0.25, heightM) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vLPos;\nvarying vec3 vLNor;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLPos = transformed;\nvLNor = normalize(normal);\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vLPos;
        varying vec3 vLNor;
        uniform sampler2D tIron;
        uniform sampler2D tAlu;
        uniform sampler2D tIronR;
        uniform float triScale;
        uniform float uHeight;
        vec3 tri(sampler2D tex, vec3 p, vec3 n, float s) {
          vec3 w = abs(n);
          w = max(w, 0.0001);
          w /= w.x + w.y + w.z;
          return texture2D(tex, p.zy * s).rgb * w.x
            + texture2D(tex, p.xz * s).rgb * w.y
            + texture2D(tex, p.xy * s).rgb * w.z;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 n = normalize(vLNor);
          vec3 iron = tri(tIron, vWPos, n, triScale);
          vec3 alu = tri(tAlu, vWPos, n, triScale * 1.6);
          float h = clamp(vLPos.y / uHeight, 0.0, 1.0);
          vec3 tint = vec3(0.28, 0.27, 0.25);
          tint = mix(tint, vec3(0.48, 0.49, 0.50), smoothstep(0.42, 0.62, h));
          tint = mix(tint, vec3(0.10, 0.10, 0.11), smoothstep(0.72, 0.86, h));
          float pulley = smoothstep(0.55, 0.92, abs(n.x)) * (1.0 - smoothstep(0.7, 0.9, h));
          float belt = smoothstep(0.72, 0.95, abs(n.x)) * smoothstep(0.15, 0.35, h) * (1.0 - smoothstep(0.55, 0.7, h));
          tint = mix(tint, vec3(0.16, 0.16, 0.17), pulley);
          tint = mix(tint, vec3(0.03, 0.03, 0.03), belt);
          vec3 tex = mix(iron, alu, smoothstep(0.5, 0.75, h) * 0.55);
          float stain = sin(vLPos.x * 37.0) * sin(vLPos.z * 23.0 + vLPos.y * 11.0);
          float oil = smoothstep(0.1, 0.65, stain) * (1.0 - smoothstep(0.02, 0.46, h));
          tint = mix(tint, tint * vec3(0.28, 0.24, 0.16), oil * 0.92);
          float ao = clamp(vColor.r, 0.0, 1.0);
          // color_fragment already multiplied vColor. Swap that for a 70% blend so crevices stay open.
          diffuseColor.rgb *= mix(1.0, ao, 0.7) / max(ao, 0.02);
          float cavity = mix(0.88, 1.0, smoothstep(-0.2, 0.45, n.y));
          diffuseColor.rgb *= tex * tint * cavity;
        }`,
      );
  };
  return mat;
}
