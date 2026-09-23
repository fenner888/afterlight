import * as THREE from 'three';
import type { SceneContext } from './common.ts';

export interface TextureSet { map: THREE.CanvasTexture; normalMap?: THREE.CanvasTexture; roughnessMap?: THREE.CanvasTexture }

const lcg = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
};

// Periodic (tileable) value noise with smoothstep interpolation, fBm over octaves.
// Lattice size L doubles per octave; wrap indices mod L so the texture tiles with no mirroring.
const hash2 = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number): number => t * t * (3 - 2 * t);
export const fbm = (size: number, seed: number, { octaves = 5, base = 6, gain = .5, lacunarity = 2 } = {}): Float32Array => {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, L = base;
  for (let o = 0; o < octaves; o++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * L, fy = (y / size) * L;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
      const x1 = (x0 + 1) % L, y1 = (y0 + 1) % L;
      const a = hash2(x0 % L, y0 % L, seed + o), b = hash2(x1, y0 % L, seed + o), c = hash2(x0 % L, y1, seed + o), d = hash2(x1, y1, seed + o);
      out[y * size + x]! += amp * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
    }
    total += amp; amp *= gain; L = Math.round(L * lacunarity);
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  return out; // 0..1, mean ~0.5, tiles seamlessly
};

const make = (ctx: SceneContext, canvas: HTMLCanvasElement, repeat = true): THREE.CanvasTexture => {
  const texture = new THREE.CanvasTexture(canvas);
  if (repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; }
  texture.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
  texture.colorSpace = THREE.SRGBColorSpace;
  ctx.track(texture);
  return texture;
};

const canvas = (size: number): { el: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
  const el = document.createElement('canvas');
  el.width = el.height = size;
  return { el, g: el.getContext('2d')! };
};

// Low-contrast albedo: base colour x (1 + (n - 0.5) * k).
const albedoCanvas = (size: number, noise: Float32Array, base: [number, number, number], k: number): { el: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
  const { el, g } = canvas(size);
  const out = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const m = 1 + (noise[i]! - .5) * k;
    out.data[i * 4] = Math.min(255, base[0] * m);
    out.data[i * 4 + 1] = Math.min(255, base[1] * m);
    out.data[i * 4 + 2] = Math.min(255, base[2] * m);
    out.data[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return { el, g };
};

// Grayscale canvas from a height field (for overlays that need a canvas).
const grayCanvas = (size: number, data: Float32Array): HTMLCanvasElement => {
  const { el, g } = canvas(size);
  const out = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(data[i]! * 255);
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return el;
};

// Composite an overlay canvas at all 9 wrapped offsets so details stay seamless.
const wrapOverlay = (g: CanvasRenderingContext2D, overlay: HTMLCanvasElement, size: number): void => {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) g.drawImage(overlay, dx, dy);
};

// Sobel height -> tangent-space normal map, wrapping edges so it tiles.
const normalFromHeight = (ctx: SceneContext, height: Float32Array, size: number, strength = .8): THREE.CanvasTexture => {
  const { el, g } = canvas(size);
  const out = g.createImageData(size, size);
  const h = (x: number, y: number): number => height[(((y + size) % size) * size + ((x + size) % size))]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
    const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    out.data[i] = (-dx * inv * .5 + .5) * 255;
    out.data[i + 1] = (-dy * inv * .5 + .5) * 255;
    out.data[i + 2] = inv * 255;
    out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  ctx.track(texture);
  return texture;
};

// Roughness map: base +/- span/2 around the mean — deliberately low contrast.
const roughnessFromFbm = (ctx: SceneContext, size: number, seed: number, base: number, span: number): THREE.CanvasTexture => {
  const noise = fbm(size, seed, { octaves: 4, base: 6 });
  const { el, g } = canvas(size);
  const out = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round((base + (noise[i]! - .5) * span) * 255);
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  ctx.track(texture);
  return texture;
};

export function asphalt(ctx: SceneContext): TextureSet {
  // Baked albedo ~0x2b2e31, k .14, so the road material can stay near-white.
  const { el, g } = albedoCanvas(512, fbm(512, 11, { octaves: 5, base: 6 }), [43, 46, 49], .14);
  const { el: cracks, g: cg } = canvas(512);
  const rand = lcg(23);
  cg.strokeStyle = 'rgba(14,18,20,.5)';
  cg.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) {
    cg.beginPath();
    let x = rand() * 512, y = rand() * 512;
    cg.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (rand() - .5) * 140; y += (rand() - .5) * 140; cg.lineTo(x, y); }
    cg.stroke();
  }
  wrapOverlay(g, cracks, 512);
  return { map: make(ctx, el), roughnessMap: roughnessFromFbm(ctx, 256, 29, .82, .24) };
}

export function concrete(ctx: SceneContext): TextureSet {
  // Baked albedo ~0x6b6f6e, k .18; the material colour handles rain darkening.
  const { el, g } = albedoCanvas(512, fbm(512, 41, { octaves: 5, base: 6 }), [107, 111, 110], .18);
  const { el: stains, g: sg } = canvas(512);
  const rand = lcg(53);
  for (let i = 0; i < 7; i++) {
    const x = rand() * 512, y = rand() * 512, r = 40 + rand() * 110;
    const grad = sg.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(52,62,60,.18)');
    grad.addColorStop(1, 'rgba(52,62,60,0)');
    sg.fillStyle = grad;
    sg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  wrapOverlay(g, stains, 512);
  return {
    map: make(ctx, el),
    normalMap: normalFromHeight(ctx, fbm(256, 47, { octaves: 6, base: 7 }), 256, .7),
    roughnessMap: roughnessFromFbm(ctx, 256, 59, .55, .24),
  };
}

export function brick(ctx: SceneContext, palette: 'red' | 'brown'): TextureSet {
  const base: [number, number, number] = palette === 'red' ? [122, 78, 66] : [96, 82, 72];
  const { el, g } = canvas(512);
  const { g: hg } = canvas(256);
  g.fillStyle = '#3c3a36';
  g.fillRect(0, 0, 512, 512);
  hg.fillStyle = '#404040';
  hg.fillRect(0, 0, 256, 256);
  const rand = lcg(palette === 'red' ? 71 : 97);
  // Small courses: ~1.2 world units per tile, so bricks read as courses only close-up.
  const bw = 32, bh = 12, mortar = 2;
  for (let row = 0; row * bh < 512 + bh; row++) {
    const offset = row % 2 ? bw / 2 : 0;
    for (let col = -1; col * bw < 512 + bw; col++) {
      const x = col * bw + offset, y = row * bh;
      const v = (rand() - .5) * 30;
      g.fillStyle = `rgb(${base[0] + v | 0},${base[1] + v * .7 | 0},${base[2] + v * .6 | 0})`;
      g.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar);
      const hv = 140 + (rand() - .5) * 40;
      hg.fillStyle = `rgb(${hv | 0},${hv | 0},${hv | 0})`;
      hg.fillRect((x + mortar / 2) / 2, (y + mortar / 2) / 2, (bw - mortar) / 2, (bh - mortar) / 2);
    }
  }
  const height = new Float32Array(256 * 256);
  const hd = hg.getImageData(0, 0, 256, 256).data;
  for (let i = 0; i < 256 * 256; i++) height[i] = hd[i * 4]! / 255;
  // Mortar-variation wash: albedo x (1 + (n - .5) * .25).
  const wash = fbm(512, palette === 'red' ? 83 : 89, { octaves: 4, base: 8 });
  const src = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    const m = 1 + (wash[i]! - .5) * .25;
    src.data[i * 4] = Math.min(255, src.data[i * 4]! * m);
    src.data[i * 4 + 1] = Math.min(255, src.data[i * 4 + 1]! * m);
    src.data[i * 4 + 2] = Math.min(255, src.data[i * 4 + 2]! * m);
  }
  g.putImageData(src, 0, 0);
  return { map: make(ctx, el), normalMap: normalFromHeight(ctx, height, 256, .8), roughnessMap: roughnessFromFbm(ctx, 256, 89, .8, .18) };
}

export function corrugated(ctx: SceneContext): TextureSet {
  const { el, g } = canvas(512);
  const height = new Float32Array(256 * 256);
  for (let x = 0; x < 512; x++) {
    const s = Math.sin(x * Math.PI * 2 / 32);
    const v = 96 + s * 34;
    g.fillStyle = `rgb(${v * .55 | 0},${v * .68 | 0},${v * .72 | 0})`;
    g.fillRect(x, 0, 1, 512);
    const hv = .5 + s * .45;
    for (let py = 0; py < 256; py++) height[py * 256 + (x / 2 | 0)] = hv;
  }
  g.globalAlpha = .18;
  g.drawImage(grayCanvas(512, fbm(512, 101, { octaves: 4, base: 8 })), 0, 0);
  g.globalAlpha = 1;
  return { map: make(ctx, el), normalMap: normalFromHeight(ctx, height, 256, 2.2) };
}

export function gravel(ctx: SceneContext): TextureSet {
  const { el, g } = albedoCanvas(512, fbm(512, 113, { octaves: 5, base: 7 }), [77, 87, 92], .2);
  const { el: speck, g: sp } = canvas(512);
  const rand = lcg(127);
  for (let i = 0; i < 900; i++) {
    const v = 60 + rand() * 70;
    sp.fillStyle = `rgba(${v | 0},${v * 1.08 | 0},${v * 1.12 | 0},.7)`;
    sp.fillRect(rand() * 512, rand() * 512, 2 + rand() * 3, 2 + rand() * 3);
  }
  wrapOverlay(g, speck, 512);
  return { map: make(ctx, el), normalMap: normalFromHeight(ctx, fbm(256, 131, { octaves: 6, base: 8 }), 256, .8) };
}

// Coursed ashlar stone for the seawall face: regular block courses with mortar
// joints, damp variation near the base baked in via the fBm wash.
export function coursedStone(ctx: SceneContext): TextureSet {
  const { el, g } = canvas(512);
  const { g: hg } = canvas(256);
  g.fillStyle = '#565c58';
  g.fillRect(0, 0, 512, 512);
  hg.fillStyle = '#383838';
  hg.fillRect(0, 0, 256, 256);
  const rand = lcg(311);
  const bw = 86, bh = 42, mortar = 4;
  for (let row = 0; row * bh < 512 + bh; row++) {
    const offset = row % 2 ? bw / 2 : 0;
    for (let col = -1; col * bw < 512 + bw; col++) {
      const x = col * bw + offset, y = row * bh;
      const v = (rand() - .5) * 22;
      g.fillStyle = `rgb(${104 + v | 0},${108 + v | 0},${102 + v * .8 | 0})`;
      g.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar);
      const hv = 150 + (rand() - .5) * 36;
      hg.fillStyle = `rgb(${hv | 0},${hv | 0},${hv | 0})`;
      hg.fillRect((x + mortar / 2) / 2, (y + mortar / 2) / 2, (bw - mortar) / 2, (bh - mortar) / 2);
    }
  }
  const height = new Float32Array(256 * 256);
  const hd = hg.getImageData(0, 0, 256, 256).data;
  for (let i = 0; i < 256 * 256; i++) height[i] = hd[i * 4]! / 255;
  const wash = fbm(512, 317, { octaves: 4, base: 6 });
  const src = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    const m = 1 + (wash[i]! - .5) * .3;
    src.data[i * 4] = Math.min(255, src.data[i * 4]! * m);
    src.data[i * 4 + 1] = Math.min(255, src.data[i * 4 + 1]! * m);
    src.data[i * 4 + 2] = Math.min(255, src.data[i * 4 + 2]! * m);
  }
  g.putImageData(src, 0, 0);
  return {
    map: make(ctx, el),
    normalMap: normalFromHeight(ctx, height, 256, 1),
    roughnessMap: roughnessFromFbm(ctx, 256, 331, .78, .2),
  };
}

export function paintedMetal(ctx: SceneContext, tint: string): TextureSet {
  const c = new THREE.Color(tint);
  const { el } = albedoCanvas(256, fbm(256, 149, { octaves: 4, base: 7 }), [c.r * 255, c.g * 255, c.b * 255], .18);
  return { map: make(ctx, el) };
}

export function wood(ctx: SceneContext): TextureSet {
  const { el, g } = canvas(512);
  const rand = lcg(167);
  for (let y = 0; y < 512; y += 32) {
    const v = (rand() - .5) * 26;
    g.fillStyle = `rgb(${86 + v | 0},${70 + v * .8 | 0},${52 + v * .6 | 0})`;
    g.fillRect(0, y, 512, 30);
    g.fillStyle = 'rgba(20,16,10,.55)';
    g.fillRect(0, y + 30, 512, 2);
  }
  g.globalAlpha = .25;
  g.drawImage(grayCanvas(512, fbm(512, 173, { octaves: 4, base: 8 })), 0, 0);
  g.globalAlpha = 1;
  return { map: make(ctx, el), roughnessMap: roughnessFromFbm(ctx, 256, 179, .82, .18) };
}

// Puddle-dimpled roughness for wet ground: base .55, blobs down to .08 (dark = smooth).
export function puddleRoughness(ctx: SceneContext): THREE.CanvasTexture {
  const { el, g } = canvas(256);
  g.fillStyle = '#8c8c8c';
  g.fillRect(0, 0, 256, 256);
  for (const [x, y, r] of [[70, 120, 34], [160, 90, 26], [200, 190, 40], [50, 210, 22], [130, 170, 18]] as const) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(20,20,20,.95)');
    grad.addColorStop(1, 'rgba(20,20,20,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(el);
  ctx.track(texture);
  return texture;
}

// Tiling water normal map: two fbm layers (broad swells + ripples) -> normals.
export function waterNormals(ctx: SceneContext): THREE.CanvasTexture {
  const broad = fbm(256, 191, { octaves: 4, base: 4 });
  const ripple = fbm(256, 197, { octaves: 4, base: 9 });
  const height = new Float32Array(256 * 256);
  for (let i = 0; i < height.length; i++) height[i] = broad[i]! * .7 + ripple[i]! * .3;
  return normalFromHeight(ctx, height, 256, 1.2);
}

export function cloudAlpha(ctx: SceneContext): THREE.CanvasTexture {
  // Soft periodic fBm (5 octaves), then a soft threshold for a blurred edge.
  const noise = fbm(512, 211, { octaves: 5, base: 5 });
  const { el, g } = canvas(512);
  const out = g.createImageData(512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    const a = Math.max(0, Math.min(1, (noise[i]! - .42) * 1.7));
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = a * 255;
  }
  g.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  ctx.track(texture);
  return texture;
}

// Radial light pool for streetlamps: alpha 1 centre -> 0 edge (material opacity caps it).
export function poolGradient(ctx: SceneContext): THREE.CanvasTexture {
  const { el, g } = canvas(128);
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(.55, 'rgba(255,255,255,.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(el);
  ctx.track(texture);
  return texture;
}

// Deep-blue night environment for PMREM: brighter toward the horizon, faint moon glow.
export function nightEquirect(ctx: SceneContext): THREE.CanvasTexture {
  const { el, g } = canvas(512);
  el.height = 256;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1d3450');
  grad.addColorStop(.42, '#2e4d72');
  grad.addColorStop(.58, '#5a80aa');
  grad.addColorStop(.68, '#2a4260');
  grad.addColorStop(1, '#101822');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  const moon = g.createRadialGradient(390, 92, 4, 390, 92, 66);
  moon.addColorStop(0, 'rgba(214,228,244,.85)');
  moon.addColorStop(.25, 'rgba(160,185,215,.3)');
  moon.addColorStop(1, 'rgba(160,185,215,0)');
  g.fillStyle = moon;
  g.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(el);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  ctx.track(texture);
  return texture;
}

// Faint horizontal glow band to keep the sea/sky boundary readable at night.
export function horizonGlow(ctx: SceneContext): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = 16;
  el.height = 128;
  const g = el.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(140,170,200,0)');
  grad.addColorStop(.62, 'rgba(140,170,200,.28)');
  grad.addColorStop(.8, 'rgba(160,190,215,.4)');
  grad.addColorStop(1, 'rgba(140,170,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 128);
  const texture = new THREE.CanvasTexture(el);
  ctx.track(texture);
  return texture;
}

export function moonSprite(ctx: SceneContext): THREE.CanvasTexture {
  const { el, g } = canvas(128);
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(230,238,246,1)');
  grad.addColorStop(.72, 'rgba(214,226,238,.95)');
  grad.addColorStop(.8, 'rgba(190,205,222,.55)');
  grad.addColorStop(1, 'rgba(160,180,205,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const rand = lcg(229);
  for (let i = 0; i < 12; i++) {
    const x = 24 + rand() * 80, y = 24 + rand() * 80, r = 2 + rand() * 6;
    g.fillStyle = 'rgba(140,155,175,.28)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  ctx.track(texture);
  return texture;
}

export function rainStreak(ctx: SceneContext): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = 8;
  el.height = 32;
  const g = el.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, 'rgba(170,195,210,0)');
  grad.addColorStop(.5, 'rgba(190,215,232,.8)');
  grad.addColorStop(1, 'rgba(170,195,210,0)');
  g.fillStyle = grad;
  g.fillRect(3, 0, 2, 32);
  const texture = new THREE.CanvasTexture(el);
  ctx.track(texture);
  return texture;
}

// Diagonal amber/white chevrons for the truck rear panel.
export function chevrons(ctx: SceneContext): THREE.CanvasTexture {
  const { el, g } = canvas(128);
  g.fillStyle = '#e8e6df';
  g.fillRect(0, 0, 128, 128);
  g.save();
  g.translate(64, 64);
  g.rotate(-Math.PI / 4);
  g.fillStyle = '#dfac60';
  for (let x = -160; x < 160; x += 40) g.fillRect(x, -160, 20, 320);
  g.restore();
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  ctx.track(texture);
  return texture;
}

// Fresnel edge fade for additive cones: alpha dies toward the silhouette so a cone
// reads as a shaft of light, not a solid wedge. Basic materials lack transformedNormal
// outside envmap/skinning paths, so the normal is computed from the raw attribute.
export const softCone = (material: THREE.MeshBasicMaterial, power = 1.7): void => {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vEdge;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 coneNrm = normal;
        #ifdef USE_INSTANCING
          coneNrm = mat3(instanceMatrix) * coneNrm;
        #endif
        vEdge = abs(dot(normalize(normalMatrix * coneNrm), normalize(-mvPosition.xyz)));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEdge;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n diffuseColor.a *= pow(vEdge, ${power.toFixed(2)});`);
  };
};

// Vertical light-shaft gradient for lamp/beacon cones (white -> transparent).
export function beamGradient(ctx: SceneContext): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = 8;
  el.height = 64;
  const g = el.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,235,190,.85)');
  grad.addColorStop(1, 'rgba(255,235,190,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 64);
  const texture = new THREE.CanvasTexture(el);
  ctx.track(texture);
  return texture;
}
