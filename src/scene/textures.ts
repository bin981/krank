import * as THREE from "three";

let ironCache: { color: THREE.CanvasTexture; rough: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null;

/** Döküm dokusu. Lisans: proje içi, üçüncü taraf doku değil. */
export function ironMaps(): { color: THREE.CanvasTexture; rough: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (ironCache) return ironCache;
  const size = 256;
  const colorC = document.createElement("canvas");
  const roughC = document.createElement("canvas");
  const bumpC = document.createElement("canvas");
  colorC.width = roughC.width = bumpC.width = size;
  colorC.height = roughC.height = bumpC.height = size;
  const cg = colorC.getContext("2d");
  const rg = roughC.getContext("2d");
  const bg = bumpC.getContext("2d");
  if (cg && rg && bg) {
    const img = cg.createImageData(size, size);
    const rimg = rg.createImageData(size, size);
    const bimg = bg.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const grain = Math.random();
        const pit = grain > 0.92 ? 0.35 : grain > 0.84 ? 0.7 : 1;
        const v = Math.floor((0.28 + grain * 0.35) * pit * 170);
        img.data[i] = v;
        img.data[i + 1] = v + 2;
        img.data[i + 2] = v + 6;
        img.data[i + 3] = 255;
        const rough = Math.floor(150 + (1 - pit) * 90 + grain * 20);
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rough;
        rimg.data[i + 3] = 255;
        const bump = Math.floor(128 * pit + grain * 18);
        bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = bump;
        bimg.data[i + 3] = 255;
      }
    }
    cg.putImageData(img, 0, 0);
    rg.putImageData(rimg, 0, 0);
    bg.putImageData(bimg, 0, 0);
  }
  const color = new THREE.CanvasTexture(colorC);
  const rough = new THREE.CanvasTexture(roughC);
  const bump = new THREE.CanvasTexture(bumpC);
  for (const tex of [color, rough, bump]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
  }
  color.colorSpace = THREE.SRGBColorSpace;
  ironCache = { color, rough, bump };
  return ironCache;
}
