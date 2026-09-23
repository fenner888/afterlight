import * as THREE from 'three';
import type { NodeId } from '../scenario.ts';

export const POSITIONS: Record<NodeId, [number, number]> = {
  supply: [-10, -7], 'feeder-a': [-8, -3.8], 'feeder-b': [8, -3.8],
  clinic: [3.1, -.1], 'housing-a': [-3.4, -4.6], 'housing-b': [2.1, -5.5],
  pump: [7.5, 5.7], beacon: [-9.3, 6.3], depot: [-3.5, 4.6],
};
export const HEIGHTS: Record<NodeId, number> = { supply: 3.4, 'feeder-a': 3.2, 'feeder-b': 3.2, clinic: 3.1, 'housing-a': 4.6, 'housing-b': 5, pump: 3, beacon: 5.9, depot: 2.9 };

export interface SceneContext {
  world: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  reduced: MediaQueryList;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  textures: THREE.Texture[];
  boxGeometry: THREE.BoxGeometry;
  cylinderGeometry: THREE.CylinderGeometry;
  material(color: number, emissive?: number): THREE.MeshStandardMaterial;
  box(parent: THREE.Object3D, material: THREE.Material, position: [number, number, number], size: [number, number, number]): THREE.Mesh;
  cylinder(parent: THREE.Object3D, material: THREE.Material, position: [number, number, number], radius: number, height: number): THREE.Mesh;
  track<T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(item: T): T;
}

export function createContext(world: THREE.Scene, renderer: THREE.WebGLRenderer, reduced: MediaQueryList): SceneContext {
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
  const track = <T extends THREE.Material | THREE.BufferGeometry | THREE.Texture>(item: T): T => {
    if (item instanceof THREE.Material) materials.push(item);
    else if (item instanceof THREE.BufferGeometry) geometries.push(item);
    else textures.push(item);
    return item;
  };
  const ctx: SceneContext = {
    world, renderer, reduced, materials, geometries, textures, boxGeometry, cylinderGeometry, track,
    material(color: number, emissive = 0): THREE.MeshStandardMaterial {
      const material = new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .06, emissive, emissiveIntensity: .6, envMapIntensity: .6 });
      materials.push(material);
      return material;
    },
    box(parent: THREE.Object3D, material: THREE.Material, position: [number, number, number], size: [number, number, number]): THREE.Mesh {
      const mesh = new THREE.Mesh(boxGeometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...size);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    },
    cylinder(parent: THREE.Object3D, material: THREE.Material, position: [number, number, number], radius: number, height: number): THREE.Mesh {
      const mesh = new THREE.Mesh(cylinderGeometry, material);
      mesh.position.set(...position);
      mesh.scale.set(radius, height, radius);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    },
  };
  return ctx;
}
