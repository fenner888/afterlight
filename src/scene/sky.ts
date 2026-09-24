import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { worldMinutes } from '../scenario.ts';
import { cloudAlpha, moonSprite, nightEquirect, sunSprite } from './textures.ts';
import type { SceneContext } from './common.ts';

const EXPOSURE: Record<string, number> = { dusk: 1.2, night: 2.7, dawn: 1.2, day: 1.25 };
const DUSK_MINUTES = 19 * 60 + 30;

// Anchors (elapsed world minutes from 19:30, solar elevation deg):
// +3 at dusk, -40 near 01:00, dawn -6 -> +6 across 05:00-06:30, then up to a
// midday +35 and back down through the afternoon to +3 at the next dusk.
// Storms starting in daylight land on the second half of the arc.
const ELEVATION: [number, number][] = [[0, 3], [330, -40], [570, -6], [660, 6], [780, 18], [1080, 35], [1300, 20], [1440, 3]];
const solarElevation = (elapsed: number): number => {
  for (let i = 1; i < ELEVATION.length; i++) {
    const [t1, e1] = ELEVATION[i]!;
    if (elapsed <= t1) {
      const [t0, e0] = ELEVATION[i - 1]!;
      const t = (elapsed - t0) / (t1 - t0);
      return e0 + (e1 - e0) * (.5 - .5 * Math.cos(Math.PI * t));
    }
  }
  return ELEVATION.at(-1)![1];
};

// Per-phase Sky shader parameters: dusk storm -> clear day.
const SKY_PARAMS: Record<string, { turbidity: number; rayleigh: number; mie: number }> = {
  dusk: { turbidity: 8, rayleigh: 2.5, mie: .02 },
  night: { turbidity: 10, rayleigh: 1, mie: .004 },
  dawn: { turbidity: 7, rayleigh: 2, mie: .015 },
  day: { turbidity: 5, rayleigh: 1.2, mie: .008 },
};

export class SkyRig {
  readonly sun = new THREE.DirectionalLight(0xf5e3c0, 3.4);
  readonly moon = new THREE.DirectionalLight(0x9fbbe0, 0);
  readonly hemi = new THREE.HemisphereLight(0xc6dce9, 0x405047, 2.2);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  // Low moon toward the camera: facades facing us catch it, roofs get less.
  readonly moonDir = new THREE.Vector3(10, 22, 28).normalize();
  nightness = 0;
  private ctx: SceneContext;
  private sky = new Sky();
  private envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private nightTarget: THREE.WebGLRenderTarget;
  private nightEnv = false;
  private pmrem: THREE.PMREMGenerator;
  private lastBucket = -1;
  private exposure = 1.1;
  private skyParams = { turbidity: 8, rayleigh: 2.5, mie: .02 };
  private stars: THREE.Points;
  private starMaterial: THREE.PointsMaterial;
  private moonSprite: THREE.Sprite;
  private sunSprite: THREE.Sprite;
  private clouds: { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; map: THREE.CanvasTexture; base: number; speed: number }[] = [];
  private fog = new THREE.Color(0x0e1820);
  private flashUntil = 0;
  private lastFlashTick = -1;
  flash = 0;
  // Cloud coverage fraction — reused by the audio storm bed; do not recompute elsewhere.
  coverage = .9;
  onFlash?: () => void;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const { world, renderer } = ctx;
    this.sky.scale.setScalar(200);
    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity']!.value = 8;
    uniforms['rayleigh']!.value = 1.6;
    uniforms['mieCoefficient']!.value = .008;
    uniforms['mieDirectionalG']!.value = .85;
    world.add(this.sky);
    const envSky = new Sky();
    envSky.material = this.sky.material;
    envSky.scale.setScalar(50);
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    // Night environment: deep-blue canvas equirect (never the black Sky PMREM).
    this.nightTarget = this.pmrem.fromEquirectangular(nightEquirect(ctx));
    const positions = new Float32Array(1200 * 3);
    let seed = 9377;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 1200; i++) {
      const az = rand() * Math.PI * 2;
      const el = Math.asin(rand() * .95 + .05);
      positions[i * 3] = Math.cos(el) * Math.cos(az) * 140;
      positions[i * 3 + 1] = Math.sin(el) * 140;
      positions[i * 3 + 2] = Math.cos(el) * Math.sin(az) * 140;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    ctx.track(starGeometry);
    this.starMaterial = new THREE.PointsMaterial({ color: 0xcdd8e8, size: .55, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    ctx.track(this.starMaterial);
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.stars.frustumCulled = false;
    world.add(this.stars);
    const spriteMaterial = new THREE.SpriteMaterial({ map: moonSprite(ctx), transparent: true, opacity: 0, depthWrite: false });
    ctx.track(spriteMaterial);
    this.moonSprite = new THREE.Sprite(spriteMaterial);
    this.moonSprite.position.copy(this.moonDir).multiplyScalar(135);
    this.moonSprite.scale.setScalar(22);
    world.add(this.moonSprite);
    const sunSpriteMaterial = new THREE.SpriteMaterial({ map: sunSprite(ctx), transparent: true, opacity: 0, depthWrite: false, fog: false });
    ctx.track(sunSpriteMaterial);
    this.sunSprite = new THREE.Sprite(sunSpriteMaterial);
    // Past the shore ridge (~195) so the silhouette occludes it naturally.
    this.sunSprite.scale.setScalar(20);
    world.add(this.sunSprite);
    const cloudTexture = cloudAlpha(ctx);
    for (const [index, size, height, base, speed] of [[0, 150, 58, .42, .0004], [1, 210, 74, .27, .00022]] as const) {
      const map = index === 0 ? cloudTexture : ctx.track(cloudTexture.clone());
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1.6, 1.2);
      const material = new THREE.MeshStandardMaterial({
        color: 0x46525c, transparent: true, opacity: 0, alphaMap: map,
        depthWrite: false, roughness: 1, metalness: 0, emissive: 0xb8cce8, emissiveIntensity: 0,
        envMapIntensity: 0,
      });
      ctx.track(material);
      const geometry = ctx.track(new THREE.PlaneGeometry(size, size * .72));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(index === 0 ? -8 : 12, height, index === 0 ? 4 : -6);
      world.add(mesh);
      this.clouds.push({ mesh, material, map, base, speed });
    }
    this.sun.position.set(-8, 24, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
    this.sun.shadow.bias = -.0004;
    this.sun.shadow.radius = 4;
    this.moon.position.copy(this.moonDir).multiplyScalar(40);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    Object.assign(this.moon.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
    this.moon.shadow.bias = -.0004;
    this.moon.shadow.radius = 5;
    this.moon.shadow.intensity = .6; // lifted shadows keep the night readable
    world.add(this.sun, this.moon, this.hemi);
    world.fog = new THREE.Fog(0x0f1a26, 90, 340);
    world.background = new THREE.Color(0x0b1218);
  }

  triggerFlash(now: number): void {
    this.flashUntil = Math.max(this.flashUntil, now + .12);
    this.onFlash?.();
  }

  update(tick: number, load: number, simPhase: string, day: string, now: number, dt: number, worldStart: number): void {
    const { world, renderer } = this.ctx;
    const reducedMotion = this.ctx.reduced.matches;
    const minutes = worldMinutes(tick, worldStart);
    const elapsed = ((minutes - DUSK_MINUTES) % 1440 + 1440) % 1440;
    const elevation = solarElevation(elapsed);
    // The sun sweeps west->east under the horizon overnight (280 -> 80) then
    // continues through the day to the next sunset (80 -> 280 over 13h).
    const baseAzimuth = elapsed <= 660 ? 280 + elapsed / 660 * 160 : 440 + (elapsed - 660) / 780 * 200;
    // Sunrise payoff: through the dawn window (05:30-11:30 world) swing the low
    // sun over the far shoreline (-z, azimuth ~180) then back onto the day
    // track, so the 06:30 disc hangs above the shore without moving the squall.
    const dawnWeight = THREE.MathUtils.smoothstep(elapsed, 570, 660) * (1 - THREE.MathUtils.smoothstep(elapsed, 760, 960));
    const shoreDelta = ((180 - (baseAzimuth % 360)) + 540) % 360 - 180;
    const azimuth = THREE.MathUtils.degToRad(baseAzimuth + shoreDelta * dawnWeight);
    const polar = THREE.MathUtils.degToRad(90 - elevation);
    this.sunDir.setFromSphericalCoords(1, polar, azimuth);
    const k = load / 13;
    const uniforms = this.sky.material.uniforms;
    uniforms['sunPosition']!.value.copy(this.sunDir);
    const params = { ...(SKY_PARAMS[day] ?? SKY_PARAMS['night']!) };
    // Restoration clears the storm: restored dawn/day read brighter and
    // clearer, while an unrestored day keeps the overcast squall.
    if (day === 'dawn' || day === 'day') {
      params.turbidity -= (day === 'dawn' ? 2 : 1) * k;
      params.rayleigh += (day === 'dawn' ? .8 : 1.1) * k;
      params.mie += (day === 'dawn' ? .002 : 0) * k;
    }
    const ease = reducedMotion ? 1 : Math.min(1, dt * 1.4);
    this.skyParams.turbidity += (params.turbidity - this.skyParams.turbidity) * ease;
    this.skyParams.rayleigh += (params.rayleigh - this.skyParams.rayleigh) * ease;
    this.skyParams.mie += (params.mie - this.skyParams.mie) * ease;
    uniforms['turbidity']!.value = this.skyParams.turbidity;
    uniforms['rayleigh']!.value = this.skyParams.rayleigh;
    uniforms['mieCoefficient']!.value = this.skyParams.mie;
    const nightTarget = THREE.MathUtils.clamp((-elevation - 2) / 8, 0, 1);
    this.nightness += (nightTarget - this.nightness) * ease;
    const n = this.nightness;
    const exposureTarget = (EXPOSURE[day] ?? 1) + (day === 'dawn' || day === 'day' ? .1 * k : 0);
    // Fall fast when the scene is brightening (sunrise at 30x would otherwise
    // outrun the adaptation and blow out); rise gently into dusk/night.
    const exposureRate = exposureTarget < this.exposure ? 5.5 : 1.6;
    this.exposure += (exposureTarget - this.exposure) * (reducedMotion ? 1 : Math.min(1, dt * exposureRate));
    renderer.toneMappingExposure = this.exposure;
    const sunVisible = THREE.MathUtils.smoothstep(elevation, -6, 3);
    const dayFactor = THREE.MathUtils.smoothstep(elevation, 0, 25);
    this.sun.intensity = sunVisible * (3.2 + 1.4 * dayFactor);
    this.sun.color.setHex(0xff9a4d).lerp(new THREE.Color(0xf5e9cf), dayFactor);
    this.sun.position.copy(this.sunDir).multiplyScalar(48);
    this.sun.castShadow = this.sun.intensity > .05;
    this.moon.intensity = n * 1.6;
    this.moon.castShadow = n > .5;
    // Clear skies after restoration: less flat ambient, more sun contrast.
    const clearedDay = (day === 'dawn' || day === 'day') ? k : 0;
    this.hemi.intensity = (2.2 - 1.1 * n) * (1 - .25 * clearedDay);
    this.hemi.color.setHex(0xc6dce9).lerp(new THREE.Color(0x2e4a6b), n);
    this.hemi.groundColor.setHex(0x405047).lerp(new THREE.Color(0x141a20), n);
    const bucket = Math.floor(minutes / 20);
    if (bucket !== this.lastBucket) {
      this.lastBucket = bucket;
      const next = this.pmrem.fromScene(this.envScene, .04);
      this.envTarget?.dispose();
      this.envTarget = next;
    }
    const wantNightEnv = elevation < -4;
    if (wantNightEnv !== this.nightEnv) {
      this.nightEnv = wantNightEnv;
      world.environment = wantNightEnv ? this.nightTarget.texture : this.envTarget?.texture ?? null;
    } else if (!wantNightEnv && this.envTarget) {
      world.environment = this.envTarget.texture;
    }
    world.environmentIntensity = (1.15 + 2.15 * n) * (1 - .3 * clearedDay);
    const coverage = THREE.MathUtils.lerp(.9, .25, k);
    this.coverage = coverage;
    for (const cloud of this.clouds) {
      cloud.map.offset.x = tick * cloud.speed;
      cloud.map.offset.y = tick * cloud.speed * .35;
      cloud.material.opacity = coverage * cloud.base * (1 - .55 * dayFactor) * .75;
      // Tint by sky: warm at dusk/day edge, dark blue-grey at night.
      const shade = new THREE.Color(0x4a525e).lerp(new THREE.Color(0x161e28), n).lerp(new THREE.Color(0x9aa0a6), dayFactor * .8);
      cloud.material.color.copy(shade);
    }
    // Stars only through gaps in the cover.
    this.starMaterial.opacity = n * THREE.MathUtils.smoothstep(coverage, .5, .35) * .85;
    if (!reducedMotion) this.starMaterial.opacity *= .88 + .12 * Math.sin(now * 3.7);
    (this.moonSprite.material as THREE.SpriteMaterial).opacity = n * (1 - coverage * .4);
    // Sun disc rides the same direction as the directional light: hidden below
    // the horizon, faded by cloud cover, sharpest in a cleared dawn sky.
    // Height is flattened so it reads as rising over the far shore ridge —
    // at true elevation it would sit far above the frame at any sane zoom.
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(220);
    this.sunSprite.position.y *= .35;
    (this.sunSprite.material as THREE.SpriteMaterial).opacity = sunVisible * (1 - coverage * .85);
    const horizonWarmth = THREE.MathUtils.clamp(1 - Math.abs(elevation - 2) / 16, 0, 1) * (1 - n);
    this.fog.setHex(0x0f1a26).lerp(new THREE.Color(0x7a4f38), horizonWarmth * (.22 + .3 * k) + k * .12);
    // Day haze: distant geometry (the far shore strip, far water) must fog
    // toward the pale daytime sky, not the night navy — otherwise the shore
    // renders as a hard black band under a bright sky.
    this.fog.lerp(new THREE.Color(0xa9b8bd), dayFactor * .85);
    (world.fog as THREE.Fog).color.copy(this.fog);
    if (!reducedMotion && simPhase === 'dispatch' && (tick * 7919) % 173 === 0 && tick !== this.lastFlashTick) {
      this.lastFlashTick = tick;
      this.triggerFlash(now);
    }
    this.flash = Math.max(0, (this.flashUntil - now) / .12);
    if (this.flash > 0) {
      const f = this.flash;
      this.sun.intensity += 8 * f;
      this.moon.intensity += 4 * f;
      this.hemi.intensity += 1.6 * f;
      renderer.toneMappingExposure = this.exposure + .35 * f;
      for (const cloud of this.clouds) cloud.material.emissiveIntensity = 1.6 * f;
    } else {
      for (const cloud of this.clouds) cloud.material.emissiveIntensity = 0;
    }
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.nightTarget.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
  }
}
