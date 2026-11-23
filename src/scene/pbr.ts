import * as THREE from "three";

export type PbrRole = "iron" | "ironDark" | "alu" | "steel" | "paint" | "rubber" | "concrete";

export interface MapSet {
  color: THREE.Texture;
  normal?: THREE.Texture;
  rough?: THREE.Texture;
  metal?: THREE.Texture;
  ao?: THREE.Texture;
}

export type PbrLibrary = Record<PbrRole, MapSet>;

const BASE = () => import.meta.env.BASE_URL;

function prep(tex: THREE.Texture, color: boolean): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

async function loadSet(folder: string, maps: string[]): Promise<MapSet> {
  const loader = new THREE.TextureLoader();
  const out: Partial<MapSet> = {};
  await Promise.all(
    maps.map(async (name) => {
      const tex = await loader.loadAsync(`${BASE()}textures/pbr/${folder}/${name}.jpg`);
      const key = name as keyof MapSet;
      out[key] = prep(tex, name === "color");
    }),
  );
  return out as MapSet;
}

let pending: Promise<PbrLibrary> | null = null;

export function loadPbr(): Promise<PbrLibrary> {
  if (!pending) {
    pending = (async () => {
      const [iron, ironDark, alu, steel, paint, rubber, concrete] = await Promise.all([
        loadSet("Metal055A", ["color", "normal", "rough", "metal"]),
        loadSet("Metal046B", ["color", "normal", "rough", "metal"]),
        loadSet("Metal051A", ["color", "normal", "rough", "metal"]),
        loadSet("Metal009", ["color", "normal", "rough", "metal"]),
        loadSet("PaintedMetal004", ["color", "normal", "rough", "metal"]),
        loadSet("Rubber004", ["color", "normal", "rough"]),
        loadSet("worn_concrete_floor", ["color", "normal", "rough", "ao"]),
      ]);
      return { iron, ironDark, alu, steel, paint, rubber, concrete };
    })();
  }
  return pending;
}

/** Kutu izdüşümü. Motor milimetre cinsinden modellendiği için bir karo ~16 cm. */
export function boxProject(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  if (!pos || !nor || pos.count === 0) return;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u / 160;
    uv[i * 2 + 1] = v / 160;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function paintMaterial(mat: THREE.MeshStandardMaterial, set: MapSet, role: PbrRole): void {
  mat.map = set.color;
  mat.normalMap = set.normal ?? null;
  mat.roughnessMap = set.rough ?? null;
  mat.metalnessMap = set.metal ?? null;
  mat.aoMap = set.ao ?? null;
  mat.color.set(0xffffff);
  if (role === "paint") mat.color.set(0xd24a45);
  mat.roughness = 1;
  mat.metalness = set.metal ? 1 : role === "rubber" || role === "paint" || role === "concrete" ? 0.04 : 0.85;
  const scale = role === "iron" || role === "ironDark" ? 1.35 : role === "alu" ? 0.55 : role === "rubber" ? 0.8 : 0.9;
  mat.normalScale?.set(scale, scale);
  mat.envMapIntensity = role === "alu" || role === "steel" ? 1.15 : role === "iron" ? 0.55 : 0.7;
  mat.needsUpdate = true;
}
