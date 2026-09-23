import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SERVICE_IDS, FEEDER_IDS, isFeeder, isService } from '../scenario.ts';
import type { NodeId, ServiceId, FeederId } from '../scenario.ts';
import { POSITIONS } from './common.ts';
import type { SceneContext } from './common.ts';
import { asphalt, concrete, brick, corrugated, coursedStone, gravel, paintedMetal, wood, puddleRoughness, beamGradient, softCone } from './textures.ts';
import type { TextureSet } from './textures.ts';

// Vertex-coloured merge helpers (same pattern as vehicles.ts): static decoration
// collapses into one draw call per material class.
const colorize = (g: THREE.BufferGeometry, color: number): THREE.BufferGeometry => {
  const c = new THREE.Color(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
};
const part = (list: THREE.BufferGeometry[], color: number, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  colorize(g, color).translate(x, y, z);
  list.push(g);
};
const lcg = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
};

export type ServiceLight = 'offline' | 'backup' | 'grid';

const WARM = new THREE.Color(0xffd28a).multiplyScalar(1.8);
const COOL = new THREE.Color(0xcfe3ff).multiplyScalar(1.55);
const AMBER = new THREE.Color(0xdfac60).multiplyScalar(1.7);
const OFF = new THREE.Color(0x141f26);

// One instanced quad per window across all service buildings; instanceColor drives
// the lit look (values > 1 feed bloom at night). A second InstancedMesh carries a
// merged sill/lintel/jamb surround per window so lit panes read as inset frames.
export class WindowLights {
  private mesh: THREE.InstancedMesh;
  private frames: THREE.InstancedMesh;
  private ranges = new Map<ServiceId, { start: number; count: number }>();
  private onHash: Float32Array;
  private stagger: Float32Array;
  private tint: Float32Array;
  private litAt = new Map<ServiceId, number>();
  private lastStatus = new Map<ServiceId, ServiceLight>();
  private lastKey = new Map<ServiceId, string>();
  private cursor = 0;
  private seed = 4242;
  private rand(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  constructor(ctx: SceneContext, capacity: number) {
    const geometry = ctx.track(new THREE.PlaneGeometry(.34, .44));
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
    ctx.track(material);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const frameParts = [
      colorize(new THREE.BoxGeometry(.44, .05, .09), 0x9aa39c).translate(0, -.25, .02),  // sill
      colorize(new THREE.BoxGeometry(.42, .06, .07), 0x9aa39c).translate(0, .25, .01),   // lintel
      colorize(new THREE.BoxGeometry(.045, .44, .06), 0x878f8a).translate(-.195, 0, .01),
      colorize(new THREE.BoxGeometry(.045, .44, .06), 0x878f8a).translate(.195, 0, .01),
    ];
    const frameGeometry = ctx.track(mergeGeometries(frameParts)!);
    frameParts.forEach(g => g.dispose());
    const frameMaterial = ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, metalness: .05, envMapIntensity: .5 }));
    this.frames = new THREE.InstancedMesh(frameGeometry, frameMaterial, capacity);
    this.frames.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.onHash = new Float32Array(capacity);
    this.stagger = new Float32Array(capacity);
    this.tint = new Float32Array(capacity);
    ctx.world.add(this.mesh, this.frames);
  }

  addWindow(service: ServiceId, position: THREE.Vector3, ry: number): void {
    const index = this.cursor++;
    if (!this.ranges.has(service)) this.ranges.set(service, { start: index, count: 0 });
    this.ranges.get(service)!.count++;
    const matrix = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.mesh.setMatrixAt(index, matrix);
    this.frames.setMatrixAt(index, matrix);
    this.mesh.setColorAt(index, OFF);
    this.onHash[index] = this.rand();
    this.stagger[index] = this.rand();
    this.tint[index] = this.rand();
  }

  seal(): void { this.mesh.count = this.cursor; this.frames.count = this.cursor; }

  note(id: ServiceId, status: ServiceLight, now: number): void {
    if (this.lastStatus.get(id) === status) return;
    this.lastStatus.set(id, status);
    if (status !== 'offline') this.litAt.set(id, now);
  }

  update(statusOf: (id: ServiceId) => ServiceLight, now: number, reduced: boolean): void {
    const temp = new THREE.Color();
    let dirty = false;
    for (const [id, range] of this.ranges) {
      const status = statusOf(id);
      const litAt = this.litAt.get(id) ?? 0;
      const staggerT = reduced || status === 'offline' ? 1 : Math.min(1, (now - litAt) / 1.5);
      const key = `${status}|${status === 'grid' ? Math.ceil(staggerT * 24) : 0}`;
      if (key === this.lastKey.get(id)) continue;
      this.lastKey.set(id, key);
      for (let i = range.start; i < range.start + range.count; i++) {
        if (status === 'offline') temp.copy(OFF);
        else if (status === 'backup') temp.copy(this.onHash[i]! < .18 ? AMBER : OFF);
        else {
          const on = this.onHash[i]! < .7 && this.stagger[i]! <= staggerT;
          temp.copy(on ? (this.tint[i]! < .8 ? WARM : COOL) : OFF);
        }
        this.mesh.setColorAt(i, temp);
      }
      dirty = true;
    }
    if (dirty) this.mesh.instanceColor!.needsUpdate = true;
  }
}

export interface DistrictBuild {
  nodes: Map<NodeId, THREE.Group>;
  windows: WindowLights;
  feederGlow: Map<FeederId, THREE.MeshStandardMaterial>;
  beaconPivot: THREE.Group;
  beaconLamp: THREE.MeshStandardMaterial;
  clinicCross: THREE.MeshStandardMaterial;
  clinicGen: THREE.MeshStandardMaterial;
  shoreWindows: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  wetMaterials: THREE.MeshStandardMaterial[];
}

const cloneSet = (ctx: SceneContext, set: TextureSet, rx: number, ry: number): { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture } => {
  const out: { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture } = {};
  for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
    const source = set[key];
    if (!source) continue;
    const clone = ctx.track(source.clone());
    clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
    clone.repeat.set(rx, ry);
    clone.needsUpdate = true;
    out[key] = clone;
  }
  return out;
};

export function buildDistrict(ctx: SceneContext): DistrictBuild {
  const { world } = ctx;
  const nodes = new Map<NodeId, THREE.Group>();
  const feederGlow = new Map<FeederId, THREE.MeshStandardMaterial>();
  const sets = {
    asphalt: asphalt(ctx),
    concrete: concrete(ctx),
    brickRed: brick(ctx, 'red'),
    brickBrown: brick(ctx, 'brown'),
    corrugated: corrugated(ctx),
    stone: coursedStone(ctx),
    gravel: gravel(ctx),
    metalDark: paintedMetal(ctx, '#3d4a50'),
    metalPaint: paintedMetal(ctx, '#5f707a'),
    wood: wood(ctx),
  };
  const wetMaterials: THREE.MeshStandardMaterial[] = [];
  const skin = (set: TextureSet, color: number, rx = 1, ry = 1, rough = .8, metal = .06): THREE.MeshStandardMaterial => {
    const maps = cloneSet(ctx, set, rx, ry);
    const material = new THREE.MeshStandardMaterial({ color, ...maps, roughness: rough, metalness: metal, envMapIntensity: .6 });
    ctx.track(material);
    return material;
  };
  const plain = (color: number, emissive = 0): THREE.MeshStandardMaterial => ctx.material(color, emissive);
  const puddles = puddleRoughness(ctx);

  const buildTerrain = (): void => {
    const platform = skin(sets.concrete, 0xffffff, 4.15, 3.15, 1); // one tile ~6 world units
    platform.roughnessMap = ctx.track(puddles.clone());
    platform.roughnessMap.needsUpdate = true;
    wetMaterials.push(platform);
    const curb = skin(sets.concrete, 0x5d6c69, 2, .3, .9);
    ctx.box(world, plain(0x2d3c3d), [0, -.25, 0], [25, 1.3, 19]);
    ctx.box(world, platform, [0, .34, 0], [24.8, .15, 18.8]);
    // Quay-edge curb, gapped where the depot apron meets the working face.
    ctx.box(world, curb, [-9.25, .55, 9.2], [6.3, .38, .25]);
    ctx.box(world, curb, [6.55, .55, 9.2], [11.7, .38, .25]);
    ctx.box(world, curb, [-12.25, .55, 0], [.25, .38, 18.5]);

    const roadSet: TextureSet = { map: sets.asphalt.map, roughnessMap: puddles };
    const roadMat = (w: number, d: number): THREE.MeshStandardMaterial => {
      const maps = cloneSet(ctx, roadSet, w / 4, d / 4); // one tile ~4 world units
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, ...maps, roughness: 1, metalness: .02, envMapIntensity: .6 });
      ctx.track(material);
      wetMaterials.push(material);
      return material;
    };
    const sidewalkMat = skin(sets.concrete, 0xffffff, 2.9, .08, .85);
    sidewalkMat.color.setRGB(1.3, 1.31, 1.28); // lifts baked albedo to ~0x8a8d88
    const curbMat = plain(0xb9beb2);
    const paint = plain(0xdfe2da);
    const road = (x: number, z: number, w: number, d: number): void => { ctx.box(world, roadMat(w, d), [x, .43, z], [w, .06, d]); };
    const walk = (x: number, z: number, w: number, d: number): void => { ctx.box(world, sidewalkMat, [x, .45, z], [w, .08, d]); };
    const curbLine = (x: number, z: number, w: number, d: number): void => { ctx.box(world, curbMat, [x, .48, z], [w, .05, d]); };

    road(0, 1.8, 24.5, 1.65);   // main east-west
    road(-8, 0, 1.5, 16);       // north-south west
    road(8, 0, 1.5, 16);        // north-south east
    road(0, -2.1, 16, 1.15);    // northern link
    road(-.9, 4.1, 1.4, 4.6);   // depot access
    road(-3, 6.3, 5.6, 1.4);    // south quay link
    road(-2.7, 8.2, 6.6, 2.4);  // depot apron — paved yard in front of the bays

    // Sidewalks + curb lines, segmented so they never cross asphalt.
    for (const [x, w] of [[-10.5, 3.5], [0, 17.5], [10.5, 3.5]] as const) walk(x, .725, w, .5);
    for (const [x, w] of [[-10.5, 3.5], [-5.23, 7.05], [4.33, 8.85], [10.5, 3.5]] as const) walk(x, 2.875, w, .5);
    for (const x of [-9, -7, 7, 9]) {
      for (const [z, d] of [[-5.34, 5.325], [-.275, 2.5], [5.31, 5.375]] as const) walk(x, z, .5, d);
    }
    for (const z of [-2.925, -1.275]) walk(0, z, 13.4, .5);
    for (const x of [-1.85, .05]) walk(x, 4.09, .5, 2.93);
    walk(-3.73, 5.35, 4.15, .5);
    for (const [x, w] of [[-10.5, 3.5], [0, 17.5], [10.5, 3.5]] as const) curbLine(x, .99, w, .08);
    for (const [x, w] of [[-10.5, 3.5], [-5.23, 7.05], [4.33, 8.85], [10.5, 3.5]] as const) curbLine(x, 2.61, w, .08);
    for (const x of [-8.79, -7.21, 7.21, 8.79]) for (const [z, d] of [[-5.34, 5.325], [-.275, 2.5], [5.31, 5.375]] as const) curbLine(x, z, .08, d);
    for (const z of [-2.66, -1.54]) curbLine(0, z, 13.4, .08);
    for (const x of [-1.56, -.24]) curbLine(x, 4.09, .08, 2.93);
    for (const z of [5.64, 6.96]) curbLine(-3.73, z, 4.15, .08);

    // Dashed centre lines (skipping junctions) and crosswalks at the two main junctions.
    for (let x = -11; x < 12; x += 2) if (Math.abs(x - 8) > 1.4 && Math.abs(x + 8) > 1.4) ctx.box(world, paint, [x, .47, 1.8], [.65, .02, .04]);
    for (const x of [-8, 8]) for (let z = -7.6; z < 8; z += 1.6) if (z < -2.8 || (z > -1.4 && z < .9) || z > 2.7) ctx.box(world, paint, [x, .47, z], [.04, .02, .65]);
    for (let x = -7; x < 8; x += 1.6) if (Math.abs(x - 8) > 1.4 && Math.abs(x + 8) > 1.4) ctx.box(world, paint, [x, .47, -2.1], [.65, .02, .04]);
    for (const jx of [-8, 8]) {
      for (const z of [1.15, 1.6, 2.05, 2.5]) ctx.box(world, paint, [jx, .47, z], [1.3, .02, .26]);
      for (const x of [jx - .65, jx - .25, jx + .15, jx + .55]) ctx.box(world, paint, [x, .47, 1.8], [.26, .02, 1.3]);
    }
  };

  // Merge a list of translated/coloured geometries into one mesh (one draw call).
  // Normalizes to non-indexed so ExtrudeGeometry can mix with boxes/cylinders.
  const merged = (parent: THREE.Object3D, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh => {
    const normalized = geometries.map(g => (g.index ? g.toNonIndexed() : g));
    const geometry = ctx.track(mergeGeometries(normalized)!);
    normalized.forEach(g => g.dispose());
    geometries.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const buildQuay = (): void => {
    // Stone seawall: coursed faces on all four sides standing in the water,
    // extending well below the surface (y -2.2) so no slab edge ever floats.
    const stone = sets.stone;
    const wallFace = (x: number, z: number, w: number, d: number, ry = 0): void => {
      const maps = cloneSet(ctx, stone, (ry ? d : w) / 6, 1.1);
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, ...maps, roughness: .9, metalness: .03, envMapIntensity: .5 });
      ctx.track(material);
      wetMaterials.push(material);
      ctx.box(world, material, [x, -.85, z], [w, 2.7, d]); // y -2.2 → .5, tucked under the capstone
    };
    wallFace(0, 9.72, 25.3, .6);          // south — the working quay face
    wallFace(0, -9.72, 25.3, .6);         // north
    wallFace(12.72, 0, .6, 19.3, 1);      // east
    wallFace(-12.72, 0, .6, 19.3, 1);     // west

    // Capstone lip ring + darker waterline band, each merged to a single mesh.
    const capParts: THREE.BufferGeometry[] = [];
    part(capParts, 0x6f7a72, 25.6, .14, 1.1, 0, .55, 9.95);
    part(capParts, 0x6f7a72, 25.6, .14, 1.1, 0, .55, -9.95);
    part(capParts, 0x6f7a72, 1.1, .14, 19.6, 12.75, .55, 0);
    part(capParts, 0x6f7a72, 1.1, .14, 19.6, -12.75, .55, 0);
    merged(world, ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: .05, envMapIntensity: .5 })), capParts);
    const bandParts: THREE.BufferGeometry[] = [];
    part(bandParts, 0x2f3d39, 25.4, .6, .06, 0, -.72, 10.03);
    part(bandParts, 0x2f3d39, 25.4, .6, .06, 0, -.72, -10.03);
    part(bandParts, 0x2f3d39, .06, .6, 19.4, 13.03, -.72, 0);
    part(bandParts, 0x2f3d39, .06, .6, 19.4, -13.03, -.72, 0);
    merged(world, ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: .4 })), bandParts);

    // Timber pilings under the pier — two bents of three, merged.
    const plank = skin(sets.wood, 0xa89880, 1, 2, .85);
    ctx.box(world, plank, [-9.3, .16, 11.6], [1.7, .14, 4.4]);
    const pileParts: THREE.BufferGeometry[] = [];
    for (const pz of [10.1, 11.9, 13.5]) for (const px of [-10, -8.6])
      pileParts.push(colorize(new THREE.CylinderGeometry(.1, .11, 2.6, 8), 0x3a332b).translate(px, -.55, pz));
    merged(world, ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, envMapIntensity: .4 })), pileParts);

    // Wall ladders, tyre fenders and bollards along the working face.
    const ladderParts: THREE.BufferGeometry[] = [];
    for (const lx of [-4.2, 3.6]) {
      for (const s of [-.16, .16]) part(ladderParts, 0x55606a, .045, 1.9, .045, lx + s, -.35, 10.06);
      for (let r = 0; r < 6; r++) part(ladderParts, 0x55606a, .36, .04, .04, lx, -1.05 + r * .3, 10.07);
    }
    merged(world, ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .4, envMapIntensity: .6 })), ladderParts);
    const tyreGeometry = ctx.track(new THREE.TorusGeometry(.2, .075, 8, 14));
    const tyres = new THREE.InstancedMesh(tyreGeometry, plain(0x14181a), 4);
    const matrix = new THREE.Matrix4();
    [-11.9, -9.9, -7.1, -5.4].forEach((fx, i) => {
      matrix.makeTranslation(fx, -.18, 10.05);
      tyres.setMatrixAt(i, matrix);
    });
    tyres.castShadow = true;
    world.add(tyres);
    const bollard = skin(sets.metalDark, 0x8b979b, 1, 1, .5, .4);
    for (const bx of [-11, -10, -8.2, -7.4]) ctx.cylinder(world, bollard, [bx, .58, 9.12], .09, .3);

    // Riprap at the south-east corner: seeded scatter of angular rocks.
    const rand = lcg(97);
    const rockGeometry = ctx.track(new THREE.IcosahedronGeometry(.34, 0));
    const rocks = new THREE.InstancedMesh(rockGeometry, plain(0x3d4442), 14);
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (let i = 0; i < 14; i++) {
      const x = 10.9 + rand() * 2.6, z = 8.9 + rand() * 2.4;
      const y = -.95 + rand() * .55, s = .55 + rand() * .8;
      euler.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      matrix.compose(new THREE.Vector3(x, y, z), quat.setFromEuler(euler), new THREE.Vector3(s, s * .75, s));
      rocks.setMatrixAt(i, matrix);
    }
    rocks.castShadow = true;
    world.add(rocks);
  };

  // Fog-faded far shore across the water: one continuous low land strip with a
  // gentle ridge silhouette, towns clustered in small groups along it, a few lit
  // windows at night only. Decoration only — not nodes, never interactive.
  const buildShore = (): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
    const rand = lcg(211);
    // Seeded hill profile: the strip's top edge undulates so it never reads flat.
    const ridge = (x: number): number =>
      1.15 + .85 * Math.sin(x * .019 + 1.7) + .5 * Math.sin(x * .041 + .4) + .3 * Math.sin(x * .067 + 2.9);
    const parts: THREE.BufferGeometry[] = [];
    const strip = new THREE.Shape();
    strip.moveTo(-170, -3.5);
    for (let x = -170; x <= 170; x += 4) strip.lineTo(x, Math.max(.45, ridge(x)));
    strip.lineTo(170, -3.5);
    strip.closePath();
    const land = new THREE.ExtrudeGeometry(strip, { depth: 12, bevelEnabled: false });
    parts.push(colorize(land.translate(0, 0, -198), 0x35424c));
    // Towns: four clusters with open water between; varied sizes, some pitched roofs.
    const windowSpots: [number, number][] = [];
    for (const cx of [-64, -10, 42, 94]) {
      const count = 4 + Math.floor(rand() * 4);
      let tx = cx - count * 1.5;
      for (let b = 0; b < count; b++) {
        const w = 1.3 + rand() * 3.6, h = .8 + rand() * 2.9, d = 4 + rand() * 2.5;
        const base = Math.max(.45, ridge(tx + w / 2)) - .35;
        parts.push(colorize(new THREE.BoxGeometry(w, h, d), 0x3d4a56).translate(tx + w / 2, base + h / 2, -192));
        if (rand() < .45) {
          const gable = new THREE.Shape();
          gable.moveTo(-d / 2, 0);
          gable.lineTo(d / 2, 0);
          gable.lineTo(0, .45 + rand() * .55);
          gable.closePath();
          const roof = new THREE.ExtrudeGeometry(gable, { depth: w, bevelEnabled: false });
          roof.rotateY(Math.PI / 2); // ridge along x
          parts.push(colorize(roof.translate(tx, base + h, -192), 0x333f49));
        }
        if (rand() < .7) windowSpots.push([tx + w * (.25 + rand() * .5), base + .35 + rand() * Math.max(.3, h - .5)]);
        tx += w + .8 + rand() * 2.4;
      }
    }
    merged(world, ctx.track(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })), parts);
    const litMaterial = ctx.track(new THREE.MeshBasicMaterial({ color: 0xc9965a, transparent: true, opacity: 0, fog: true }));
    const lit = new THREE.InstancedMesh(ctx.track(new THREE.PlaneGeometry(.4, .55)), litMaterial, windowSpots.length);
    const matrix = new THREE.Matrix4();
    windowSpots.forEach(([wx, wy], i) => {
      matrix.makeTranslation(wx, wy, -187.4);
      lit.setMatrixAt(i, matrix);
    });
    lit.visible = false;
    world.add(lit);
    return lit;
  };

  const buildWetDetails = (): void => {
    const puddle = new THREE.MeshStandardMaterial({ color: 0x10181d, roughness: .06, metalness: .4, envMapIntensity: .7 });
    ctx.track(puddle);
    const disc = ctx.track(new THREE.CircleGeometry(1, 20));
    for (const [px, pz, r] of [[0, 1.8, 1.15], [-8, .4, .95], [8, 3.2, .8], [-3, 6.3, .9], [3.4, -2.1, .7]] as const) {
      const mesh = new THREE.Mesh(disc, puddle);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(px, .475, pz);
      mesh.scale.setScalar(r);
      mesh.receiveShadow = true;
      world.add(mesh);
    }
  };

  const buildLinePoles = (): void => {
    const vertices = new Set<string>();
    for (const feeder of FEEDER_IDS) {
      const [fx, fz] = POSITIONS[feeder];
      vertices.add(`${fx},${fz}`);
      vertices.add(`${fx},${POSITIONS.supply[1]}`);
      vertices.add(`0,-2.1`);
      for (const service of SERVICE_IDS) vertices.add(`${POSITIONS[service][0]},${POSITIONS[service][1]}`);
    }
    vertices.add(`${POSITIONS.supply[0]},${POSITIONS.supply[1]}`);
    const geometry = ctx.track(new THREE.CylinderGeometry(.04, .05, .75, 6));
    const poles = new THREE.InstancedMesh(geometry, skin(sets.metalDark, 0x6a777b, 1, 1, .6, .3), vertices.size);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (const vertex of vertices) {
      const [x, z] = vertex.split(',').map(Number);
      matrix.makeTranslation(x!, .78, z!);
      poles.setMatrixAt(index++, matrix);
    }
    poles.castShadow = true;
    world.add(poles);
  };

  const buildDetails = (): void => {
    const trees: [number, number, number][] = [[-11, -4, 1], [-5.8, -.4, .8], [5.4, -3.8, 1.1], [10.5, -.5, .9], [1.1, 8.4, 1], [10.5, 5.2, .85], [-11.4, 2.6, .75], [4.6, 7.6, .9], [-6.8, -7.6, .8], [11.3, -6.4, 1]];
    const trunkGeometry = ctx.track(new THREE.CylinderGeometry(.09, .13, 1, 7));
    const lumpGeometry = ctx.track(new THREE.IcosahedronGeometry(.52, 1));
    const trunks = new THREE.InstancedMesh(trunkGeometry, skin(sets.wood, 0x6b6152, 1, 1, .9), trees.length);
    // Clustered canopy: one crown lump + three offset lower lumps per tree,
    // per-instance green variation (instanceColor), deterministic via lcg.
    const lumpsPer = 4;
    const canopyMaterial = ctx.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, metalness: 0, envMapIntensity: .4 }));
    const canopies = new THREE.InstancedMesh(lumpGeometry, canopyMaterial, trees.length * lumpsPer);
    const matrix = new THREE.Matrix4();
    const rand = lcg(131);
    const leaf = new THREE.Color();
    trees.forEach(([x, z, size], index) => {
      matrix.makeScale(size, size, size).setPosition(x, .42 + .5 * size, z);
      trunks.setMatrixAt(index, matrix);
      const lumps: [number, number, number, number][] = [
        [0, 1.62, 0, 1],
        [.38, 1.2, .18, .78], [-.36, 1.24, -.14, .72], [.05, 1.28, -.4, .66],
      ];
      lumps.forEach(([lx, ly, lz, ls], l) => {
        const i = index * lumpsPer + l;
        matrix.makeScale(size * ls, size * ls * .92, size * ls).setPosition(x + lx * size, .42 + ly * size, z + lz * size);
        canopies.setMatrixAt(i, matrix);
        leaf.setHex(0x3c5748).offsetHSL((rand() - .5) * .04, (rand() - .5) * .12, (rand() - .5) * .08);
        canopies.setColorAt(i, leaf);
      });
    });
    trunks.castShadow = canopies.castShadow = true;
    world.add(trunks, canopies);
    const frame = skin(sets.metalDark, 0x74848b, 1, 1, .55, .35);
    for (const [sx, sz] of [[-1.5, 3.05], [6.5, -.95]] as const) {
      const shelter = new THREE.Group();
      for (const x of [-.8, .8]) ctx.box(shelter, frame, [x, .8, 0], [.08, 1.6, .08]);
      ctx.box(shelter, frame, [0, 1.62, .1], [1.9, .08, .8]);
      ctx.box(shelter, plain(0x27363b), [0, 1.05, -.28], [1.8, 1.1, .05]);
      ctx.box(shelter, frame, [0, .62, -.1], [1.5, .12, .35]);
      shelter.position.set(sx, .42, sz);
      world.add(shelter);
    }
    const bagGeometry = ctx.track(new THREE.BoxGeometry(.5, .22, .3));
    const bagSpots: [number, number][] = [[-11.5, 8.85], [-11, 8.85], [-10.5, 8.85], [-7.9, 8.85], [-7.4, 8.85], [-6.9, 8.85], [10.2, 8.85], [10.7, 8.85], [11.2, 8.85]];
    const bags = new THREE.InstancedMesh(bagGeometry, plain(0x6b6552), bagSpots.length);
    bagSpots.forEach(([x, z], index) => {
      matrix.makeTranslation(x, .53, z);
      bags.setMatrixAt(index, matrix);
    });
    bags.castShadow = true;
    world.add(bags);
    const postGeometry = ctx.track(new THREE.CylinderGeometry(.035, .035, .9, 6));
    const fenceSpots: [number, number][] = [];
    for (const feeder of FEEDER_IDS) {
      const [fx, fz] = POSITIONS[feeder];
      for (const dx of [-1.7, -.55, .55]) { fenceSpots.push([fx + dx, fz - 1.45]); fenceSpots.push([fx + dx, fz + 1.45]); }
      for (const dz of [-.8, 0, .8]) { fenceSpots.push([fx - 1.7, fz + dz]); fenceSpots.push([fx + 1.7, fz + dz]); }
    }
    const fence = new THREE.InstancedMesh(postGeometry, skin(sets.metalDark, 0x7a888d, 1, 1, .5, .4), fenceSpots.length);
    fenceSpots.forEach(([x, z], index) => {
      matrix.makeTranslation(x, .9, z);
      fence.setMatrixAt(index, matrix);
    });
    world.add(fence);
    for (const feeder of FEEDER_IDS) {
      const [fx, fz] = POSITIONS[feeder];
      const rail = skin(sets.metalDark, 0x7a888d, 1, 1, .5, .4);
      ctx.box(world, rail, [fx, 1.32, fz - 1.45], [3.4, .05, .05]);
      ctx.box(world, rail, [fx, 1.32, fz + 1.45], [3.4, .05, .05]);
      ctx.box(world, rail, [fx - 1.7, 1.32, fz], [.05, .05, 2.9]);
      ctx.box(world, rail, [fx + 1.7, 1.32, fz], [.05, .05, 2.9]);
    }
  };

  buildTerrain();
  buildQuay();
  const shoreWindows = buildShore();
  buildWetDetails();
  buildLinePoles();
  buildDetails();

  // Shared vertex-coloured material for merged per-building decoration.
  const trimMaterial = ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: .18, envMapIntensity: .6 }));

  // Instanced windows across all service buildings — every facade carries them
  // (front/rear/east/west) so no face reads blank from an orbited camera.
  const windows = new WindowLights(ctx, 192);
  const windowFace = (id: ServiceId, width: number, depth: number, height: number, rows: number, frontCols: number, sideCols: number, rearCols: number): void => {
    const [bx, bz] = POSITIONS[id];
    const rowY = (row: number): number => .45 + .14 + .55 + (row + .5) * (height - .9) / rows;
    const grid = (count: number, along: number, ry: number, place: (axis: number, y: number) => THREE.Vector3): void => {
      for (let row = 0; row < rows; row++) for (let col = 0; col < count; col++) {
        const axis = (col - (count - 1) / 2) * ((along - .8) / Math.max(1, count - 1));
        windows.addWindow(id, place(axis, rowY(row)), ry);
      }
    };
    grid(frontCols, width, 0, (x, y) => new THREE.Vector3(bx + x, y, bz + depth / 2 + .017));
    grid(rearCols, width, Math.PI, (x, y) => new THREE.Vector3(bx + x, y, bz - depth / 2 - .017));
    grid(sideCols, depth, Math.PI / 2, (z, y) => new THREE.Vector3(bx + width / 2 + .017, y, bz + z));
    grid(sideCols, depth, -Math.PI / 2, (z, y) => new THREE.Vector3(bx - width / 2 - .017, y, bz + z));
  };

  const beacon = { pivot: null as THREE.Group | null, lamp: null as THREE.MeshStandardMaterial | null };
  const clinic = { cross: null as THREE.MeshStandardMaterial | null, gen: null as THREE.MeshStandardMaterial | null };

  const buildNode = (id: NodeId): void => {
    const group = new THREE.Group();
    const roof = skin(sets.gravel, 0x6a7a80, 1.6, 1.4, .95);
    const parapet = skin(sets.metalDark, 0x5c6d75, 1, .2, .6, .3);
    const concreteMat = skin(sets.concrete, 0x97a19a, 1, .8, .85);
    if (id === 'supply') {
      const metal = skin(sets.metalPaint, 0x7c8d94, 1, 1, .55, .4);
      for (const x of [-.65, .65]) ctx.box(group, metal, [x, 1.15, 0], [.17, 2.3, .17]);
      ctx.box(group, concreteMat, [0, 2, 0], [2, .18, .22]);
      ctx.box(group, concreteMat, [0, 1.5, 0], [1.6, .15, .2]);
    } else if (isFeeder(id)) {
      const walls = skin(sets.corrugated, 0x9fb0b2, 1.4, .9, .6, .35);
      ctx.box(group, concreteMat, [0, .14, 0], [3.1, .28, 2.65]);
      ctx.box(group, walls, [0, .8, 0], [1.9, 1.05, 1.55]);
      const glow = plain(0x26353b);
      feederGlow.set(id, glow);
      ctx.box(group, glow, [0, .83, .79], [.45, .18, .04]);
      const metal = skin(sets.metalPaint, 0x8a9aa0, 1, 1, .5, .45);
      for (const x of [-.65, .65]) {
        ctx.cylinder(group, metal, [x, 1.55, 0], .17, .65);
        ctx.box(group, concreteMat, [x, 1.88, 0], [.4, .1, .35]);
      }
      for (const x of [-1.35, 1.35]) ctx.box(group, metal, [x, 1, -.9], [.1, 1.8, .1]);
      ctx.box(group, metal, [0, 1.9, -.9], [2.8, .12, .1]);
    } else if (id === 'beacon') {
      const white = skin(sets.concrete, 0xc9c4b2, 1, 2, .7);
      const band = skin(sets.metalPaint, 0x7d3f36, 1, .3, .55, .25);
      ctx.cylinder(group, concreteMat, [0, .1, 0], 1.1, .2);
      ctx.cylinder(group, white, [0, 1.7, 0], .5, 3.1);
      ctx.cylinder(group, band, [0, 1.05, 0], .52, .3);
      ctx.cylinder(group, band, [0, 2.3, 0], .52, .3);
      ctx.cylinder(group, parapet, [0, 3.17, 0], .74, .14);
      // Gallery railing: a ring rail on ten posts, plus lantern mullions and a
      // door at the tower base — all merged into one trim mesh.
      const beaconParts: THREE.BufferGeometry[] = [];
      beaconParts.push(colorize(new THREE.TorusGeometry(.8, .025, 6, 20).rotateX(Math.PI / 2), 0x5c6d75).translate(0, 3.36, 0));
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        beaconParts.push(colorize(new THREE.CylinderGeometry(.018, .018, .32, 5), 0x5c6d75).translate(Math.cos(a) * .78, 3.2, Math.sin(a) * .78));
      }
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4;
        beaconParts.push(colorize(new THREE.BoxGeometry(.03, .56, .03), 0x3a4448).translate(Math.cos(a) * .44, 3.5, Math.sin(a) * .44));
      }
      part(beaconParts, 0x252d31, .34, .62, .08, 0, .42, .5);
      part(beaconParts, 0x9aa39c, .42, .07, .1, 0, .76, .5);
      merged(group, trimMaterial, beaconParts);
      // Glazed lantern room around the (state-driven) lamp core.
      const lantern = plain(0x4a3a20, 0xffd9a0);
      lantern.emissiveIntensity = .05;
      beacon.lamp = lantern;
      ctx.cylinder(group, lantern, [0, 3.5, 0], .26, .5);
      const glazing = ctx.track(new THREE.MeshPhysicalMaterial({
        color: 0x9db8c4, roughness: .12, metalness: .1, transparent: true, opacity: .32,
        envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false,
      }));
      const glazingMesh = new THREE.Mesh(ctx.track(new THREE.CylinderGeometry(.44, .44, .56, 12, 1, true)), glazing);
      glazingMesh.position.set(0, 3.5, 0);
      group.add(glazingMesh);
      ctx.cylinder(group, parapet, [0, 3.86, 0], .64, .17);
      const beamGeometry = ctx.track(new THREE.ConeGeometry(1.9, 23, 12, 1, true));
      beamGeometry.rotateX(-Math.PI / 2); // apex at the lantern, widening outward (group scale makes it ~26 long)
      const beamMaterial = new THREE.MeshBasicMaterial({
        color: 0xffe0a8, transparent: true, opacity: .05, depthWrite: false,
        alphaMap: beamGradient(ctx), side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      softCone(beamMaterial, 3);
      ctx.track(beamMaterial);
      const pivot = new THREE.Group();
      pivot.position.set(0, 3.5, 0);
      const beam = new THREE.Mesh(beamGeometry, beamMaterial);
      beam.position.set(0, 0, 11.5);
      pivot.add(beam);
      pivot.visible = false;
      group.add(pivot);
      beacon.pivot = pivot;
    } else {
      const housing = id === 'housing-a' || id === 'housing-b';
      // Housing massing is stepped: a shorter main block + setback top storey,
      // keeping total height under HEIGHTS so markers stay above the roofline.
      const height = housing ? (id === 'housing-a' ? 2.9 : 3.3) : 1.55 * 1.35;
      const width = (id === 'depot' ? 3.1 : 2.75) * 1.15;
      const depth = 2.3;
      const walls = housing
        ? skin(id === 'housing-a' ? sets.brickRed : sets.brickBrown, 0xffffff, width / 1.2, height / 1.2, .85)
        : id === 'clinic'
          ? skin(sets.concrete, 0xd8d9cb, 1.6, 1.2, .75)
          : skin(sets.corrugated, 0x9aa8ab, 2, 1.4, .65, .3);
      // Static decoration merges into one vertex-coloured mesh per building.
      const trim: THREE.BufferGeometry[] = [];
      const t = (color: number, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void =>
        part(trim, color, w, h, d, x, y, z, ry);
      const pipe = (color: number, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z'): void => {
        const g = new THREE.CylinderGeometry(r, r, len, 8);
        if (axis === 'x') g.rotateZ(Math.PI / 2);
        if (axis === 'z') g.rotateX(Math.PI / 2);
        trim.push(colorize(g, color).translate(x, y, z));
      };
      const doorway = (dx: number, dz: number, canopy: boolean, fabric = 0x5c4f46, facing = 1): void => {
        t(0x252d31, .5, .92, .07, dx, .61, dz);
        t(0x9aa39c, .62, .08, .1, dx, 1.1, dz);
        if (canopy) {
          t(fabric, 1.05, .05, .6, dx, 1.2, dz + .3 * facing);
          for (const s of [-.45, .45]) t(0x4a555a, .05, .62, .05, dx + s, .85, dz + .55 * facing);
        }
      };
      ctx.box(group, concreteMat, [0, .07, 0], [width + .5, .14, depth + .6]);
      ctx.box(group, walls, [0, height / 2 + .14, 0], [width, height, depth]);
      ctx.box(group, roof, [0, height + .24, 0], [width + .2, .2, depth + .2]);
      ctx.box(group, parapet, [0, height + .4, depth / 2 + .1], [width + .2, .12, .08]);
      ctx.box(group, parapet, [0, height + .4, -depth / 2 - .1], [width + .2, .12, .08]);
      ctx.box(group, parapet, [width / 2 + .06, height + .4, 0], [.08, .12, depth + .2]);
      ctx.box(group, parapet, [-width / 2 - .06, height + .4, 0], [.08, .12, depth + .2]);
      // Cornice band just under the parapet lip, proud of the wall.
      for (const s of [-1, 1]) {
        t(0xb4bab0, width + .3, .09, .1, 0, height + .28, s * (depth / 2 + .03));
        t(0xb4bab0, .1, .09, depth + .3, s * (width / 2 + .03), height + .28, 0);
      }
      ctx.box(group, skin(sets.metalDark, 0x87949a, 1, 1, .6, .3), [.55, height + .51, -.4], [.65, .42, .55]);
      ctx.box(group, roof, [-.75, height + .48, .45], [.42, .38, .42]);
      // Rooftop clutter: vent pipes and a whip antenna.
      pipe(0x5c6d75, .06, .55, -.4, height + .56, -.6, 'y');
      pipe(0x5c6d75, .045, .4, .1, height + .5, .3, 'y');
      pipe(0x39454a, .018, 1.2, width / 2 - .35, height + .9, -depth / 2 + .4, 'y');
      t(0x39454a, .3, .02, .02, width / 2 - .35, height + 1.3, -depth / 2 + .4);
      // Drainpipes down all four corners.
      for (const s of [-1, 1]) {
        pipe(0x46535a, .035, height + .15, s * (width / 2 - .14), .14 + (height + .15) / 2, depth / 2 + .07, 'y');
        pipe(0x46535a, .035, height + .15, s * (width / 2 - .14), .14 + (height + .15) / 2, -depth / 2 - .07, 'y');
      }
      const rows = housing ? 4 : id === 'clinic' ? 2 : 1;
      if (isService(id)) windowFace(id, width, depth, height, rows, 4, housing || id === 'clinic' ? 4 : 2, housing ? 4 : 3);
      if (housing) {
        const balcony = skin(sets.concrete, 0x8a8278, 1, .2, .8);
        for (let row = 0; row < rows; row++) {
          const y = .42 + (row + .5) * (height - .6) / rows;
          ctx.box(group, balcony, [-.35, y, depth / 2 + .14], [1.8, .05, .22]);
          ctx.box(group, balcony, [-.35, y + .2, depth / 2 + .24], [1.8, .04, .03]);
        }
        // Setback top storey (stepped massing) with its own cap and lit windows.
        const setW = width * .6, setD = depth * .55, setH = id === 'housing-a' ? .65 : .7;
        ctx.box(group, walls, [-.15, height + .34 + setH / 2, -.16 * depth], [setW, setH, setD]);
        t(0x6a7a80, setW + .16, .09, setD + .16, -.15, height + .38 + setH, -.16 * depth);
        const [bx, bz] = POSITIONS[id];
        const wy = .45 + height + .34 + setH * .55;
        const frontZ = bz - .16 * depth + setD / 2 + .017;
        const rearZ = bz - .16 * depth - setD / 2 - .017;
        for (let c = -1; c <= 1; c++) windows.addWindow(id, new THREE.Vector3(bx - .15 + c * .42, wy, frontZ), 0);
        for (const c of [-1, 1]) windows.addWindow(id, new THREE.Vector3(bx - .15 + c * .42, wy, rearZ), Math.PI);
        for (const dz of [-.2, .2]) windows.addWindow(id, new THREE.Vector3(bx - .15 + setW / 2 + .017, wy, bz - .16 * depth + dz), Math.PI / 2);
        for (const dz of [-.2, .2]) windows.addWindow(id, new THREE.Vector3(bx - .15 - setW / 2 - .017, wy, bz - .16 * depth + dz), -Math.PI / 2);
        // Roof water tank on legs.
        ctx.cylinder(group, concreteMat, [-.75, height + .78, -.45], .3, .55);
        for (const [lx, lz] of [[-.95, -.62], [-.55, -.62], [-.95, -.28], [-.55, -.28]] as const)
          t(0x55606a, .05, .35, .05, lx, height + .38, lz);
        doorway(.9, depth / 2 + .04, true, 0x6a5f52);
        // Rear service entrance with a small canopy, plus a meter box + conduit.
        doorway(-.9, -depth / 2 - .04, true, 0x4a555a, -1);
        t(0x46535a, .24, .34, .08, .75, .78, -depth / 2 - .05);
        pipe(0x46535a, .03, .6, .75, 1.2, -depth / 2 - .06, 'y');
      }
      if (id === 'clinic') {
        const cross = plain(0x2a3438, 0xd0453e);
        cross.emissiveIntensity = 0;
        clinic.cross = cross;
        // Entrance canopy with the lit cross standing on its fascia.
        doorway(0, depth / 2 + .04, false);
        t(0x8f979b, 1.5, .07, .7, 0, 1.22, depth / 2 + .38);
        for (const s of [-.62, .62]) t(0x8f979b, .06, .68, .06, s, .85, depth / 2 + .68);
        ctx.box(group, cross, [0, 1.45, depth / 2 + .75], [.5, .12, .06]);
        ctx.box(group, cross, [0, 1.45, depth / 2 + .75], [.12, .5, .06]);
        const generator = plain(0x33302a, 0xdfac60);
        generator.emissiveIntensity = .1;
        clinic.gen = generator;
        ctx.box(group, generator, [width / 2 + .35, .3, .5], [.55, .45, .7]);
        pipe(0x3a3a34, .045, .75, width / 2 + .35, .85, .25, 'y'); // exhaust stack
        t(0x1e2225, .4, .22, .03, width / 2 + .35, .32, .87);      // vent slats
        // Rear service door + utility meter and conduit riser.
        doorway(-.8, -depth / 2 - .04, false, 0x5c4f46, -1);
        t(0x46535a, .22, .3, .08, .85, .75, -depth / 2 - .05);
        pipe(0x46535a, .03, .55, .85, 1.15, -depth / 2 - .06, 'y');
      }
      if (id === 'pump') {
        const metal = skin(sets.metalPaint, 0x88979b, 1, 1, .45, .5);
        ctx.cylinder(group, metal, [1.9, .62, -.25], .53, 1.2);
        ctx.cylinder(group, concreteMat, [1.9, .62, .75], .32, .8);
        ctx.box(group, roof, [1.7, .28, 1.55], [.3, .3, 2.2]);
        // Pipework: run from the facade to the tank plus a riser.
        pipe(0x88979b, .06, 1.3, 1.2, .55, -.25, 'x');
        pipe(0x88979b, .05, .8, .6, .55, -.25, 'y');
        pipe(0x88979b, .05, .8, 1.55, .55, .75, 'y');
        doorway(-.6, depth / 2 + .04, true, 0x4a555a);
        // Rear louvered vent + conduit riser on the back wall.
        t(0x2c363b, .7, .5, .05, .4, 1.35, -depth / 2 - .04);
        t(0x46535a, .76, .05, .07, .4, 1.62, -depth / 2 - .05);
        pipe(0x88979b, .05, .9, -.9, .55, -depth / 2 - .07, 'y');
      }
      if (id === 'depot') {
        const door = skin(sets.corrugated, 0x6d7c82, 1.2, 1.2, .6, .35);
        ctx.box(group, door, [-.72, .72, depth / 2 + .04], [1.2, 1.2, .07]);
        ctx.box(group, door, [.72, .72, depth / 2 + .04], [1.2, 1.2, .07]);
        for (const x of [-.72, .72]) ctx.box(group, parapet, [x, .72, depth / 2 + .08], [.05, 1.1, .03]);
        // Low office annex on the west side + a personnel door by the bays.
        ctx.box(group, walls, [-width / 2 - .45, .82, -.3], [.9, 1.36, 1.7]);
        t(0x6a7a80, 1.04, .08, 1.84, -width / 2 - .45, 1.54, -.3);
        doorway(1.58, depth / 2 + .04, false);
        doorway(-width / 2 - .45, .61, true, 0x4a555a);
        // Rear wall: dark clerestory windows (unlit — the depot isn't a powered
        // service) and a rear personnel door so the north face isn't blank.
        for (const wx of [-.8, 0, .8]) {
          t(0x18242a, .55, .35, .05, wx, 1.45, -depth / 2 - .04);
          t(0x9aa39c, .61, .05, .07, wx, 1.65, -depth / 2 - .05);
        }
        doorway(-.95, -depth / 2 - .04, false, 0x4a555a, -1);
      }
      if (trim.length) merged(group, trimMaterial, trim);
    }
    const [x, z] = POSITIONS[id];
    group.position.set(x, .45, z);
    // Non-service structures (supply, substations, beacon) grow uniformly too.
    if (!isService(id) && id !== 'depot') group.scale.set(1.15, 1.35, 1.15);
    group.traverse(object => { object.userData.node = id; });
    world.add(group);
    nodes.set(id, group);
  };

  for (const id of Object.keys(POSITIONS) as NodeId[]) buildNode(id);
  windows.seal();

  return {
    nodes,
    windows,
    feederGlow,
    beaconPivot: beacon.pivot!,
    beaconLamp: beacon.lamp!,
    clinicCross: clinic.cross!,
    clinicGen: clinic.gen!,
    shoreWindows,
    wetMaterials,
  };
}
