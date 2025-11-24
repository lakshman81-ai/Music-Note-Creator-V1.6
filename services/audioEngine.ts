export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  // Track connected elements to prevent "already connected" errors
  private connectedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  // Track active oscillators for immediate stopping
  private activeOscillators = new Set<OscillatorNode>();

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
   * Synthesize a tone for a specific MIDI pitch using a piano-like synthesis
   * @param midiPitch The MIDI note number (e.g., 60 for Middle C)
   * @param duration Duration in seconds
   */
  playTone(midiPitch: number, duration: number = 0.5) {
    if (!this.audioContext) return;

    // Resume if suspended (user interaction requirement)
    this.resume();

    const now = this.audioContext.currentTime;
    const frequency = 440 * Math.pow(2, (midiPitch - 69) / 12);

    // Master Gain for this note
    const masterGain = this.audioContext.createGain();
    masterGain.connect(this.audioContext.destination);
    
    // Envelope
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.3, now + 0.015); // Fast Attack
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 1.5); // Long release/decay

    // 1. Fundamental Oscillator (Triangle/Sine hybrid)
    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(frequency, now);
    osc1.connect(masterGain);

    // 2. Second Oscillator (Sine - adds body)
    const osc2 = this.audioContext.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(frequency, now);
    // Detune slightly for chorus effect
    osc2.detune.setValueAtTime(4, now);

    const gain2 = this.audioContext.createGain();
    gain2.gain.value = 0.5;
    osc2.connect(gain2);
    gain2.connect(masterGain);

    // 3. Harmonics (Sawtooth - adds brightness/hammer strike)
    const osc3 = this.audioContext.createOscillator();
    osc3.type = 'sawtooth';
    osc3.frequency.setValueAtTime(frequency, now);

    const gain3 = this.audioContext.createGain();
    // Decay brightness quickly to simulate hammer strike
    gain3.gain.setValueAtTime(0.1, now);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    // Filter the sawtooth to remove harshness
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency * 4, now);

    osc3.connect(gain3);
    gain3.connect(filter);
    filter.connect(masterGain);

    // Start all
    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    // Stop all
    const stopTime = now + duration + 1.0; // Allow tail
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);

    // Track active oscillators
    [osc1, osc2, osc3].forEach(osc => this.activeOscillators.add(osc));
    osc1.onended = () => {
        [osc1, osc2, osc3].forEach(osc => this.activeOscillators.delete(osc));
    };
  }

  /**
   * Immediately stops all currently playing synthesized tones.
   */
  stopAllTones() {
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