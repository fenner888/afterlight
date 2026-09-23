import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CREW_IDS } from '../scenario.ts';
import type { CrewId, FeederId } from '../scenario.ts';
import type { State } from '../domain.ts';
import { POSITIONS } from './common.ts';
import type { SceneContext } from './common.ts';
import { paintedMetal, corrugated, chevrons, poolGradient, softCone } from './textures.ts';
import type { SceneLights } from './lights.ts';
import { depotBay, parkPose, routeFor, routeLength, Traffic } from './traffic.ts';
import type { Point, TruckInput } from './traffic.ts';

// Utility bucket trucks replacing the old box vans. Truck local space: +x is the
// nose, origin at ground level. Spec dims: length 1.9, width .78, cab .78 tall,
// crew box 1.0 tall, wheel radius .17.
const CREW_PAINT = [0xd9d2bd, 0x5f8284] as const; // crew-1 pale cream, crew-2 muted teal
const STRIPE = 0xdfac60;
const WHEEL_Y = .17;
const WHEEL_SLOTS: [number, number][] = [[.62, -.33], [.62, .33], [-.28, -.33], [-.28, .33], [-.62, -.33], [-.62, .33]];
const FOLDED_LOWER = .04; // nearly flat along the roof, pointing forward
const RAISED_LOWER = THREE.MathUtils.degToRad(68);
const FOLDED_ELBOW = Math.PI * .96; // upper arm folded back over the lower
const RAISED_ELBOW = THREE.MathUtils.degToRad(-20);

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// Flat colour baked into a `color` attribute so whole assemblies merge into one
// vertex-coloured mesh per material class.
const colorize = (g: THREE.BufferGeometry, color: number): THREE.BufferGeometry => {
  const c = new THREE.Color(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
};
const part = (list: THREE.BufferGeometry[], color: number, w: number, h: number, d: number, x: number, y: number, z: number): void => {
  const g = new THREE.BoxGeometry(w, h, d);
  colorize(g, color).translate(x, y, z);
  list.push(g);
};

interface Truck {
  root: THREE.Group;
  body: THREE.Group;
  headlightMounts: THREE.Object3D[];
  tyres: THREE.InstancedMesh;
  rims: THREE.InstancedMesh;
  pivot: THREE.Group;
  lower: THREE.Group;
  elbow: THREE.Group;
  bucket: THREE.Group;
  outriggers: THREE.Mesh[];
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  strobe: THREE.MeshStandardMaterial;
  chevron: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  workSpot: THREE.SpotLight;
  workPool: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  workCone: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  flash: THREE.Sprite;
  site: FeederId | null;
  boom: number;
  distance: number;
  prev: THREE.Vector3 | null;
  headingLag: number;
  headingNow: number | null;
  routeKey: string;
  route: Point[] | null;
  routeLen: number;
}

export class Fleet {
  private trucks = new Map<CrewId, Truck>();
  private traffic = new Traffic();
  private dummy = new THREE.Object3D();

  constructor(private ctx: SceneContext, lights: SceneLights) {
    for (const [index, id] of CREW_IDS.entries()) {
      const truck = this.buildTruck(index);
      lights.attachVan(truck.headlightMounts);
      this.trucks.set(id, truck);
      ctx.world.add(truck.root);
    }
    this.buildParkedCars();
    this.buildBoats();
  }

  private buildTruck(index: number): Truck {
    const ctx = this.ctx;
    const paint = CREW_PAINT[index]!;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    // Painted clearcoat body: cab, crew box, amber stripe — one merged mesh.
    const bodyParts: THREE.BufferGeometry[] = [];
    part(bodyParts, paint, .5, .78, .74, .7, .69, 0);        // cab
    part(bodyParts, paint, 1.3, 1.0, .76, -.3, .87, 0);      // crew box
    part(bodyParts, STRIPE, 1.32, .13, .78, -.3, .6, 0);     // amber band
    part(bodyParts, paint, .06, .12, .7, .96, .98, 0);       // cab brow above the windscreen
    const bodyGeometry = ctx.track(mergeGeometries(bodyParts)!);
    bodyParts.forEach(g => g.dispose());
    const bodyMaterial = ctx.track(new THREE.MeshPhysicalMaterial({
      map: paintedMetal(ctx, '#ffffff').map, vertexColors: true,
      roughness: .45, metalness: .1, clearcoat: .6, clearcoatRoughness: .25, envMapIntensity: .8,
    }));
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.castShadow = true;
    body.add(bodyMesh);

    // Matte dark parts: chassis, wheel wells, bumpers, mirrors, rack, turntable.
    const darkParts: THREE.BufferGeometry[] = [];
    const dark = 0x22282c;
    part(darkParts, dark, 1.78, .14, .62, -.02, .3, 0);            // chassis
    part(darkParts, 0x151a1d, .42, .2, .68, .62, .27, 0);          // front wheel well
    part(darkParts, 0x151a1d, .85, .2, .68, -.45, .27, 0);         // rear wheel well
    part(darkParts, dark, .08, .14, .74, .97, .24, 0);             // front bumper
    part(darkParts, dark, .1, .14, .78, -.94, .24, 0);             // rear bumper
    for (const z of [-.4, .4]) {
      part(darkParts, dark, .1, .025, .025, .93, .78, z);          // mirror arms
      part(darkParts, dark, .025, .15, .1, .97, .85, z * 1.12);    // mirror heads
    }
    for (const z of [-.29, .29]) part(darkParts, dark, 1.15, .035, .035, -.3, 1.415, z); // rack rails
    for (let i = 0; i < 6; i++) part(darkParts, dark, .035, .035, .58, -.78 + i * .19, 1.44, 0);   // rungs
    part(darkParts, dark, .42, .06, .52, .7, 1.11, 0);             // light-bar housing
    part(darkParts, 0x4d575b, .3, .22, .3, .1, .22, -.26);         // side toolbox
    const turntable = new THREE.CylinderGeometry(.11, .12, .05, 10);
    turntable.translate(-.82, 1.42, 0);
    const turntableColors = new Float32Array(turntable.getAttribute('position').count * 3);
    const darkC = new THREE.Color(dark);
    for (let i = 0; i < turntableColors.length; i += 3) turntableColors.set([darkC.r, darkC.g, darkC.b], i);
    turntable.setAttribute('color', new THREE.BufferAttribute(turntableColors, 3));
    darkParts.push(turntable);
    const darkGeometry = ctx.track(mergeGeometries(darkParts)!);
    darkParts.forEach(g => g.dispose());
    const darkMaterial = ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: .05, envMapIntensity: .5 }));
    const darkMesh = new THREE.Mesh(darkGeometry, darkMaterial);
    darkMesh.castShadow = true;
    body.add(darkMesh);

    // Tinted glass: windscreen + cab side windows, slightly inset.
    const glassParts: THREE.BufferGeometry[] = [];
    part(glassParts, 0xffffff, .03, .3, .58, .936, .86, 0);
    for (const z of [-.365, .365]) part(glassParts, 0xffffff, .28, .24, .02, .72, .9, z);
    const glassGeometry = ctx.track(mergeGeometries(glassParts)!);
    glassParts.forEach(g => g.dispose());
    const glassMaterial = ctx.track(new THREE.MeshPhysicalMaterial({
      color: 0x1a2430, roughness: .1, metalness: .2, transmission: 0, envMapIntensity: 1.2,
    }));
    body.add(new THREE.Mesh(glassGeometry, glassMaterial));

    // Emissive fittings: headlights, tail lights, amber light bar (strobe).
    const head = ctx.track(new THREE.MeshStandardMaterial({ color: 0x2e2c24, emissive: 0xf5e9c8, emissiveIntensity: .2 }));
    const tail = ctx.track(new THREE.MeshStandardMaterial({ color: 0x381d19, emissive: 0xd8543c, emissiveIntensity: .12 }));
    const strobe = ctx.track(new THREE.MeshStandardMaterial({ color: 0x4a3517, emissive: STRIPE, emissiveIntensity: .12 }));
    const headGeometry = ctx.track(mergeGeometries([.22, -.22].map(z => new THREE.BoxGeometry(.04, .1, .13).translate(.965, .42, z)))!);
    const tailGeometry = ctx.track(mergeGeometries([.3, -.3].map(z => new THREE.BoxGeometry(.03, .09, .11).translate(-.962, .42, z)))!);
    const strobeGeometry = ctx.track(new THREE.BoxGeometry(.36, .05, .46));
    const strobeMesh = new THREE.Mesh(strobeGeometry, strobe);
    strobeMesh.position.set(.7, 1.165, 0);
    body.add(new THREE.Mesh(headGeometry, head), new THREE.Mesh(tailGeometry, tail), strobeMesh);
    const headlightMounts = [.22, -.22].map(z => {
      const mount = new THREE.Object3D();
      mount.position.set(.98, .42, z);
      body.add(mount);
      return mount;
    });

    // Rear: ribbed roll-up door (corrugated normal, rotated for horizontal ribs)
    // above a reflective chevron panel.
    const doorNormal = ctx.track(corrugated(ctx).normalMap!.clone());
    doorNormal.center.set(.5, .5);
    doorNormal.rotation = Math.PI / 2;
    doorNormal.repeat.set(1, 3);
    doorNormal.needsUpdate = true;
    const doorMaterial = ctx.track(new THREE.MeshStandardMaterial({ color: paint, normalMap: doorNormal, roughness: .5, metalness: .15, envMapIntensity: .6 }));
    const door = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(.02, .62, .6)), doorMaterial);
    door.position.set(-.956, .98, 0);
    const chevronTexture = chevrons(ctx);
    chevronTexture.repeat.set(2, 1);
    const chevronMaterial = ctx.track(new THREE.MeshStandardMaterial({
      map: chevronTexture, emissiveMap: chevronTexture, emissive: 0x9a9a9a, emissiveIntensity: .35, roughness: .5,
    }));
    const chevron = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(.02, .3, .72)), chevronMaterial);
    chevron.position.set(-.958, .55, 0);
    body.add(door, chevron);

    // Six wheels: one InstancedMesh for tyres, one for rims (a spoke makes the
    // rotation readable). Matrices are rewritten per frame while rolling.
    const tyreGeometry = ctx.track(new THREE.CylinderGeometry(.17, .17, .12, 14).rotateX(Math.PI / 2));
    const rimGeometry = ctx.track(mergeGeometries([
      new THREE.CylinderGeometry(.095, .095, .135, 10).rotateX(Math.PI / 2),
      new THREE.BoxGeometry(.16, .03, .14),
    ])!);
    const tyreMaterial = ctx.track(new THREE.MeshStandardMaterial({ color: 0x1d2327, roughness: .95, metalness: 0, envMapIntensity: .4 }));
    const rimMaterial = ctx.track(new THREE.MeshStandardMaterial({ color: 0x8f979b, roughness: .5, metalness: .4, envMapIntensity: .7 }));
    const tyres = new THREE.InstancedMesh(tyreGeometry, tyreMaterial, 6);
    const rims = new THREE.InstancedMesh(rimGeometry, rimMaterial, 6);
    tyres.castShadow = true;
    root.add(tyres, rims);

    // Boom on a turntable at the rear of the box roof; arms and bucket animate.
    // Safety orange reads against the night palette at default zoom.
    const armMaterial = ctx.track(new THREE.MeshPhysicalMaterial({
      color: 0xe0722a, roughness: .45, metalness: .1,
      clearcoat: .6, clearcoatRoughness: .25, envMapIntensity: .8,
    }));
    const pivot = new THREE.Group();
    pivot.position.set(-.82, 1.47, 0);
    const lower = new THREE.Group();
    const lowerArm = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(.95, .11, .11)), armMaterial);
    lowerArm.position.x = .475;
    lowerArm.castShadow = true;
    lower.add(lowerArm);
    const elbow = new THREE.Group();
    elbow.position.x = .95;
    const upperArm = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(.8, .09, .09)), armMaterial);
    upperArm.position.set(.4, .07, 0);
    upperArm.castShadow = true;
    elbow.add(upperArm);
    const bucket = new THREE.Group();
    bucket.position.set(.8, .07, 0);
    const bucketParts: THREE.BufferGeometry[] = [];
    const orange = 0xe0722a, bucketIn = 0xd8d2c4;
    part(bucketParts, orange, .3, .03, .3, 0, .06, 0);               // floor
    for (const z of [-.135, .135]) part(bucketParts, orange, .3, .25, .03, 0, .2, z);
    for (const x of [-.135, .135]) part(bucketParts, orange, .03, .25, .3, x, .2, 0);
    part(bucketParts, bucketIn, .24, .01, .24, 0, .08, 0);           // pale interior
    const bucketMaterial = ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .15, envMapIntensity: .7 }));
    const bucketMesh = new THREE.Mesh(ctx.track(mergeGeometries(bucketParts)!), bucketMaterial);
    bucketParts.forEach(g => g.dispose());
    bucketMesh.castShadow = true;
    bucket.add(bucketMesh);
    // Work lamp on the bucket lip — pops at night once the boom is up.
    const lamp = ctx.track(new THREE.MeshStandardMaterial({ color: 0x3a352b, emissive: 0xffe6b0, emissiveIntensity: 0 }));
    const lampMesh = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(.1, .04, .04)), lamp);
    lampMesh.position.set(.1, .34, 0);
    bucket.add(lampMesh);
    // Work light: a spot firing down into the yard plus a soft volumetric cone
    // under the bucket — the "crew working here" signal at default zoom. The
    // bucket group is level-compensated, so local -y stays world-down.
    const workSpot = new THREE.SpotLight(0xffe2b0, 0, 7, .6, .6);
    workSpot.castShadow = false;
    workSpot.position.set(0, .12, 0);
    const workTarget = new THREE.Object3D();
    workTarget.position.set(0, -2.6, 0);
    workSpot.target = workTarget;
    const workConeMaterial = ctx.track(new THREE.MeshBasicMaterial({
      color: 0xffe2b0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    softCone(workConeMaterial);
    const workCone = new THREE.Mesh(ctx.track(new THREE.ConeGeometry(1.15, 2.5, 12, 1, true)), workConeMaterial);
    workCone.position.set(0, -1.25, 0);
    bucket.add(workSpot, workTarget, workCone);
    elbow.add(bucket);
    lower.add(elbow);
    pivot.add(lower);
    body.add(pivot);

    // Warm additive pool spread over the substation yard while the boom is up;
    // in world space so it sits on the transformer regardless of truck pose.
    const workPoolMaterial = ctx.track(new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0,
      alphaMap: poolGradient(ctx), blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const workPool = new THREE.Mesh(ctx.track(new THREE.CircleGeometry(2.6, 24).rotateX(-Math.PI / 2)), workPoolMaterial);
    workPool.visible = false;
    ctx.world.add(workPool);

    // Amber flare above the light bar so the strobe reads at distance.
    const flashMaterial = ctx.track(new THREE.SpriteMaterial({
      map: poolGradient(ctx), color: 0xffbf6a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(.9);
    flash.position.set(.7, 1.45, 0);
    body.add(flash);

    // Four outriggers slide out sideways as the boom rises.
    const outriggers: THREE.Mesh[] = [];
    for (const x of [.55, -.72]) for (const z of [-1, 1]) {
      const leg = new THREE.Mesh(ctx.track(new THREE.BoxGeometry(.12, .07, .4)), darkMaterial);
      leg.position.set(x, .26, z * .28);
      leg.castShadow = true;
      outriggers.push(leg);
      body.add(leg);
    }

    return {
      root, body, headlightMounts, tyres, rims, pivot, lower, elbow, bucket, outriggers,
      head, tail, strobe, chevron: chevronMaterial, lamp,
      workSpot, workPool, workCone, flash, site: null,
      boom: 0, distance: 0, prev: null, headingLag: 0, headingNow: null,
      routeKey: '', route: null, routeLen: 0,
    };
  }

  // Kerb-parked civilian cars: sedan and hatchback silhouettes with glass and a
  // wet-night clearcoat sheen. Static, unlit, merged into one draw call.
  private buildParkedCars(): void {
    const parts: THREE.BufferGeometry[] = [];
    const colors = [0x5a6a6e, 0x7a6f66, 0x40484e, 0x6b7a85, 0x8a8078, 0x4f5a5f];
    const dark = 0x1c2226, glass = 0x1a2430;
    // [x, z, heading, sedan] — kerb spots kept clear of every traffic route's
    // footprint (the link road is too narrow for kerb parking + passing trucks,
    // so those two sit on the west road and the main road's east stretch).
    const spots: [number, number, number, boolean][] = [
      [-10.7, 1.32, 0, false], [10.7, 2.28, Math.PI, true],
      [-8.48, -6.6, Math.PI / 2, false], [8.48, -6.9, -Math.PI / 2, true],
      [-8.48, -4.8, Math.PI / 2, false], [1.8, 1.25, 0, true],
    ];
    spots.forEach(([x, z, heading, sedan], i) => {
      const local: THREE.BufferGeometry[] = [];
      const c = colors[i]!;
      if (sedan) {
        // Three-box profile: low hood, upright cabin, separate trunk.
        part(local, c, 1.2, .2, .5, 0, .28, 0);
        part(local, c, .38, .13, .46, .41, .4, 0);
        part(local, c, .5, .22, .44, -.03, .49, 0);
        part(local, c, .3, .15, .46, -.43, .4, 0);
        part(local, glass, .52, .12, .46, -.03, .51, 0);
      } else {
        // Hatchback: shorter nose, cabin glass slopes into the tailgate.
        part(local, c, 1.02, .24, .48, 0, .3, 0);
        const cabin = new THREE.BoxGeometry(.56, .22, .44);
        cabin.rotateZ(-.22);
        local.push(colorize(cabin, c).translate(-.12, .5, 0));
        const hatchGlass = new THREE.BoxGeometry(.54, .12, .45);
        hatchGlass.rotateZ(-.22);
        local.push(colorize(hatchGlass, glass).translate(-.12, .52, 0));
      }
      part(local, dark, .98, .1, .42, 0, .13, 0); // sill shadow / tyre gap
      for (const wx of [-.34, .34]) for (const wz of [-.23, .23]) {
        const wheel = new THREE.CylinderGeometry(.1, .1, .07, 10).rotateX(Math.PI / 2);
        local.push(colorize(wheel, dark).translate(wx, .1, wz));
        local.push(colorize(new THREE.CylinderGeometry(.05, .05, .075, 8).rotateX(Math.PI / 2), 0x6b7276).translate(wx, .1, wz));
      }
      const car = mergeGeometries(local)!;
      local.forEach(g => g.dispose());
      car.rotateY(heading);
      car.translate(x, .46, z);
      parts.push(car);
    });
    const geometry = this.ctx.track(mergeGeometries(parts)!);
    parts.forEach(g => g.dispose());
    const material = this.ctx.track(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: .38, metalness: .12,
      clearcoat: .55, clearcoatRoughness: .2, envMapIntensity: 1,
    }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    this.ctx.world.add(mesh);
  }

  private boats: { root: THREE.Group; base: number; phase: number }[] = [];

  // Pointed-bow hull via a plan-shape extrusion; the bevel tapers the outline
  // below the waterline and rounds the gunwale.
  private hull(L: number, W: number, D: number): THREE.BufferGeometry {
    const s = new THREE.Shape();
    s.moveTo(-L / 2, -W / 2);
    s.lineTo(L * .12, -W / 2);
    s.quadraticCurveTo(L * .42, -W * .3, L / 2, 0);
    s.quadraticCurveTo(L * .42, W * .3, L * .12, W / 2);
    s.lineTo(-L / 2, W / 2);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: true, bevelThickness: .13, bevelSize: -.07, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2); // extrusion axis -> up; shape (x = length, y = beam)
    return g;
  }

  // Moored boats: shaped hull, rub rail, wheelhouse with windows, mast + light,
  // mooring lines to the quay bollards. Gentle bob, off under reduced motion.
  private buildBoats(): void {
    const ctx = this.ctx;
    const hullMaterial = ctx.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: .12, envMapIntensity: .7 }));
    const lampMaterial = ctx.track(new THREE.MeshStandardMaterial({ color: 0x3a352b, emissive: 0xffc98a, emissiveIntensity: 1.4 }));
    const lampGeometry = ctx.track(new THREE.SphereGeometry(.045, 8, 6));
    const bollards: [number, number][] = [[-11, 9.12], [-10, 9.12], [-8.2, 9.12], [-7.4, 9.12]];
    // [x, z, heading, length, beam, wheelhouse]
    const spots: [number, number, number, number, number, boolean][] = [
      [-8.25, 12.2, .12, 2.4, .92, true],   // delivery boat alongside the pier
      [-6.1, 12.9, -.28, 1.9, .74, true],   // small fishing boat
      [-11.6, 13.6, .5, 1.9, .74, false],   // open boat
    ];
    spots.forEach(([bx, bz, heading, L, W, wheelhouse], i) => {
      const root = new THREE.Group();
      const local: THREE.BufferGeometry[] = [];
      const paint = [0x51606a, 0x5e5648, 0x4a5a58][i]!;
      local.push(colorize(this.hull(L, W, .34), paint).translate(0, -.16, 0));
      // Deck and gunwale rub rail.
      part(local, 0x3c464d, L * .82, .05, W * .82, -L * .04, .3, 0);
      for (const s of [-1, 1]) part(local, 0x2b3236, L * .62, .05, .05, -L * .08, .36, s * (W / 2 - .03));
      part(local, 0x2b3236, .1, .05, W * .5, L * .36, .36, 0);
      if (wheelhouse) {
        part(local, 0x7d8a90, .55, .42, .55, -L * .18, .55, 0);
        part(local, 0x1a2430, .57, .14, .57, -L * .18, .6, 0); // window band
        part(local, 0x3c464d, .6, .05, .6, -L * .18, .8, 0);
      } else {
        part(local, 0x46525a, .4, .12, .5, -L * .2, .38, 0);   // thwart / seat
      }
      // Mast with a small light.
      local.push(colorize(new THREE.CylinderGeometry(.03, .04, 1.1, 6), 0x39454a).translate(L * .18, .85, 0));
      local.push(colorize(new THREE.BoxGeometry(.3, .03, .03), 0x39454a).translate(L * .18, 1.2, 0));
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position.set(L * .18, 1.36, 0);
      root.add(lamp);
      // Mooring line from the bow cleat to the nearest quay bollard.
      let best: [number, number] = bollards[0]!, bd = Infinity;
      for (const b of bollards) {
        const d = (b[0] - bx) ** 2 + (b[1] - bz) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
      const cleatLocal = new THREE.Vector3(-L * .42, .34, 0);
      const worldFrom = cleatLocal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(new THREE.Vector3(bx, 0, bz));
      const worldTo = new THREE.Vector3(best[0], .6, best[1]);
      const dir = worldTo.clone().sub(worldFrom);
      const ropeLen = dir.length();
      const rope = new THREE.CylinderGeometry(.015, .015, ropeLen, 5);
      rope.translate(0, ropeLen / 2, 0);
      rope.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
      rope.translate(worldFrom.x, worldFrom.y, worldFrom.z);             // now world-space
      // World-space rope -> boat-local so it bobs with the hull.
      rope.applyMatrix4(new THREE.Matrix4().makeRotationY(-heading).multiply(new THREE.Matrix4().makeTranslation(-bx, .58, -bz)));
      local.push(colorize(rope, 0x4a4038));
      // ExtrudeGeometry is non-indexed; normalize everything before merging.
      const normalized = local.map(g => (g.index ? g.toNonIndexed() : g));
      const geometry = ctx.track(mergeGeometries(normalized)!);
      normalized.forEach(g => g.dispose());
      local.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(geometry, hullMaterial);
      mesh.castShadow = true;
      root.add(mesh);
      root.position.set(bx, -.58, bz);
      root.rotation.y = heading;
      ctx.world.add(root);
      this.boats.push({ root, base: -.58, phase: i * 2.1 });
    });
  }

  // True while a raised boom is over this feeder's yard — used to keep the
  // transformer spark shower livelier under an active crew.
  workingAt(feeder: FeederId): boolean {
    for (const truck of this.trucks.values()) if (truck.site === feeder) return true;
    return false;
  }

  // Per-frame presentation update. The pure Traffic module owns routes, lane
  // offsets, the shown-vs-schedule distance chase and yield holds; this method
  // poses the three.js truck and keeps wheels/suspension/boom/lights.
  // `tickRate` is the selected sim speed (ticks per real second); `review`
  // forces snapped poses for replay/scrubbing.
  update(state: State, fraction: number, now: number, dt: number, nightness: number, tickRate = 10, review = false): void {
    const reduced = this.ctx.reduced.matches;
    // Moored boats: gentle bob + roll, pinned flat under reduced motion.
    for (const boat of this.boats) {
      boat.root.position.y = boat.base + (reduced ? 0 : Math.sin(now * .8 + boat.phase) * .035);
      boat.root.rotation.z = reduced ? 0 : Math.sin(now * .55 + boat.phase * 1.3) * .018;
    }
    const snap = reduced || review;
    const inputs: TruckInput[] = CREW_IDS.map((id, index) => {
      const crew = state.crews[id];
      const truck = this.trucks.get(id)!;
      if (crew.phase !== 'idle' && crew.target !== null) {
        // En route or doing the post-arrival catch-up drive: keep the route
        // until the truck is visually parked at the feeder.
        const key = `${crew.origin}>${crew.target}@${crew.departedAt}`;
        if (truck.routeKey !== key) {
          truck.routeKey = key;
          truck.route = routeFor(index as 0 | 1, crew.origin, crew.target);
          truck.routeLen = routeLength(truck.route);
        }
        const trip = Math.max(1, crew.arriveAt - crew.departedAt);
        const progress = crew.phase === 'repairing'
          ? 1
          : Math.min(1, Math.max(0, (state.tick + (reduced ? 0 : fraction) - crew.departedAt) / trip));
        return {
          route: truck.route,
          scheduleDistance: progress * truck.routeLen,
          nominalSpeed: truck.routeLen * tickRate / trip,
          priority: crew.departedAt * 2 + index, // earlier departure wins; tie -> crew-1
          snap,
          parked: null,
        };
      }
      truck.routeKey = '';
      truck.route = null;
      return {
        route: null,
        scheduleDistance: 0,
        nominalSpeed: 0,
        priority: index,
        snap,
        // At a feeder kerb the last route-end pose already matches PARK;
        // passing null keeps it, so no heading snap on the idle transition.
        // Under snap conditions (replay/reduced) a canonical pose is supplied
        // so scrubbing never reuses a stale pose from another point in time.
        parked: crew.location === 'depot' ? depotBay(index as 0 | 1) : snap ? parkPose(crew.location) : null,
      };
    });
    const poses = this.traffic.step(inputs, dt);
    for (const [index, id] of CREW_IDS.entries()) {
      const crew = state.crews[id];
      const truck = this.trucks.get(id)!;
      const pose = poses[index]!;
      const moving = this.traffic.moving(index);
      const parked = this.traffic.parked(index);
      truck.root.position.set(pose.x, .48, pose.z);
      const heading = pose.heading;
      // Display heading eases toward the route heading so pull-outs and corner
      // turns read as steering rather than a snap. Reduced motion and replay
      // scrubbing snap.
      if (truck.headingNow === null || snap) truck.headingNow = heading;
      let turn = heading - truck.headingNow;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      truck.headingNow += turn * Math.min(1, dt * 6);
      truck.root.rotation.y = truck.headingNow;

      // Cumulative distance drives wheel spin; lagged heading drives body roll.
      let deltaHeading = 0;
      if (truck.prev) {
        truck.distance += truck.root.position.distanceTo(truck.prev);
        deltaHeading = heading - truck.headingLag;
        if (deltaHeading > Math.PI) deltaHeading -= Math.PI * 2;
        if (deltaHeading < -Math.PI) deltaHeading += Math.PI * 2;
      }
      truck.prev = truck.root.position.clone();
      truck.headingLag += deltaHeading * Math.min(1, dt * 4);
      const roll = reduced ? 0 : THREE.MathUtils.clamp((heading - truck.headingLag) * .35, -.06, .06);
      truck.body.position.y = !reduced && moving ? Math.sin(truck.distance * 6) * .012 : 0;
      truck.body.rotation.x = roll;
      const spin = -truck.distance / .17;
      for (let w = 0; w < 6; w++) {
        this.dummy.position.set(WHEEL_SLOTS[w]![0], WHEEL_Y, WHEEL_SLOTS[w]![1]);
        this.dummy.rotation.set(0, 0, spin);
        this.dummy.updateMatrix();
        truck.tyres.setMatrixAt(w, this.dummy.matrix);
        truck.rims.setMatrixAt(w, this.dummy.matrix);
      }
      truck.tyres.instanceMatrix.needsUpdate = true;
      truck.rims.instanceMatrix.needsUpdate = true;

      // Boom: eased from repair progress (up by 10%, folding in the last 5%),
      // but only once the truck is visually parked — a truck still catching up
      // after the arrival tick finishes the drive first, then eases at the
      // existing rate even if the domain is already past the 10% mark.
      const p = crew.phase === 'repairing'
        ? Math.min(1, Math.max(0, (state.tick + (reduced ? 0 : fraction) - crew.arriveAt) / Math.max(1, crew.completeAt - crew.arriveAt)))
        : 0;
      let boomTarget = crew.phase === 'repairing' && parked ? smoothstep(0, .1, p) * (1 - smoothstep(.95, 1, p)) : 0;
      if (reduced) boomTarget = p > 0 && p < 1 ? 1 : 0;
      truck.boom += (boomTarget - truck.boom) * (reduced ? 1 : Math.min(1, dt * 5));
      const boom = truck.boom;
      truck.lower.rotation.z = FOLDED_LOWER + (RAISED_LOWER - FOLDED_LOWER) * boom;
      truck.elbow.rotation.z = FOLDED_ELBOW + (RAISED_ELBOW - FOLDED_ELBOW) * boom;
      // Yaw swings the raised boom toward the substation transformer.
      let yaw = 0;
      if (crew.location !== 'depot' && crew.phase !== 'traveling') {
        const [fx, fz] = POSITIONS[crew.location];
        const dx = fx - truck.root.position.x, dz = fz - truck.root.position.z;
        const xL = Math.cos(heading) * dx - Math.sin(heading) * dz;
        const zL = Math.sin(heading) * dx + Math.cos(heading) * dz;
        yaw = Math.atan2(-zL, xL);
      }
      truck.pivot.rotation.y = yaw * boom;
      truck.bucket.rotation.z = -(truck.lower.rotation.z + truck.elbow.rotation.z);
      truck.outriggers.forEach((leg, i) => { leg.position.z = (i % 2 ? 1 : -1) * (.28 + .27 * boom); });

      // Work light: spot + bucket cone + yard pool glow while the boom is up.
      const working = boom > .5;
      truck.site = working && crew.phase === 'repairing' && crew.location !== 'depot' ? crew.location : null;
      truck.workSpot.intensity = working ? 60 : 0;
      truck.workCone.material.opacity = working ? .12 : 0;
      truck.workCone.visible = working;
      truck.workPool.visible = working && truck.site !== null;
      truck.workPool.material.opacity = truck.workPool.visible ? .3 : 0;
      if (truck.site) {
        const [fx, fz] = POSITIONS[truck.site];
        truck.workPool.position.set(fx, .74, fz); // substation pad surface
      }

      // Lights: headlight emissive mirrors the spotlights (moving + night),
      // tail lights on whenever moving, strobe while the crew is out.
      truck.head.emissiveIntensity = moving && nightness > .2 ? 1.6 : .2;
      truck.tail.emissiveIntensity = moving ? 1.5 : .12;
      const out = crew.phase !== 'idle';
      const strobeOn = (now * 2) % 1 < .12;
      truck.strobe.emissiveIntensity = !out ? .12 : reduced ? 1.3 : strobeOn ? 4 : .15;
      truck.flash.material.opacity = !out ? .08 : reduced ? .5 : strobeOn ? .85 : .05;
      truck.chevron.emissiveIntensity = nightness * .35;
      truck.lamp.emissiveIntensity = working ? 3 : 0;
    }
  }
}
