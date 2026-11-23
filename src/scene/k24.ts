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
  const scale = 0.62 / Math.max(0.2, long);
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

  // Crank pulley faces -Z. Hub and belt cover the dark crescent in the pulley cup.
  const hub = add(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 24), steel);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(-0.1, -0.58, -0.7);
  const bolt = add(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 6), iron);
  bolt.rotation.x = Math.PI / 2;
  bolt.position.set(-0.1, -0.58, -0.73);
  const belt = add(new THREE.TorusGeometry(0.28, 0.018, 8, 32), rubber);
  belt.position.set(-0.1, -0.58, -0.66);

  // Flywheel end is the filled +Z face. A bell and a short case sit on it, not a crate.
  const bell = add(new THREE.CylinderGeometry(0.5, 0.38, 0.18, 28), alu);
  bell.rotation.x = Math.PI / 2;
  bell.position.set(0.02, -0.12, 0.94);
  const casing = add(new THREE.CylinderGeometry(0.38, 0.42, 0.32, 24), alu);
  casing.rotation.x = Math.PI / 2;
  casing.position.set(0.02, -0.16, 1.16);
  const sump = add(new THREE.BoxGeometry(0.5, 0.14, 0.28), iron);
  sump.position.set(0.02, -0.5, 1.14);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const stud = add(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 6), steel);
    stud.rotation.x = Math.PI / 2;
    stud.position.set(0.02 + Math.cos(a) * 0.4, -0.12 + Math.sin(a) * 0.4, 0.86);
  }

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
    envMapIntensity: 0.42,
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
          float oil = smoothstep(0.35, 0.8, stain) * smoothstep(0.18, 0.4, h) * (1.0 - smoothstep(0.7, 0.88, h));
          tint = mix(tint, tint * vec3(0.42, 0.38, 0.28), oil * 0.7);
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
