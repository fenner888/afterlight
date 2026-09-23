import * as THREE from 'three';
import { SERVICE_IDS, FEEDER_IDS, isFeeder, isService } from '../scenario.ts';
import type { NodeId, ServiceId, FeederId } from '../scenario.ts';
import { POSITIONS } from './common.ts';
import type { SceneContext } from './common.ts';
import { asphalt, concrete, brick, corrugated, gravel, paintedMetal, wood, puddleRoughness, beamGradient, softCone } from './textures.ts';
import type { TextureSet } from './textures.ts';

export type ServiceLight = 'offline' | 'backup' | 'grid';

const WARM = new THREE.Color(0xffd28a).multiplyScalar(1.8);
const COOL = new THREE.Color(0xcfe3ff).multiplyScalar(1.55);
const AMBER = new THREE.Color(0xdfac60).multiplyScalar(1.7);
const OFF = new THREE.Color(0x141f26);

// One instanced quad per window across all service buildings; instanceColor drives
// the lit look (values > 1 feed bloom at night).
export class WindowLights {
  private mesh: THREE.InstancedMesh;
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
    this.onHash = new Float32Array(capacity);
    this.stagger = new Float32Array(capacity);
    this.tint = new Float32Array(capacity);
    ctx.world.add(this.mesh);
  }

  addWindow(service: ServiceId, position: THREE.Vector3, side: boolean): void {
    const index = this.cursor++;
    if (!this.ranges.has(service)) this.ranges.set(service, { start: index, count: 0 });
    this.ranges.get(service)!.count++;
    const matrix = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side ? Math.PI / 2 : 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.setColorAt(index, OFF);
    this.onHash[index] = this.rand();
    this.stagger[index] = this.rand();
    this.tint[index] = this.rand();
  }

  seal(): void { this.mesh.count = this.cursor; }

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
    ctx.box(world, curb, [0, .55, 9.2], [24.8, .38, .25]);
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

    // Sidewalks + curb lines, segmented so they never cross asphalt.
    for (const [x, w] of [[-10.5, 3.5], [0, 17.5], [10.5, 3.5]] as const) walk(x, .725, w, .5);
    for (const [x, w] of [[-10.5, 3.5], [-5.23, 7.05], [4.33, 8.85], [10.5, 3.5]] as const) walk(x, 2.875, w, .5);
    for (const x of [-9, -7, 7, 9]) {
      for (const [z, d] of [[-5.34, 5.325], [-.275, 2.5], [5.31, 5.375]] as const) walk(x, z, .5, d);
    }
    for (const z of [-2.925, -1.275]) walk(0, z, 13.4, .5);
    for (const x of [-1.85, .05]) for (const [z, d] of [[4.09, 2.93], [7.53, .95]] as const) walk(x, z, .5, d);
    for (const z of [5.35, 7.25]) walk(-3.73, z, 4.15, .5);
    for (const [x, w] of [[-10.5, 3.5], [0, 17.5], [10.5, 3.5]] as const) curbLine(x, .99, w, .08);
    for (const [x, w] of [[-10.5, 3.5], [-5.23, 7.05], [4.33, 8.85], [10.5, 3.5]] as const) curbLine(x, 2.61, w, .08);
    for (const x of [-8.79, -7.21, 7.21, 8.79]) for (const [z, d] of [[-5.34, 5.325], [-.275, 2.5], [5.31, 5.375]] as const) curbLine(x, z, .08, d);
    for (const z of [-2.66, -1.54]) curbLine(0, z, 13.4, .08);
    for (const x of [-1.56, -.24]) for (const [z, d] of [[4.09, 2.93], [7.53, .95]] as const) curbLine(x, z, .08, d);
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

  const buildQuay = (): void => {
    const wall = skin(sets.concrete, 0x5a685f, 4.2, .22, .9);
    ctx.box(world, wall, [0, -.2, 9.65], [25.2, 1.3, .8]);
    // Darker wet band near the water line.
    ctx.box(world, plain(0x35423e), [0, -.62, 10.06], [25.2, .45, .02]);
    ctx.box(world, skin(sets.concrete, 0x6a766d, 4.2, .17, .9), [0, .52, 9.6], [25.4, .1, 1]);
    const plank = skin(sets.wood, 0xa89880, 1, 2, .85);
    const post = plain(0x3a332b);
    ctx.box(world, plank, [-9.3, .16, 11.6], [1.7, .14, 4.4]);
    for (const [px, pz] of [[-10, 9.8], [-8.6, 9.8], [-10, 13.4], [-8.6, 13.4]] as const)
      ctx.cylinder(world, post, [px, -.35, pz], .09, 1.15);
    const bollard = skin(sets.metalDark, 0x8b979b, 1, 1, .5, .4);
    for (const bx of [-11, -10, -8.2, -7.4]) ctx.cylinder(world, bollard, [bx, .58, 9.12], .09, .3);
    for (const [bx, bz, turn] of [[-7.6, 12.3, -.35], [-11.6, 13.6, .5]] as const) {
      const boat = new THREE.Group();
      ctx.box(boat, skin(sets.wood, 0x7c5648, 1, 1, .8), [0, .3, 0], [1.7, .55, .75]);
      ctx.box(boat, plain(0x46322b), [0, .62, 0], [1.3, .12, .55]);
      ctx.box(boat, skin(sets.metalPaint, 0x8d8276, 1, 1, .6), [.15, .8, 0], [.55, .3, .45]);
      ctx.cylinder(boat, post, [-.3, 1.5, 0], .04, 1.9);
      boat.position.set(bx, -.78, bz);
      boat.rotation.y = turn;
      world.add(boat);
    }
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
    const canopyGeometry = ctx.track(new THREE.ConeGeometry(.55, 1.5, 8));
    const trunks = new THREE.InstancedMesh(trunkGeometry, skin(sets.wood, 0x6b6152, 1, 1, .9), trees.length);
    const canopies = new THREE.InstancedMesh(canopyGeometry, plain(0x3c5748), trees.length);
    const matrix = new THREE.Matrix4();
    trees.forEach(([x, z, size], index) => {
      matrix.makeScale(size, size, size).setPosition(x, .42 + .5 * size, z);
      trunks.setMatrixAt(index, matrix);
      matrix.makeScale(size, size, size).setPosition(x, .42 + 1.65 * size, z);
      canopies.setMatrixAt(index, matrix);
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
  buildWetDetails();
  buildLinePoles();
  buildDetails();

  // Instanced windows across all service buildings.
  const windows = new WindowLights(ctx, 96);
  const windowFace = (id: ServiceId, width: number, depth: number, height: number, rows: number, frontCols: number, sideCols: number): void => {
    const [bx, bz] = POSITIONS[id];
    const rowY = (row: number): number => .45 + .14 + .55 + (row + .5) * (height - .9) / rows;
    for (let row = 0; row < rows; row++) for (let col = 0; col < frontCols; col++) {
      const x = bx + (col - (frontCols - 1) / 2) * ((width - .8) / Math.max(1, frontCols - 1));
      windows.addWindow(id, new THREE.Vector3(x, rowY(row), bz + depth / 2 + .017), false);
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < sideCols; col++) {
      const z = bz + (col - (sideCols - 1) / 2) * ((depth - .8) / Math.max(1, sideCols - 1));
      windows.addWindow(id, new THREE.Vector3(bx + width / 2 + .017, rowY(row), z), true);
    }
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
      const lantern = plain(0x4a3a20, 0xffd9a0);
      lantern.emissiveIntensity = .05;
      beacon.lamp = lantern;
      ctx.cylinder(group, lantern, [0, 3.5, 0], .4, .52);
      ctx.cylinder(group, parapet, [0, 3.86, 0], .64, .17);
      const beamGeometry = ctx.track(new THREE.ConeGeometry(1.9, 23, 12, 1, true));
      beamGeometry.rotateX(-Math.PI / 2); // apex at the lantern, widening outward (group scale makes it ~26 long)
      const beamMaterial = new THREE.MeshBasicMaterial({
        color: 0xffe0a8, transparent: true, opacity: .07, depthWrite: false,
        alphaMap: beamGradient(ctx), side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      softCone(beamMaterial);
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
      const height = (housing ? (id === 'housing-a' ? 2.7 : 3.1) : 1.55) * 1.35;
      const width = (id === 'depot' ? 3.1 : 2.75) * 1.15;
      const depth = 2.3;
      const walls = housing
        ? skin(id === 'housing-a' ? sets.brickRed : sets.brickBrown, 0xffffff, width / 1.2, height / 1.2, .85)
        : id === 'clinic'
          ? skin(sets.concrete, 0xd8d9cb, 1.6, 1.2, .75)
          : skin(sets.corrugated, 0x9aa8ab, 2, 1.4, .65, .3);
      ctx.box(group, concreteMat, [0, .07, 0], [width + .5, .14, depth + .6]);
      ctx.box(group, walls, [0, height / 2 + .14, 0], [width, height, depth]);
      ctx.box(group, roof, [0, height + .24, 0], [width + .2, .2, depth + .2]);
      ctx.box(group, parapet, [0, height + .4, depth / 2 + .1], [width + .2, .12, .08]);
      ctx.box(group, parapet, [0, height + .4, -depth / 2 - .1], [width + .2, .12, .08]);
      ctx.box(group, parapet, [width / 2 + .06, height + .4, 0], [.08, .12, depth + .2]);
      ctx.box(group, parapet, [-width / 2 - .06, height + .4, 0], [.08, .12, depth + .2]);
      ctx.box(group, skin(sets.metalDark, 0x87949a, 1, 1, .6, .3), [.55, height + .51, -.4], [.65, .42, .55]);
      ctx.box(group, roof, [-.75, height + .48, .45], [.42, .38, .42]);
      ctx.box(group, skin(sets.metalDark, 0x3a4a50, 1, 1, .5, .4), [.72, .62, depth / 2 + .01], [.42, .96, .05]);
      const rows = housing ? 4 : id === 'clinic' ? 2 : 1;
      if (isService(id)) windowFace(id, width, depth, height, rows, 4, housing || id === 'clinic' ? 4 : 2);
      if (housing) {
        const balcony = skin(sets.concrete, 0x8a8278, 1, .2, .8);
        for (let row = 0; row < rows; row++) {
          const y = .42 + (row + .5) * (height - .6) / rows;
          ctx.box(group, balcony, [-.35, y, depth / 2 + .14], [1.8, .05, .22]);
          ctx.box(group, balcony, [-.35, y + .2, depth / 2 + .24], [1.8, .04, .03]);
        }
        ctx.cylinder(group, concreteMat, [-.75, height + .68, -.45], .3, .55);
      }
      if (id === 'clinic') {
        const cross = plain(0x2a3438, 0xd0453e);
        cross.emissiveIntensity = 0;
        clinic.cross = cross;
        ctx.box(group, cross, [-.75, height + .55, 0], [.6, .16, .16]);
        ctx.box(group, cross, [-.75, height + .55, 0], [.16, .6, .16]);
        const generator = plain(0x33302a, 0xdfac60);
        generator.emissiveIntensity = .1;
        clinic.gen = generator;
        ctx.box(group, generator, [width / 2 + .35, .3, .5], [.55, .45, .7]);
      }
      if (id === 'pump') {
        const metal = skin(sets.metalPaint, 0x88979b, 1, 1, .45, .5);
        ctx.cylinder(group, metal, [1.9, .62, -.25], .53, 1.2);
        ctx.cylinder(group, concreteMat, [1.9, .62, .75], .32, .8);
        ctx.box(group, roof, [1.7, .28, 1.55], [.3, .3, 2.2]);
      }
      if (id === 'depot') {
        const door = skin(sets.corrugated, 0x6d7c82, 1.2, 1.2, .6, .35);
        ctx.box(group, door, [-.72, .72, depth / 2 + .04], [1.2, 1.2, .07]);
        ctx.box(group, door, [.72, .72, depth / 2 + .04], [1.2, 1.2, .07]);
        for (const x of [-.72, .72]) ctx.box(group, parapet, [x, .72, depth / 2 + .08], [.05, 1.1, .03]);
      }
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
    wetMaterials,
  };
}
