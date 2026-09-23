import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { waterNormals, horizonGlow } from './textures.ts';
import type { SceneContext } from './common.ts';

const DAY_SUN = new THREE.Color(0xfff2dd);
const NIGHT_SUN = new THREE.Color(0x9fbbe0);

// Reflective sea with quality tiers: 0 = Water @512, 1 = Water @256, 2 = flat CPU-wave plane.
// The plane runs 400x400 so the sea reaches the horizon in every direction.
export class Sea {
  private ctx: SceneContext;
  private normals: THREE.CanvasTexture;
  private sunDir: THREE.Vector3;
  private moonDir: THREE.Vector3;
  private tier = -1;
  private current: THREE.Mesh | null = null;
  private flatGeometry: THREE.PlaneGeometry | null = null;
  private flatPositions: THREE.BufferAttribute | null = null;
  private flatBase: Float32Array | null = null;
  private glow: THREE.Mesh;
  private glowMaterial: THREE.MeshBasicMaterial;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(ctx: SceneContext, sunDir: THREE.Vector3, moonDir: THREE.Vector3) {
    this.ctx = ctx;
    this.sunDir = sunDir;
    this.moonDir = moonDir;
    this.normals = waterNormals(ctx);
    this.normals.repeat.set(24, 24);
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: horizonGlow(ctx), transparent: true, opacity: .5, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    ctx.track(this.glowMaterial);
    this.glow = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(420, 14)), this.glowMaterial);
    this.glow.position.set(0, 2, -190);
    ctx.world.add(this.glow);
    this.setTier(0);
  }

  private reflective(resolution: number): Water {
    const geometry = new THREE.PlaneGeometry(400, 400);
    const water = new Water(geometry, {
      textureWidth: resolution,
      textureHeight: resolution,
      waterNormals: this.normals,
      sunDirection: this.sunDir.clone(),
      sunColor: 0xfff2dd,
      waterColor: 0x0a232c,
      distortionScale: 1.6,
      fog: true,
    });
    (water.material as THREE.ShaderMaterial).uniforms['size']!.value = 2.2;
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -.82, 0);
    this.disposables.push(geometry, water.material as THREE.Material);
    return water as Water;
  }

  private flat(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(400, 400, 48, 48);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x0a232c, roughness: .22, metalness: .25, envMapIntensity: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, -.82, 0);
    mesh.receiveShadow = true;
    this.flatGeometry = geometry;
    this.flatPositions = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.flatBase = (this.flatPositions.array as Float32Array).slice();
    this.disposables.push(geometry, material);
    return mesh;
  }

  setTier(tier: number): void {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.current) {
      this.ctx.world.remove(this.current);
      this.current = null;
    }
    this.current = tier < 2 ? this.reflective(tier === 0 ? 512 : 256) : this.flat();
    this.ctx.world.add(this.current);
  }

  update(now: number, dt: number, nightness: number): void {
    this.glowMaterial.opacity = .1 + .22 * nightness;
    if (!this.current) return;
    const uniforms = (this.current.material as THREE.ShaderMaterial).uniforms;
    if (uniforms && uniforms['time']) {
      if (!this.ctx.reduced.matches) uniforms['time'].value += dt;
      // Key light = sun by day, moon at night.
      uniforms['sunDirection']!.value.copy(this.sunDir).lerp(this.moonDir, nightness).normalize();
      (uniforms['sunColor']!.value as THREE.Color).copy(DAY_SUN).lerp(NIGHT_SUN, nightness);
      return;
    }
    if (this.flatPositions && this.flatBase && !this.ctx.reduced.matches) {
      const arr = this.flatPositions.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] = this.flatBase[i + 1]! + .07 * Math.sin(this.flatBase[i]! * .7 + now * 1.6) + .05 * Math.sin(this.flatBase[i + 2]! * .9 + now * 1.1);
      }
      this.flatPositions.needsUpdate = true;
      this.flatGeometry!.computeVertexNormals();
    }
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
