import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NODE_IDS, CREW_IDS, FEEDER_IDS, SERVICE_IDS, SERVICES, LABELS, isService, isFeeder, formatTime, dayPhase } from '../scenario.ts';
import type { NodeId, CrewId, FeederId, ServiceId } from '../scenario.ts';
import { capacity, connectedLoad, phase, serviceStatus } from '../domain.ts';
import type { State } from '../domain.ts';
import { POSITIONS, HEIGHTS, createContext } from './common.ts';
import type { SceneContext } from './common.ts';
import { buildDistrict } from './buildings.ts';
import type { ServiceLight } from './buildings.ts';
import { SkyRig } from './sky.ts';
import { Sea } from './water.ts';
import { SceneLights } from './lights.ts';
import { PostFX } from './post.ts';
import { Cinematic } from './cinematic.ts';
import { Fleet } from './vehicles.ts';
import { rainStreak } from './textures.ts';

// Look-at at platform-surface height with a shallow ~11.5 deg view pitch: this is what
// puts the horizon and sky in the top ~25-30% of the frame with the sea between, the
// platform back edge near 38% of canvas height, and the quay along the bottom.
const BASE_TARGET = new THREE.Vector3(0, 0, -.2);

export class DistrictScene {
  private renderer: THREE.WebGLRenderer;
  private world = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, .1, 600);
  private controls: OrbitControls;
  private ctx: SceneContext;
  private sky: SkyRig;
  private sea: Sea;
  private lights: SceneLights;
  private district: ReturnType<typeof buildDistrict>;
  private post: PostFX | null = null;
  private cine: Cinematic;
  private markers = new Map<NodeId, HTMLButtonElement>();
  private fleet: Fleet;
  private workSites = new Map<FeederId, { group: THREE.Group; sparks: THREE.Points; sparkMaterial: THREE.PointsMaterial }>();
  private rings = new Map<FeederId, { root: HTMLElement; fill: SVGCircleElement; label: HTMLElement }>();
  private power = new THREE.Group();
  private powerKey = '';
  private sparkGeometries: THREE.BufferGeometry[] = [];
  private selection: THREE.Mesh;
  private dependencies = new THREE.Group();
  private dependencyKey = '';
  private observer: ResizeObserver;
  private contextLost = false;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private pointerStart = new THREE.Vector2();
  private dimensions = { width: 1, height: 1 };
  private rain: THREE.Points | null = null;
  private rainPositions: THREE.BufferAttribute | null = null;
  private rainMaterial: THREE.PointsMaterial | null = null;
  private targetGoal = BASE_TARGET.clone();
  private driftTheta = 0;
  private fitted = false;
  private lastPhase = '';
  private prevNow = 0;
  // fov 32, position elevation ~11 deg (polar 79): a level sea reaching the horizon needs a
  // shallow view pitch or no sky is ever in frame; azimuth ~7 deg so the harbour sits front-left.
  // Radius is fitted so the platform spans ~72% of the canvas width.
  private initialCamera = BASE_TARGET.clone().add(
    new THREE.Vector3().setFromSphericalCoords(34, THREE.MathUtils.degToRad(80.7), THREE.MathUtils.degToRad(7)),
  );
  private qualityTier = 0;
  private qualitySamples: number[] = [];
  private qualityCheck = 0;
  private hotTime = 0;
  private canvasHost: HTMLElement;
  private onSelect: (id: NodeId) => void;
  private onNotice: (message: string) => void;

  constructor(canvasHost: HTMLElement, markerHost: HTMLElement, onSelect: (id: NodeId) => void, onNotice: (message: string) => void) {
    this.canvasHost = canvasHost;
    this.onSelect = onSelect;
    this.onNotice = onNotice;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    canvasHost.append(this.renderer.domElement);
    this.ctx = createContext(this.world, this.renderer, this.reduced);
    this.camera.position.copy(this.initialCamera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(BASE_TARGET);
    this.controls.enablePan = false;
    this.controls.enableDamping = !this.reduced.matches;
    this.controls.dampingFactor = .1;
    // Orbit bounds ~8-42 deg of platform-relative elevation; the default view sits
    // near the shallow end so the horizon stays in frame.
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(32);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(81);
    const angle = Math.atan2(this.initialCamera.x, this.initialCamera.z - BASE_TARGET.z);
    this.controls.minAzimuthAngle = angle - THREE.MathUtils.degToRad(35);
    this.controls.maxAzimuthAngle = angle + THREE.MathUtils.degToRad(35);
    this.controls.minDistance = 24;
    this.controls.maxDistance = 52;
    this.controls.update();
    this.controls.saveState();
    this.sky = new SkyRig(this.ctx);
    this.sea = new Sea(this.ctx, this.sky.sunDir, this.sky.moonDir);
    this.lights = new SceneLights(this.ctx);
    this.district = buildDistrict(this.ctx);
    this.cine = new Cinematic(this.reduced);
    this.buildRain();
    for (const [index, id] of NODE_IDS.entries()) {
      const marker = document.createElement('button');
      marker.className = 'map-marker';
      marker.dataset.node = id;
      marker.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.textContent = LABELS[id];
      marker.append(name);
      marker.setAttribute('aria-label', `Inspect ${LABELS[id]}`);
      marker.addEventListener('click', () => onSelect(id));
      markerHost.append(marker);
      this.markers.set(id, marker);
    }
    this.buildWorkSites(markerHost);
    const ring = new THREE.RingGeometry(1.9, 1.96, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xdfac60, side: THREE.DoubleSide, transparent: true, opacity: .85 });
    this.ctx.track(ring);
    this.ctx.track(ringMaterial);
    this.selection = new THREE.Mesh(ring, ringMaterial);
    this.selection.rotation.x = -Math.PI / 2;
    this.world.add(this.selection, this.dependencies, this.power);
    this.fleet = new Fleet(this.ctx, this.lights);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', this.lost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.restored);
    this.reduced.addEventListener('change', this.motionChange);
    this.observer = new ResizeObserver(() => this.resize(canvasHost));
    this.observer.observe(canvasHost);
    this.resize(canvasHost);
    try {
      this.post = new PostFX(this.renderer, this.world, this.camera, this.dimensions.width, this.dimensions.height);
    } catch {
      this.post = null;
    }
  }

  begin(): void { this.cine.begin(); }
  skip(): void { this.cine.skip(); }

  private resolvedStatus(state: State, id: ServiceId): ServiceLight {
    return this.cine.override(id) ?? serviceStatus(state, id);
  }

  private buildRain(): void {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ((i * 7919) % 373) / 373 * 40 - 20;
      positions[i * 3 + 1] = ((i * 104729) % 1600) / 100;
      positions[i * 3 + 2] = ((i * 15485863) % 340) / 10 - 9;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.ctx.track(geometry);
    this.rainMaterial = new THREE.PointsMaterial({ map: rainStreak(this.ctx), size: .55, transparent: true, opacity: .55, depthWrite: false, color: 0xbcd4ff, blending: THREE.AdditiveBlending });
    this.ctx.track(this.rainMaterial);
    this.rain = new THREE.Points(geometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rainPositions = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.rain.visible = !this.reduced.matches && this.renderer.capabilities.isWebGL2;
    this.world.add(this.rain);
  }

  private buildWorkSites(markerHost: HTMLElement): void {
    for (const id of FEEDER_IDS) {
      const [x, z] = POSITIONS[id];
      const site = new THREE.Group();
      const pole = this.ctx.material(0x39454a);
      this.ctx.cylinder(site, pole, [0, .8, 0], .05, 1.6);
      this.ctx.box(site, this.ctx.material(0x4d4230), [0, 1.62, .12], [.3, .12, .22]);
      const lamp = this.ctx.material(0x574426, 0xffd9a0);
      lamp.emissiveIntensity = 1.8;
      this.ctx.box(site, lamp, [0, 1.56, .2], [.22, .06, .14]);
      const light = new THREE.PointLight(0xffd9a0, 6, 6, 1.5);
      light.position.set(0, 1.4, .5);
      site.add(light);
      site.position.set(x + 1.9, .48, z + 1.5);
      site.visible = false;
      this.world.add(site);
      const sparkGeometry = new THREE.BufferGeometry();
      const vertices: number[] = [];
      for (let i = 0; i < 14; i++) vertices.push(((i * 37) % 11 - 5) * .11, ((i * 53) % 9) * .11 + .85, ((i * 29) % 11 - 5) * .11);
      sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      this.sparkGeometries.push(sparkGeometry);
      const sparkMaterial = new THREE.PointsMaterial({ color: 0xffcf8a, size: .17, transparent: true, opacity: .9 });
      this.ctx.track(sparkMaterial);
      const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
      sparks.position.set(x, .45, z);
      this.world.add(sparks);
      this.workSites.set(id, { group: site, sparks, sparkMaterial });
      const root = document.createElement('div');
      root.className = 'work-ring';
      root.hidden = true;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 36 36');
      const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      track.setAttribute('class', 'ring-track');
      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      fill.setAttribute('class', 'ring-fill');
      fill.setAttribute('transform', 'rotate(-90 18 18)');
      for (const circle of [track, fill]) {
        circle.setAttribute('cx', '18');
        circle.setAttribute('cy', '18');
        circle.setAttribute('r', '15.5');
        circle.setAttribute('pathLength', '100');
        svg.append(circle);
      }
      const label = document.createElement('span');
      label.className = 'ring-label';
      root.append(svg, label);
      markerHost.append(root);
      this.rings.set(id, { root, fill, label });
    }
  }

  update(state: State, selected: NodeId): void {
    const [x, z] = POSITIONS[selected];
    this.selection.position.set(x, .53, z);
    this.targetGoal.set(x * .15, BASE_TARGET.y, -.2 + z * .15);
    const available = capacity(state);
    const headroom = available - connectedLoad(state);
    const current = phase(state);
    for (const id of NODE_IDS) {
      const marker = this.markers.get(id)!;
      marker.dataset.selected = String(id === selected);
      marker.setAttribute('aria-pressed', String(id === selected));
      marker.classList.toggle('actionable', current === 'dispatch' && isFeeder(id) && state.feeders[id] === 'faulted');
      marker.classList.toggle('reconnectable', current === 'restore' && isService(id) && !state.services[id].connected && SERVICES[id].load <= headroom);
      if (isService(id)) {
        marker.dataset.state = serviceStatus(state, id);
      } else if (isFeeder(id)) {
        const color = state.feeders[id] === 'repaired' ? 0x8bc7b0 : state.feeders[id] === 'faulted' ? 0xd27b6c : 0xdfac60;
        const material = this.district.feederGlow.get(id)!;
        material.color.setHex(color);
        material.emissive.setHex(color);
      }
    }
    for (const id of FEEDER_IDS) {
      const ring = this.rings.get(id)!;
      const site = this.workSites.get(id)!;
      const crew = CREW_IDS.map(crew => state.crews[crew]).find(crew => crew.target === id && crew.phase !== 'idle');
      site.group.visible = crew?.phase === 'repairing';
      site.sparks.visible = site.group.visible && !this.reduced.matches;
      if (!crew) { ring.root.hidden = true; continue; }
      ring.root.hidden = false;
      const traveling = crew.phase === 'traveling';
      ring.root.dataset.mode = traveling ? 'travel' : 'repair';
      const done = traveling ? crew.arriveAt : crew.completeAt;
      const start = traveling ? crew.departedAt : crew.arriveAt;
      const progress = done === start ? 1 : Math.min(1, Math.max(0, (state.tick - start) / (done - start)));
      ring.fill.style.strokeDasharray = traveling ? '5 4' : `${progress * 100} 100`;
      ring.label.textContent = traveling ? `arrives ${formatTime(Math.max(0, done - state.tick))}` : formatTime(Math.max(0, done - state.tick));
    }
    const powerKey = `${FEEDER_IDS.map(id => state.feeders[id]).join(',')}|${SERVICE_IDS.map(id => state.services[id].connected ? 1 : 0).join('')}|${available > 0 ? 1 : 0}`;
    if (powerKey !== this.powerKey) {
      this.powerKey = powerKey;
      this.clearPower();
      const energized = available > 0;
      for (const [index, feeder] of FEEDER_IDS.entries()) {
        const repaired = state.feeders[feeder] === 'repaired';
        const [fx, fz] = POSITIONS[feeder];
        const y = .57 + index * .07;
        for (const service of SERVICE_IDS) {
          const connected = state.services[service].connected;
          const color = !repaired ? 0x37434a : connected && energized ? 0x9fe0c6 : 0x2e6a60;
          const opacity = repaired ? (connected && energized ? .95 : .4) : .45;
          const [sx, sz] = POSITIONS[service];
          const points = [new THREE.Vector3(fx, y, fz), new THREE.Vector3(0, y, -2.1), new THREE.Vector3(sx, y, sz)];
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
          this.power.add(new THREE.Line(geometry, material));
        }
        const stubGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(fx, y, fz), new THREE.Vector3(fx, y, POSITIONS.supply[1]), new THREE.Vector3(POSITIONS.supply[0], y, POSITIONS.supply[1])]);
        this.power.add(new THREE.Line(stubGeometry, new THREE.LineBasicMaterial({ color: repaired ? 0x9fe0c6 : 0x37434a, transparent: true, opacity: repaired ? .9 : .45 })));
      }
    }
    const dependencyKey = `${selected}/${state.feeders['feeder-a']}/${state.feeders['feeder-b']}`;
    if (dependencyKey === this.dependencyKey) return;
    this.dependencyKey = dependencyKey;
    this.clearDependencies();
    const targets: FeederId[] = isService(selected) ? [...FEEDER_IDS] : isFeeder(selected) ? [selected] : [];
    for (const id of targets) {
      const start = POSITIONS.supply;
      const feeder = POSITIONS[id];
      const end = isService(selected) ? POSITIONS[selected] : feeder;
      const points = [new THREE.Vector3(start[0], .59, start[1]), new THREE.Vector3(feeder[0], .59, start[1]), new THREE.Vector3(feeder[0], .59, feeder[1]), new THREE.Vector3(feeder[0], .59, 1.8), new THREE.Vector3(end[0], .59, 1.8), new THREE.Vector3(end[0], .59, end[1])];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({ color: state.feeders[id] === 'repaired' ? 0x8bc7b0 : 0xdfac60, dashSize: .23, gapSize: .16, transparent: true, opacity: .7 });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      this.dependencies.add(line);
    }
  }

  render(state: State, fraction: number): void {
    if (this.contextLost) return;
    const now = performance.now() / 1000;
    const dt = Math.min(.1, Math.max(0, now - this.prevNow));
    this.prevNow = now;
    const reduced = this.reduced.matches;
    const current = phase(state);
    if (current === 'restored' && this.lastPhase !== 'restored' && !this.cine.playing) this.cine.startPullback();
    this.lastPhase = current;
    this.cine.update(dt);
    this.canvasHost.dataset.cinematic = this.cine.playing ? 'playing' : 'done';
    if (this.cine.consumeFlash()) this.sky.triggerFlash(now);
    // Idle drift + selected-node target easing + restored pull-back.
    if (!reduced) {
      const drift = Math.sin(now * Math.PI / 10) * THREE.MathUtils.degToRad(.8);
      const delta = drift - this.driftTheta;
      this.driftTheta = drift;
      if (delta) {
        const offset = this.camera.position.clone().sub(this.controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), delta);
        this.camera.position.copy(this.controls.target).add(offset);
      }
    }
    const step = this.cine.pullbackStep(dt);
    if (step) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.multiplyScalar(step.dolly);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.phi = THREE.MathUtils.clamp(spherical.phi - step.polar, this.controls.minPolarAngle, this.controls.maxPolarAngle);
      this.camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(this.controls.target));
    }
    this.controls.target.lerp(this.targetGoal, reduced ? 1 : Math.min(1, dt * 3));
    this.controls.update();
    // Windows + artificial lights resolve cinematic overrides.
    const statusOf = (id: ServiceId): ServiceLight => this.resolvedStatus(state, id);
    for (const id of SERVICE_IDS) this.district.windows.note(id, statusOf(id), now);
    this.district.windows.update(statusOf, now, reduced);
    const crewActive = new Map<CrewId, boolean>(CREW_IDS.map(id => [id, state.crews[id].phase === 'traveling']));
    this.lights.update(statusOf, crewActive, this.sky.nightness);
    this.sky.update(state.tick, connectedLoad(state), current, dayPhase(state.tick), now, dt);
    this.sea.update(now, dt, this.sky.nightness);
    // Rain-darkened concrete/asphalt: albedo multiplier fades from 1 to ~0.72 as rain falls.
    const wet = 1 - .28 * (1 - connectedLoad(state) / 13);
    for (const material of this.district.wetMaterials) material.color.setRGB(wet, wet, wet * 1.01);
    if (this.post) this.post.setNight(this.sky.nightness);
    for (const [index, id] of FEEDER_IDS.entries()) {
      const site = this.workSites.get(id)!;
      if (site.group.visible) {
        const jitter = ((state.tick * 2654435761 + index * 97) >>> 8) % 100 / 100;
        // Under a raised boom the shower pops more often — a second, faster
        // flicker term layered on the deterministic per-tick jitter.
        const crackle = this.fleet.workingAt(id) && !reduced && (now * 11 + index * 3.7) % 1 < .28 ? .45 : 0;
        site.sparkMaterial.opacity = Math.min(1, .3 + .65 * jitter + crackle);
      }
    }
    const clinicStatus = statusOf('clinic');
    this.district.clinicCross.emissive.setHex(clinicStatus === 'backup' ? 0xdfac60 : 0xd0453e);
    this.district.clinicCross.emissiveIntensity = clinicStatus === 'offline' ? .15 : 1.5;
    this.district.clinicGen.emissiveIntensity = clinicStatus === 'backup' ? 1.7 : .08;
    const beaconOn = statusOf('beacon') === 'grid';
    this.district.beaconLamp.emissiveIntensity = beaconOn ? 2.1 : .05;
    this.district.beaconPivot.visible = beaconOn;
    if (beaconOn && !reduced) this.district.beaconPivot.rotation.y = now * .5;
    if (this.rain && this.rainPositions && this.rainMaterial) {
      const density = (1 - .78 * connectedLoad(state) / 13) * (.45 + .55 * this.sky.nightness);
      this.rain.geometry.setDrawRange(0, Math.floor(1500 * density));
      this.rainMaterial.opacity = .3 + .25 * this.sky.nightness;
      if (this.rain.visible) {
        const arr = this.rainPositions.array as Float32Array;
        for (let i = 1; i < arr.length; i += 3) {
          arr[i] = arr[i]! - dt * 11;
          if (arr[i]! < .3) arr[i] = arr[i]! + 16;
        }
        this.rainPositions.needsUpdate = true;
      }
    }
    this.fleet.update(state, fraction, now, dt, this.sky.nightness);
    this.renderer.info.reset();
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.world, this.camera);
    this.trackQuality(dt);
    for (const id of NODE_IDS) {
      const [x, z] = POSITIONS[id];
      const position = new THREE.Vector3(x, HEIGHTS[id], z).project(this.camera);
      const marker = this.markers.get(id)!;
      marker.style.transform = `translate(${(position.x + 1) * this.dimensions.width / 2}px, ${(-position.y + 1) * this.dimensions.height / 2}px) translate(-50%, -100%)`;
      marker.style.visibility = Math.abs(position.x) > 1 || Math.abs(position.y) > 1 || position.z > 1 ? 'hidden' : 'visible';
    }
    for (const id of FEEDER_IDS) {
      const ring = this.rings.get(id)!;
      if (ring.root.hidden) continue;
      const [x, z] = POSITIONS[id];
      const position = new THREE.Vector3(x, HEIGHTS[id] + 1.7, z).project(this.camera);
      ring.root.style.transform = `translate(${(position.x + 1) * this.dimensions.width / 2}px, ${(-position.y + 1) * this.dimensions.height / 2}px) translate(-50%, -100%)`;
      ring.root.style.visibility = Math.abs(position.x) > 1 || Math.abs(position.y) > 1 || position.z > 1 ? 'hidden' : 'visible';
    }
  }

  // Quality scaler: if p95 frame time exceeds 22 ms for ~3 s, degrade one tier at a time.
  private trackQuality(dt: number): void {
    if (dt > 0) {
      this.qualitySamples.push(dt * 1000);
      if (this.qualitySamples.length > 240) this.qualitySamples.shift();
    }
    if (this.qualitySamples.length < 120 || ++this.qualityCheck < 30) return;
    this.qualityCheck = 0;
    const samples = [...this.qualitySamples].sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * .95)]!;
    if (p95 > 22) {
      this.hotTime += .5;
      if (this.hotTime >= 3 && this.qualityTier < 3) {
        this.qualityTier++;
        if (this.qualityTier === 1) this.post?.setBloomOn(false);
        else if (this.qualityTier === 2) this.sea.setTier(2);
        else if (this.qualityTier === 3) {
          this.renderer.setPixelRatio(1);
          this.resize(this.renderer.domElement.parentElement!);
        }
        this.hotTime = 0;
      }
    } else this.hotTime = Math.max(0, this.hotTime - .25);
  }

  anchor(id: NodeId): { x: number; y: number; w: number; h: number } | null {
    const marker = this.markers.get(id);
    if (!marker || !marker.parentElement) return null;
    const host = marker.parentElement.getBoundingClientRect();
    const rect = marker.getBoundingClientRect();
    return { x: rect.left - host.left, y: rect.top - host.top, w: rect.width, h: rect.height };
  }

  reset(): void { this.controls.reset(); }
  zoom(delta: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const length = THREE.MathUtils.clamp(offset.length() * (1 - delta), this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(length));
    this.controls.update();
  }
  rotate(delta: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta = THREE.MathUtils.clamp(spherical.theta + delta, this.controls.minAzimuthAngle, this.controls.maxAzimuthAngle);
    this.camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(this.controls.target));
    this.controls.update();
  }
  metrics(): string {
    return `${this.renderer.info.render.calls} draw calls · ${this.renderer.info.render.triangles.toLocaleString()} triangles · DPR ${this.renderer.getPixelRatio()} · quality tier ${this.qualityTier} · reduced motion ${this.reduced.matches ? 'on' : 'off'}`;
  }

  private resize(host: HTMLElement): void {
    const { width, height } = host.getBoundingClientRect();
    this.dimensions = { width: Math.max(1, width), height: Math.max(1, height) };
    this.camera.aspect = this.dimensions.width / this.dimensions.height;
    this.camera.updateProjectionMatrix();
    if (!this.fitted) {
      this.fitted = true;
      // Fit so the platform's widest projected extent covers ~72% of canvas width.
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      const corners = [[-12.4, .42, -9.4], [12.4, .42, -9.4], [12.4, .42, 9.4], [-12.4, .42, 9.4]];
      const widthAt = (r: number): number => {
        this.camera.position.copy(this.controls.target).add(dir.clone().multiplyScalar(r));
        this.camera.updateMatrixWorld();
        let min = 1, max = -1;
        for (const [x, y, z] of corners) {
          const p = new THREE.Vector3(x!, y!, z!).project(this.camera);
          if (p.x < min) min = p.x;
          if (p.x > max) max = p.x;
        }
        return (max - min) / 2;
      };
      let lo = 12, hi = 60;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (widthAt(mid) > .72) lo = mid; else hi = mid;
      }
      const fit = hi;
      this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(fit));
      this.controls.minDistance = fit * .55;
      this.controls.maxDistance = fit * 1.7;
      this.controls.update();
      this.controls.saveState();
    }
    this.renderer.setSize(this.dimensions.width, this.dimensions.height);
    this.post?.setSize(this.dimensions.width, this.dimensions.height);
  }

  private pointerDown = (event: PointerEvent): void => { this.pointerStart.set(event.clientX, event.clientY); };
  private pointerUp = (event: PointerEvent): void => {
    if (this.cine.playing) return;
    if (this.pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.camera);
    const hit = ray.intersectObjects([...this.district.nodes.values()], true)[0];
    if (hit) this.onSelect(hit.object.userData.node as NodeId);
  };
  private lost = (event: Event): void => { event.preventDefault(); this.contextLost = true; this.onNotice('3D view interrupted. All district controls still work below. Waiting for WebGL recovery.'); };
  private restored = (): void => { this.contextLost = false; this.onNotice(''); };
  private motionChange = (): void => {
    this.controls.enableDamping = !this.reduced.matches;
    if (this.rain) this.rain.visible = !this.reduced.matches && this.renderer.capabilities.isWebGL2;
    if (this.reduced.matches) this.cine.skip();
  };
  private clearDependencies(): void {
    for (const child of this.dependencies.children) {
      const line = child as THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
      line.geometry.dispose();
      line.material.dispose();
    }
    this.dependencies.clear();
  }
  private clearPower(): void {
    for (const child of this.power.children) {
      const line = child as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
      line.geometry.dispose();
      line.material.dispose();
    }
    this.power.clear();
  }
  dispose(): void {
    this.observer.disconnect();
    this.controls.dispose();
    this.reduced.removeEventListener('change', this.motionChange);
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.lost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.restored);
    this.clearDependencies();
    this.clearPower();
    this.sky.dispose();
    this.sea.dispose();
    this.post?.dispose();
    this.selection.geometry.dispose();
    this.sparkGeometries.forEach(geometry => geometry.dispose());
    this.ctx.geometries.forEach(geometry => geometry.dispose());
    this.ctx.textures.forEach(texture => texture.dispose());
    this.ctx.materials.forEach(material => material.dispose());
    this.ctx.boxGeometry.dispose();
    this.ctx.cylinderGeometry.dispose();
    this.markers.forEach(marker => marker.remove());
    this.rings.forEach(ring => ring.root.remove());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
