import * as THREE from 'three';
import type { ServiceId, CrewId } from '../scenario.ts';
import { POSITIONS } from './common.ts';
import type { SceneContext } from './common.ts';
import { beamGradient, poolGradient, softCone } from './textures.ts';
import type { ServiceLight } from './buildings.ts';

const LAMP_SPOTS: [number, number][] = [[-10, .95], [-5, .95], [0, .95], [5, .95], [10, .95], [-8.85, -4], [-8.85, 3.5], [8.85, -4], [8.85, 3.5], [-2.5, -2.95], [4, -2.95]];
const LIT = new THREE.Color(0xffd9a0);
const DARK = new THREE.Color(0x39454a);

// Artificial district lights: street lamps, lamp cones at night, van spotlights.
export class SceneLights {
  private heads: THREE.InstancedMesh;
  private discs: THREE.InstancedMesh;
  private cones: THREE.InstancedMesh;
  private groups: ServiceId[] = [];
  private lastKey = '';
  private spots: THREE.SpotLight[] = [];
  private spotTargets: THREE.Object3D[] = [];

  constructor(ctx: SceneContext) {
    const poleGeometry = ctx.track(new THREE.CylinderGeometry(.045, .06, 1.9, 8));
    const headGeometry = ctx.track(new THREE.BoxGeometry(.34, .09, .16));
    const discGeometry = ctx.track(new THREE.CircleGeometry(1.8, 20));
    discGeometry.rotateX(-Math.PI / 2);
    const coneGeometry = ctx.track(new THREE.ConeGeometry(1.6, 3.5, 12, 1, true));
    const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const discMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc98a, transparent: true, opacity: .18, depthWrite: false,
      alphaMap: poolGradient(ctx), blending: THREE.AdditiveBlending,
    });
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: .09, depthWrite: false,
      alphaMap: beamGradient(ctx), side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    softCone(coneMaterial);
    ctx.track(headMaterial);
    ctx.track(discMaterial);
    ctx.track(coneMaterial);
    const poles = new THREE.InstancedMesh(poleGeometry, ctx.material(0x2c383c), LAMP_SPOTS.length);
    this.heads = new THREE.InstancedMesh(headGeometry, headMaterial, LAMP_SPOTS.length);
    this.discs = new THREE.InstancedMesh(discGeometry, discMaterial, LAMP_SPOTS.length);
    this.cones = new THREE.InstancedMesh(coneGeometry, coneMaterial, LAMP_SPOTS.length);
    const matrix = new THREE.Matrix4();
    LAMP_SPOTS.forEach(([x, z], index) => {
      matrix.makeTranslation(x, 1.37, z);
      poles.setMatrixAt(index, matrix);
      matrix.makeTranslation(x, 2.34, z);
      this.heads.setMatrixAt(index, matrix);
      this.heads.setColorAt(index, DARK);
      matrix.makeScale(0, 0, 0).setPosition(x, .52, z);
      this.discs.setMatrixAt(index, matrix);
      // Cone apex at the lamp head, opening downward (3.5 tall).
      matrix.makeScale(0, 0, 0).setPosition(x, .59, z);
      this.cones.setMatrixAt(index, matrix);
      const da = (x - POSITIONS['housing-a'][0]) ** 2 + (z - POSITIONS['housing-a'][1]) ** 2;
      const db = (x - POSITIONS['housing-b'][0]) ** 2 + (z - POSITIONS['housing-b'][1]) ** 2;
      this.groups.push(da <= db ? 'housing-a' : 'housing-b');
    });
    poles.castShadow = true;
    ctx.world.add(poles, this.heads, this.discs, this.cones);
  }

  attachVan(mounts: THREE.Object3D[]): void {
    for (const mount of mounts) {
      const spot = new THREE.SpotLight(0xfff2d8, 0, 9, .45, .5, 1.2);
      const target = new THREE.Object3D();
      target.position.set(4.6, -.32, 0);
      mount.add(spot, target);
      spot.target = target;
      this.spots.push(spot);
      this.spotTargets.push(target);
    }
  }

  update(statusOf: (id: ServiceId) => ServiceLight, crewActive: Map<CrewId, boolean>, nightness: number): void {
    const key = `${statusOf('housing-a')}|${statusOf('housing-b')}|${nightness > .25 ? 1 : 0}|${[...crewActive.values()].join('')}`;
    const conesOn = nightness > .25;
    if (key !== this.lastKey) {
      this.lastKey = key;
      const matrix = new THREE.Matrix4();
      LAMP_SPOTS.forEach(([x, z], index) => {
        const lit = statusOf(this.groups[index]!) === 'grid';
        this.heads.setColorAt(index, lit ? LIT : DARK);
        matrix.makeScale(1, 1, 1).setPosition(x, .52, z);
        if (!lit) matrix.makeScale(0, 0, 0);
        this.discs.setMatrixAt(index, matrix);
        matrix.makeScale(1, 1, 1).setPosition(x, .59, z);
        if (!(lit && conesOn)) matrix.makeScale(0, 0, 0);
        this.cones.setMatrixAt(index, matrix);
      });
      this.heads.instanceColor!.needsUpdate = true;
      this.discs.instanceMatrix.needsUpdate = true;
      this.cones.instanceMatrix.needsUpdate = true;
    }
    let i = 0;
    for (const active of crewActive.values()) {
      const intensity = active && nightness > .2 ? 40 : 0;
      this.spots[i]!.intensity = intensity;
      this.spots[i + 1]!.intensity = intensity;
      i += 2;
    }
  }
}
