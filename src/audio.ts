import { serviceStatus } from './domain.ts';
import type { State } from './domain.ts';
import { CREW_IDS, FEEDER_IDS } from './scenario.ts';
import type { ServiceId } from './scenario.ts';

export type Cue =
  | 'thunder'
  | 'hydraulic'
  | 'repaired'
  | 'reconnect'
  | 'disconnect'
  | 'reject'
  | 'backup-warn'
  | 'generator-stop'
  | 'decision'
  | 'sunrise';

type Bed = { gain: GainNode; level: number };

const RAMP = 1.2;
const chimePitch: Record<ServiceId, number> = {
  clinic: 523.25,
  'housing-a': 587.33,
  'housing-b': 659.25,
  pump: 440,
  beacon: 783.99,
};

// Procedural Web Audio: one shared noise buffer, continuous beds and one-shot cues
// into a master gain -> limiter-ish compressor -> destination. No audio files.
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beds = new Map<string, Bed>();
  private oneShots = new Set<AudioScheduledSourceNode>();
  private reviewQuiet = false;
  private thunderCount = 0;
  private nextCrackle = 0;
  private _muted = false;

  get muted(): boolean { return this._muted; }
  get state(): string { return this.ctx?.state ?? 'suspended'; }

  start(): void {
    if (this.ctx) {
      if (!this._muted) void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : .9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;
    limiter.attack.value = .003;
    limiter.release.value = .25;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.master = master;
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;
    this.buildBeds();
    void ctx.resume();
  }

  private noiseSource(): AudioBufferSourceNode {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    return source;
  }

  private bed(id: string, chain: (gain: GainNode) => void): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    chain(gain);
    this.beds.set(id, { gain, level: 0 });
  }

  private buildBeds(): void {
    const ctx = this.ctx!;
    const filteredNoise = (gain: GainNode, type: BiquadFilterType, frequency: number, q = 1): BiquadFilterNode => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const source = this.noiseSource();
      source.connect(filter);
      filter.connect(gain);
      source.start();
      return filter;
    };
    const lfoInto = (param: AudioParam, frequency: number, depthValue: number): void => {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = frequency;
      const depth = ctx.createGain();
      depth.gain.value = depthValue;
      lfo.connect(depth);
      depth.connect(param);
      lfo.start();
    };
    // Rain: bandpassed hiss.
    this.bed('rain', gain => { filteredNoise(gain, 'bandpass', 1400, .5); });
    // Sea swell: low noise with a slow breathing LFO on the bed gain.
    this.bed('sea', gain => {
      filteredNoise(gain, 'lowpass', 220);
      lfoInto(gain.gain, .08, .018);
    });
    // Wind: bandpassed noise, centre frequency slowly swept; fades as the storm clears.
    this.bed('wind', gain => {
      const filter = filteredNoise(gain, 'bandpass', 480, .8);
      lfoInto(filter.frequency, .05, 260);
    });
    // Clinic generator: low sawtooth with a tremble while it carries the ward.
    this.bed('generator', gain => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 54;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 170;
      osc.connect(filter);
      filter.connect(gain);
      lfoInto(gain.gain, 7, .022);
      osc.start();
    });
    // A faint transformer hum per feeder, slightly detuned from each other.
    for (const [index, id] of FEEDER_IDS.entries()) {
      this.bed(`hum:${id}`, gain => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 118 + index * 7;
        osc.connect(gain);
        lfoInto(gain.gain, 2.4, .012);
        osc.start();
      });
    }
    // Truck engine: low growl while any crew travels.
    this.bed('engine', gain => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 78;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = .12;
      const source = this.noiseSource();
      osc.connect(filter);
      source.connect(noiseGain);
      noiseGain.connect(filter);
      filter.connect(gain);
      source.start();
      osc.start();
    });
  }

  private ramp(id: string, level: number): void {
    const ctx = this.ctx;
    const bed = this.beds.get(id);
    if (!ctx || !bed || bed.level === level) return;
    bed.level = level;
    bed.gain.gain.setTargetAtTime(level, ctx.currentTime, RAMP / 3);
  }

  update(input: { state: State; review: boolean; rain: number; storm: number; now: number }): void {
    const ctx = this.ctx;
    this.reviewQuiet = input.review;
    if (!ctx) return;
    const { state, rain, storm, now } = input;
    this.ramp('rain', rain * .12);
    this.ramp('sea', .05);
    this.ramp('wind', storm * .075);
    this.ramp('generator', serviceStatus(state, 'clinic') === 'backup' ? .08 : 0);
    for (const id of FEEDER_IDS) this.ramp(`hum:${id}`, state.feeders[id] === 'repaired' ? .04 : 0);
    this.ramp('engine', CREW_IDS.some(id => state.crews[id].phase === 'traveling') ? .09 : 0);
    if (CREW_IDS.some(id => state.crews[id].phase === 'repairing') && now >= this.nextCrackle) {
      this.nextCrackle = now + .18 + ((state.tick * 37) % 10) / 22;
      this.crackle();
    }
  }

  private crackle(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const source = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2400;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(.05, t);
    gain.gain.exponentialRampToValueAtTime(.001, t + .06);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    this.track(source);
    source.start(t, Math.random() * 1.8, .07);
  }

  private track(source: AudioScheduledSourceNode): void {
    this.oneShots.add(source);
    source.onended = () => this.oneShots.delete(source);
  }

  private envGain(peak: number, attack: number, decay: number, at = 0): GainNode {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    const t = ctx.currentTime + at;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(.0008, t + attack + decay);
    gain.connect(this.master!);
    return gain;
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, peak: number, at = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime + at;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    osc.connect(this.envGain(peak, .01, duration, at));
    this.track(osc);
    osc.start(t);
    osc.stop(t + duration + .1);
  }

  private noiseBurst(duration: number, peak: number, filterType: BiquadFilterType, frequency: number, at = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const source = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    source.connect(filter);
    filter.connect(this.envGain(peak, .008, duration, at));
    this.track(source);
    source.start(ctx.currentTime + at, Math.random(), duration + .1);
    source.stop(ctx.currentTime + at + duration + .1);
  }

  cue(name: Cue, detail?: { service?: ServiceId }): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.reviewQuiet) return;
    switch (name) {
      case 'thunder': {
        // Deterministic 0.4-1.4 s delay from the flash index.
        const delay = .4 + ((this.thunderCount++ * 37) % 10) / 10;
        const t = ctx.currentTime + delay;
        const source = this.noiseSource();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(420, t);
        filter.frequency.exponentialRampToValueAtTime(70, t + 2.2);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(.5, t + .06);
        gain.gain.exponentialRampToValueAtTime(.001, t + 2.6);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.master!);
        this.track(source);
        source.start(t, Math.random());
        source.stop(t + 2.8);
        break;
      }
      case 'hydraulic':
        this.tone('sine', 170, 520, .9, .05);
        this.noiseBurst(.5, .02, 'bandpass', 900);
        break;
      case 'repaired':
        this.tone('sine', 68, 38, .3, .5);
        this.noiseBurst(.05, .25, 'lowpass', 800);
        this.tone('sine', 118, 118, .8, .08, .15);
        break;
      case 'reconnect': {
        const pitch = detail?.service ? chimePitch[detail.service] : 523.25;
        this.noiseBurst(.03, .18, 'highpass', 1800);
        this.tone('sine', pitch, pitch, .7, .14, .04);
        break;
      }
      case 'disconnect':
        this.noiseBurst(.03, .14, 'highpass', 1400);
        this.tone('square', 300, 150, .16, .08, .03);
        break;
      case 'reject':
        this.tone('sawtooth', 110, 95, .18, .16);
        break;
      case 'backup-warn':
        this.tone('sine', 660, 660, .14, .1);
        this.tone('sine', 660, 660, .14, .1, .3);
        break;
      case 'generator-stop': {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const t = ctx.currentTime;
        osc.frequency.setValueAtTime(92, t);
        osc.frequency.exponentialRampToValueAtTime(28, t + .75);
        const stutter = ctx.createOscillator();
        stutter.frequency.value = 13;
        const depth = ctx.createGain();
        depth.gain.value = .06;
        const gain = this.envGain(.12, .02, .78);
        stutter.connect(depth);
        depth.connect(gain.gain);
        osc.connect(gain);
        this.track(osc);
        this.track(stutter);
        stutter.start(t);
        stutter.stop(t + .8);
        osc.start(t);
        osc.stop(t + .85);
        break;
      }
      case 'decision':
        this.tone('sine', 392, 392, .22, .07);
        break;
      case 'sunrise': {
        const t = ctx.currentTime;
        for (const [index, frequency] of [220, 277.18, 329.63].entries()) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = frequency;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(.045, t + 2.6 + index * .3);
          gain.gain.setValueAtTime(.045, t + 4.5);
          gain.gain.linearRampToValueAtTime(0, t + 7);
          osc.connect(gain);
          gain.connect(this.master!);
          this.track(osc);
          osc.start(t);
          osc.stop(t + 7.2);
        }
        break;
      }
    }
  }

  // Restart: silence any ringing one-shots; beds re-derive from state on the next update.
  reset(): void {
    for (const source of this.oneShots) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.oneShots.clear();
    this.nextCrackle = 0;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (!this.ctx || !this.master) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(muted ? 0 : .9, this.ctx.currentTime, .15);
  }

  suspend(): void { void this.ctx?.suspend(); }
  resume(): void { if (!this._muted) void this.ctx?.resume(); }
  dispose(): void {
    this.reset();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
