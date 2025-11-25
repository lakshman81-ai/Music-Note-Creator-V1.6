import { RhythmPattern } from '../components/constants';

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  // Track connected elements to prevent "already connected" errors
  private connectedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  // Track active oscillators for immediate stopping
  private activeOscillators = new Set<OscillatorNode>();

  // Rhythm Engine
  private nextNoteTime: number = 0;
  private currentBeatIndex: number = 0;
  private rhythmTimerID: number | null = null;
  private isRhythmPlaying: boolean = false;
  private currentPattern: RhythmPattern | null = null;
  private currentBpm: number = 120;

  constructor() {
    if (typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      }
    }
  }

  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.error("Failed to resume AudioContext", e);
      }
    }
  }

  get context() {
    return this.audioContext;
  }

  connectElement(element: HTMLMediaElement) {
    if (!this.audioContext || !this.analyser) return;
    
    // If already connected, we still ensure the path to destination is open
    // in case the graph was disrupted, but we don't create a new source.
    if (this.connectedElements.has(element)) {
      const existingSource = this.connectedElements.get(element);
      if (existingSource) {
        try {
          // Re-ensure connection to analyser (idempotent usually)
          existingSource.connect(this.analyser);
          this.analyser.connect(this.audioContext.destination);
        } catch (e) {
          // Ignore errors if already connected
        }
      }
      return;
    }

    try {
      // Create new source
      const source = this.audioContext.createMediaElementSource(element);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      
      // Store reference
      this.connectedElements.set(element, source);
      this.source = source;
    } catch (e) {
      console.warn("Audio source connection failed", e);
    }
  }

  getFrequencyData(): Uint8Array {
    if (!this.analyser || !this.dataArray) return new Uint8Array(0);
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  /**
   * Synthesize a tone for a specific MIDI pitch using instrument-specific parameters
   * @param midiPitch The MIDI note number
   * @param duration Duration in seconds
   * @param voice The instrument voice ID
   */
  playTone(midiPitch: number, duration: number = 0.5, voice: string = 'piano') {
    if (!this.audioContext) return;

    // Resume if suspended (user interaction requirement)
    this.resume();

    const now = this.audioContext.currentTime;
    const frequency = 440 * Math.pow(2, (midiPitch - 69) / 12);
    const masterGain = this.audioContext.createGain();
    masterGain.connect(this.audioContext.destination);

    // Timbre Synthesis Logic
    if (voice.startsWith('harmonium') || voice === 'shenai') {
        // Reed-like sound (Sawtooth/Square mix)
        const osc1 = this.audioContext.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = frequency;

        const osc2 = this.audioContext.createOscillator();
        osc2.type = 'square';
        osc2.frequency.value = frequency;
        osc2.detune.value = 5; // Mild vibrato

        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = voice === 'shenai' ? 3000 : 1500;
        filter.Q.value = 1;

        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(0.4, now + 0.05); // Slower attack
        masterGain.gain.setValueAtTime(0.4, now + duration);
        masterGain.gain.linearRampToValueAtTime(0, now + duration + 0.1); // Quick release

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + duration + 0.1);
        osc2.stop(now + duration + 0.1);
        this.activeOscillators.add(osc1);
        this.activeOscillators.add(osc2);
        osc1.onended = () => { this.activeOscillators.delete(osc1); this.activeOscillators.delete(osc2); };

    } else if (voice === 'sitar' || voice === 'veena' || voice.startsWith('guitar')) {
        // Plucked String (Sawtooth with Envelope Filter)
        const osc = this.audioContext.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = frequency;

        // Filter Envelope
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 4;
        filter.frequency.setValueAtTime(300, now);
        filter.frequency.exponentialRampToValueAtTime(3000, now + 0.05); // Pluck
        filter.frequency.exponentialRampToValueAtTime(500, now + duration);

        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(0.5, now + 0.01);
        masterGain.gain.exponentialRampToValueAtTime(0.01, now + duration + 0.5); // Long ring

        osc.connect(filter);
        filter.connect(masterGain);

        // Sympathetic String Drone (Sitar only)
        if (voice === 'sitar') {
             const drone = this.audioContext.createOscillator();
             drone.type = 'triangle';
             drone.frequency.value = frequency * 1.5; // Fifth
             const dGain = this.audioContext.createGain();
             dGain.gain.value = 0.1;
             drone.connect(dGain);
             dGain.connect(masterGain);
             drone.start(now);
             drone.stop(now + duration + 0.5);
             this.activeOscillators.add(drone);
        }

        osc.start(now);
        osc.stop(now + duration + 0.5);
        this.activeOscillators.add(osc);
        osc.onended = () => this.activeOscillators.delete(osc);

    } else if (voice === 'synth_lead' || voice === 'synth_pad') {
        const osc = this.audioContext.createOscillator();
        osc.type = voice === 'synth_lead' ? 'square' : 'triangle';
        osc.frequency.value = frequency;

        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(0.3, now + 0.1);
        masterGain.gain.linearRampToValueAtTime(0, now + duration + 0.2);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.2);
        this.activeOscillators.add(osc);
        osc.onended = () => this.activeOscillators.delete(osc);

    } else if (voice === 'bansuri') {
        const osc = this.audioContext.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;

        // Breath noise (White noise)
        const bufferSize = this.audioContext.sampleRate * 2;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.audioContext.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const noiseFilter = this.audioContext.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = frequency;
        noiseFilter.Q.value = 1;

        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.value = 0.1;

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);

        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(0.4, now + 0.1); // Soft attack
        masterGain.gain.linearRampToValueAtTime(0, now + duration + 0.1);

        osc.connect(masterGain);
        osc.start(now);
        noise.start(now);

        osc.stop(now + duration + 0.1);
        noise.stop(now + duration + 0.1);

        this.activeOscillators.add(osc);
        osc.onended = () => this.activeOscillators.delete(osc);

    } else {
        // Default (Piano-ish)
        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(0.3, now + 0.015);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 1.5);

        const osc1 = this.audioContext.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(frequency, now);
        osc1.connect(masterGain);

        const osc2 = this.audioContext.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(frequency, now);
        osc2.detune.setValueAtTime(4, now);
        const gain2 = this.audioContext.createGain();
        gain2.gain.value = 0.5;
        osc2.connect(gain2);
        gain2.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + duration + 1.0);
        osc2.stop(now + duration + 1.0);

        this.activeOscillators.add(osc1);
        this.activeOscillators.add(osc2);
        osc1.onended = () => { this.activeOscillators.delete(osc1); this.activeOscillators.delete(osc2); };
    }
  }

  // --- Rhythm Engine ---

  playDrumSound(sound: string, velocity: number) {
      if (!this.audioContext) return;
      const t = this.audioContext.currentTime;

      const gain = this.audioContext.createGain();
      gain.gain.setValueAtTime(velocity, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
      gain.connect(this.audioContext.destination);

      if (sound === 'kick' || sound === 'tabla_ge' || sound === 'tabla_dha') {
          const osc = this.audioContext.createOscillator();
          osc.frequency.setValueAtTime(150, t);
          osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
          osc.connect(gain);
          osc.start(t);
          osc.stop(t + 0.5);
      }

      if (sound === 'snare' || sound === 'tabla_na' || sound === 'tabla_tin' || sound.includes('hihat')) {
          // Noise
          const bufferSize = this.audioContext.sampleRate * 0.5;
          const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

          const noise = this.audioContext.createBufferSource();
          noise.buffer = buffer;

          const filter = this.audioContext.createBiquadFilter();
          if (sound.includes('hihat')) {
              filter.type = 'highpass';
              filter.frequency.value = 7000;
              gain.gain.exponentialRampToValueAtTime(0.01, t + (sound === 'hihat_open' ? 0.3 : 0.05));
          } else if (sound === 'tabla_na') {
              filter.type = 'bandpass';
              filter.frequency.value = 3000;
              filter.Q.value = 5; // Resonant ring
          } else {
              filter.type = 'lowpass';
              filter.frequency.value = 2000;
          }

          noise.connect(filter);
          filter.connect(gain);
          noise.start(t);
      }

      if (sound === 'tabla_tin' || sound === 'tabla_dha') {
           // Resonant metallic ping
           const osc = this.audioContext.createOscillator();
           osc.type = 'sine';
           osc.frequency.setValueAtTime(300, t);
           const pGain = this.audioContext.createGain();
           pGain.gain.setValueAtTime(0.3, t);
           pGain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
           osc.connect(pGain);
           pGain.connect(this.audioContext.destination);
           osc.start(t);
           osc.stop(t + 0.3);
      }
  }

  private scheduleNote() {
      if (!this.currentPattern || !this.audioContext) return;

      const secondsPerBeat = 60.0 / this.currentBpm;
      // Schedule ahead
      while (this.nextNoteTime < this.audioContext.currentTime + 0.1) {
          // Check if any steps on this beat
          const currentBeatInBar = this.currentBeatIndex % this.currentPattern.length;

          // Find steps that match current beat (or close to it for micro-timing)
          // Simplified: we only support integer/half beat steps in logic for now
          this.currentPattern.steps.forEach(step => {
              if (Math.abs(step.beat - currentBeatInBar) < 0.01) {
                   this.playDrumSound(step.sound, step.velocity);
              }
          });

          // Advance beat
          this.nextNoteTime += (secondsPerBeat * 0.5); // 8th note resolution
          this.currentBeatIndex += 0.5;
          if (this.currentBeatIndex >= this.currentPattern.length) {
              this.currentBeatIndex = 0;
          }
      }

      if (this.isRhythmPlaying) {
          this.rhythmTimerID = window.setTimeout(() => this.scheduleNote(), 25);
      }
  }

  startRhythm(pattern: RhythmPattern, bpm: number) {
      if (this.isRhythmPlaying) return;
      this.resume();
      this.currentPattern = pattern;
      this.currentBpm = bpm;
      this.currentBeatIndex = 0;
      this.nextNoteTime = this.audioContext?.currentTime || 0;
      this.isRhythmPlaying = true;
      this.scheduleNote();
  }

  stopRhythm() {
      this.isRhythmPlaying = false;
      if (this.rhythmTimerID) clearTimeout(this.rhythmTimerID);
  }

  /**
   * Immediately stops all currently playing synthesized tones.
   */
  stopAllTones() {
      this.stopRhythm();
      this.activeOscillators.forEach(osc => {
          try {
              osc.stop();
          } catch (e) {
              // Ignore errors if already stopped
          }
      });
      this.activeOscillators.clear();
  }

  /**
   * Decodes an audio file into an AudioBuffer for offline analysis
   */
  async loadAudioFile(file: File): Promise<AudioBuffer> {
      if (!this.audioContext) throw new Error("Audio Context not initialized");
      const arrayBuffer = await file.arrayBuffer();
      return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  /**
   * Performs offline pitch detection on a segment of audio
   * Uses Autocorrelation algorithm with enhanced filtering
   */
  analyzeAudioSegment(audioBuffer: AudioBuffer, startTime: number, duration: number): any[] {
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor((startTime + duration) * sampleRate);
      
      // Get data for the segment (Mono mixdown)
      const channelData = audioBuffer.getChannelData(0);
      const segmentData = channelData.slice(Math.max(0, startSample), Math.min(channelData.length, endSample));
      
      const notes: any[] = [];
      const windowSize = 2048; // ~46ms at 44.1kHz
      const hopSize = 1024;
      
      let currentNoteStart = -1;
      let currentNotePitch = -1;
      let framesInNote = 0;

      // RMS threshold to ignore silence/noise
      const rmsThreshold = 0.02;

      for (let i = 0; i < segmentData.length - windowSize; i += hopSize) {
          const chunk = segmentData.slice(i, i + windowSize);
          
          // 1. Calculate RMS (Volume)
          let sumSq = 0;
          for (let s = 0; s < chunk.length; s++) sumSq += chunk[s] * chunk[s];
          const rms = Math.sqrt(sumSq / chunk.length);

          if (rms < rmsThreshold) {
              // Silence - close previous note
              if (currentNoteStart !== -1) {
                   if (framesInNote > 4) { // Increased threshold for stability
                       notes.push({
                           start: startTime + (currentNoteStart / sampleRate),
                           duration: (i - currentNoteStart) / sampleRate,
                           pitch: currentNotePitch,
                           confidence: 0.8
                       });
                   }
                   currentNoteStart = -1;
                   framesInNote = 0;
              }
              continue;
          }

          // 2. Autocorrelation for Pitch
          const frequency = this.autoCorrelate(chunk, sampleRate);
          
          if (frequency > 0) {
              const midiPitch = Math.round(69 + 12 * Math.log2(frequency / 440));
              
              if (currentNoteStart === -1) {
                  // New Note
                  currentNoteStart = i;
                  currentNotePitch = midiPitch;
                  framesInNote = 1;
              } else if (Math.abs(midiPitch - currentNotePitch) > 1) {
                  // Pitch Changed -> End old note, start new
                  if (framesInNote > 4) { // Only save if stable for ~4 frames (~180ms)
                      notes.push({
                           start: startTime + (currentNoteStart / sampleRate),
                           duration: (i - currentNoteStart) / sampleRate,
                           pitch: currentNotePitch,
                           confidence: 0.85
                       });
                  }
                  currentNoteStart = i;
                  currentNotePitch = midiPitch;
                  framesInNote = 1;
              } else {
                  // Same note continuing (allow +/- 1 semitone vibrato)
                  framesInNote++;
              }
          }
      }

      // Close final note
      if (currentNoteStart !== -1 && framesInNote > 4) {
          notes.push({
               start: startTime + (currentNoteStart / sampleRate),
               duration: (segmentData.length - currentNoteStart) / sampleRate,
               pitch: currentNotePitch,
               confidence: 0.85
           });
      }

      return notes.map((n, idx) => ({
          id: `evt_real_${Math.floor(n.start * 1000)}_${idx}`,
          start_time: n.start,
          duration: Math.max(0.1, n.duration),
          midi_pitch: n.pitch,
          velocity: 0.7,
          confidence: n.confidence
      }));
  }

  private autoCorrelate(buffer: Float32Array, sampleRate: number): number {
      let SIZE = buffer.length;
      let rms = 0;
      for (let i = 0; i < SIZE; i++) {
          const val = buffer[i];
          rms += val * val;
      }
      rms = Math.sqrt(rms / SIZE);
      if (rms < 0.01) return -1; // Not enough signal

      // Autocorrelation
      let r1 = 0, r2 = SIZE - 1, thres = 0.2;
      for (let i = 0; i < SIZE / 2; i++) {
          if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
      }
      for (let i = 1; i < SIZE / 2; i++) {
          if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }
      }
      
      const buffer2 = buffer.slice(r1, r2);
      const c = new Array(buffer2.length).fill(0);
      for (let i = 0; i < buffer2.length; i++) {
          for (let j = 0; j < buffer2.length - i; j++) {
              c[i] = c[i] + buffer2[j] * buffer2[j + i];
          }
      }

      let d = 0; while (c[d] > c[d + 1]) d++;
      let maxval = -1, maxpos = -1;
      for (let i = d; i < buffer2.length; i++) {
          if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
      }
      
      let T0 = maxpos;
      if (T0 === -1) return -1;

      return sampleRate / T0;
  }
}

export const audioEngine = new AudioEngine();
