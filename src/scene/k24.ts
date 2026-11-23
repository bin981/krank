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
  const file = phone ? "honda_k24z3_scan_120k.glb" : "honda_k24z3_scan_280k.glb";
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
  try {
    geo = mergeVertices(geo, 1e-4);
  } catch {
    /* indeksli haliyle devam */
  }
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  bakeCavity(geo);
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
    color: 0xffffff,
    metalness: 0.55,
    vertexColors: true,
    envMapIntensity: 1.25,
    roughness: 0.55,
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
          vec3 alu = tri(tAlu, vWPos, n, triScale * 1.4);
          float roughTex = tri(tIronR, vWPos, n, triScale).r;
          float h = clamp(vLPos.y / uHeight, 0.0, 1.0);
          vec3 metal = mix(vec3(0.72), iron, 0.45);
          metal = mix(metal, alu, smoothstep(0.55, 0.9, abs(n.y)) * 0.25);
          vec3 tint = mix(vec3(0.62, 0.60, 0.56), vec3(0.92, 0.90, 0.86), smoothstep(0.15, 0.5, h));
          tint = mix(tint, vec3(0.28, 0.28, 0.30), smoothstep(0.7, 0.88, h));
          float pulley = smoothstep(0.5, 0.9, abs(n.x)) * (1.0 - smoothstep(0.68, 0.9, h));
          tint = mix(tint, vec3(0.55, 0.56, 0.58), pulley);
          float ao = clamp(vColor.r, 0.55, 1.0);
          float grime = mix(0.9, 1.0, smoothstep(0.0, 0.3, h));
          diffuseColor.rgb *= metal * tint * ao * grime * mix(0.92, 1.08, roughTex);
        }`,
      );
  };
  return mat;
}
