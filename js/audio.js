/* =========================================================
   Azure Labyrinth — small procedural audio engine
   ========================================================= */
(function () {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.started = false;
      this.ambientNodes = [];
      this.lastStep = 0;
      this.noiseBuffer = null;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(2.4);
      this.startAmbience();
      this.started = true;
    }

    makeNoise(seconds) {
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = 0.985 * last + 0.015 * white;
        data[i] = last * 3.2;
      }
      return buffer;
    }

    startAmbience() {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const bus = ctx.createGain();
      bus.gain.setValueAtTime(0.0001, now);
      bus.gain.exponentialRampToValueAtTime(0.045, now + 4);
      bus.connect(this.master);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.8;
      filter.connect(bus);

      const freqs = [55, 82.5, 110.2];
      freqs.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        osc.type = index === 2 ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        osc.detune.value = index === 0 ? -7 : index === 1 ? 4 : -2;
        const g = ctx.createGain();
        g.gain.value = index === 2 ? 0.015 : 0.032;
        osc.connect(g);
        g.connect(filter);
        osc.start();
        this.ambientNodes.push(osc, g);
      });

      // slow breathing wind layer
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 240;
      nf.Q.value = 0.45;
      const ng = ctx.createGain();
      ng.gain.value = 0.035;
      noise.connect(nf);
      nf.connect(ng);
      ng.connect(bus);
      noise.start();
      this.ambientNodes.push(noise, nf, ng);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.055;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 150;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
      this.ambientNodes.push(lfo, lfoGain);
    }

    setMuted(muted) {
      this.muted = muted;
      if (!this.master || !this.ctx) return;
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, now, 0.08);
    }

    step(strength = 1) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      if (now - this.lastStep < 0.16) return;
      this.lastStep = now;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260 + Math.random() * 100;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.02 * strength, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(now);
      src.stop(now + 0.22);
    }

    tone(freq, duration, type, volume, when = 0, slideTo = null) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    }

    mapOpen() {
      this.tone(440, 0.5, 'sine', 0.06, 0, 880);
      this.tone(220, 0.7, 'triangle', 0.035, 0.02, 330);
      this.noiseBurst(0.35, 900, 0.03);
    }

    mapClose() {
      this.tone(620, 0.35, 'sine', 0.04, 0, 300);
    }

    dash() {
      this.noiseBurst(0.28, 1500, 0.025);
      this.tone(170, 0.32, 'triangle', 0.035, 0, 320);
    }

    exhausted() {
      this.tone(180, 0.5, 'sine', 0.035, 0, 95);
      this.tone(120, 0.7, 'triangle', 0.02, 0.04, 70);
      this.noiseBurst(0.32, 420, 0.018);
    }

    noiseBurst(duration, frequency, volume) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = frequency;
      f.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(volume, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(now);
      src.stop(now + duration + 0.05);
    }

    discover() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((n, i) => {
        this.tone(n, 1.8, 'sine', 0.045, i * 0.09);
        this.tone(n * 2, 1.2, 'triangle', 0.012, i * 0.09);
      });
    }

    victory() {
      const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];
      notes.forEach((n, i) => {
        this.tone(n, 2.8, i < 3 ? 'triangle' : 'sine', 0.045, i * 0.16);
      });
      this.tone(130.81, 4.2, 'sine', 0.05, 0);
      this.noiseBurst(1.6, 1800, 0.02);
    }
  }

  window.AzureAudio = AudioEngine;
})();
