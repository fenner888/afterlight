import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: .35 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float edge = smoothstep(.42, .88, distance(vUv, vec2(.5)));
      color.rgb *= 1.0 - strength * edge;
      gl_FragColor = color;
    }`,
};

// Render -> bloom -> tonemap/sRGB -> vignette -> SMAA.
export class PostFX {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  bloomOn = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    this.composer = new EffectComposer(renderer);
    this.composer.setSize(width, height);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), .28, .4, .9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(VignetteShader));
    this.composer.addPass(new SMAAPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  setNight(nightness: number): void {
    // Daylight bloom near zero; night glow picks up windows/lamps.
    this.bloom.strength = this.bloomOn ? .28 * nightness : 0;
  }

  setBloomOn(on: boolean): void {
    this.bloomOn = on;
    if (!on) this.bloom.strength = 0;
  }

  render(dt: number): void { this.composer.render(dt); }

  dispose(): void { this.composer.dispose(); }
}
