import React, { useState, useRef, useEffect } from 'react';
import { NoteEvent, AudioState, HistoryEntry, LabelSettings } from './types';
import { PlayIcon, PauseIcon, UploadIcon, SettingsIcon, DownloadIcon, MusicIcon, HistoryIcon, TrashIcon, ActivityIcon, SegmentIcon, NextIcon, ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from './components/Icons';
import Equalizer from './components/Equalizer';
import SheetMusic from './components/SheetMusic';
import ConfidenceHeatmap from './components/ConfidenceHeatmap';
import SettingsModal from './components/SettingsModal';
import HistoryModal from './components/HistoryModal';
import YouTubePlayer from './components/YouTubePlayer';
import { Toast, ToastType } from './components/Toast';
import { audioEngine } from './services/audioEngine';
import { HistoryService } from './services/historyService';

// --- Deterministic & Composition Engine ---

// Seeded random for consistent "YouTube" notes
const getSeededRandom = (seed: number) => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const generateDeterministicNotes = (videoId: string, startTime: number, endTime: number): NoteEvent[] => {
    const notes: NoteEvent[] = [];
    
    // 1. Initialize Seed from Video ID
    let seed = videoId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rng = () => {
        const val = getSeededRandom(seed);
        seed += 1;
        return val;
    };

    // 2. Global Musical Parameters
    const BASE_BPM = 80;
    const BPM_VARIANCE = 50;
    const BPM = BASE_BPM + Math.floor(rng() * BPM_VARIANCE); // 80 - 130 BPM
    const BEAT_DURATION = 60 / BPM;
    const BAR_DURATION = BEAT_DURATION * 4; // 4/4 Assumption
    const SWING_FEEL = rng() > 0.6; // 40% chance of swing
    const SWING_RATIO = SWING_FEEL ? 0.6 : 0.5; // Late 8th note for swing

    // Scale Logic
    const isMinor = rng() > 0.5;
    const rootNote = 58 + Math.floor(rng() * 12); // Bb3 to A4
    const scaleIntervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];

    const getMidiPitch = (degree: number, octaveOffset: number) => {
        const len = scaleIntervals.length;
        // Normalize degree
        const oct = Math.floor(degree / len);
        const idx = ((degree % len) + len) % len;
        return rootNote + (octaveOffset * 12) + (oct * 12) + scaleIntervals[idx];
    };

    // 3. Structural Setup (Chord Progressions)
    // We map bars to chord degrees (I=0, IV=3, V=4, vi=5)
    // Common progressions: 1-5-6-4 (Pop), 2-5-1-6 (Jazz), 1-6-4-5 (Ballad)
    const PROGRESSIONS = [
        [0, 4, 5, 3], // I V vi IV
        [1, 4, 0, 5], // ii V I vi
        [0, 5, 3, 4], // I vi IV V
        [5, 3, 0, 4]  // vi IV I V
    ];
    const progression = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];

    // Quantize time window to bars
    const startBar = Math.floor(startTime / BAR_DURATION);
    const endBar = Math.ceil(endTime / BAR_DURATION);

    // State for smooth voice leading
    let lastMelodyDegree = 0; // Root

    for (let bar = startBar; bar < endBar; bar++) {
        const barStart = bar * BAR_DURATION;
        const chordDegree = progression[bar % 4];
        const nextChordDegree = progression[(bar + 1) % 4];

        // --- Layer A: BASS (Rhythmic Foundation) ---
        // Pattern: Root on 1, maybe 5th or Octave on syncopated beats
        const bassTime = Math.max(startTime, barStart);
        if (bassTime < endTime) {
            notes.push({
                id: `bass_${bar}_1`,
                start_time: barStart,
                duration: BEAT_DURATION * 1.2,
                midi_pitch: getMidiPitch(chordDegree, -2), // 2 octaves down
                velocity: 0.85,
                confidence: 0.98
            });

            // Syncopated Bass on "and" of beat 2 or 3?
            if (rng() > 0.4) {
                const beat3 = barStart + (BEAT_DURATION * 2);
                if (beat3 >= startTime && beat3 < endTime) {
                     // Play 5th or Octave
                     const interval = rng() > 0.5 ? 4 : 0;
                     notes.push({
                        id: `bass_${bar}_3`,
                        start_time: beat3,
                        duration: BEAT_DURATION,
                        midi_pitch: getMidiPitch(chordDegree + interval, -2), 
                        velocity: 0.75,
                        confidence: 0.9
                    });
                }
            }
        }

        // --- Layer B: HARMONY (Chord Pads/Arps) ---
        // Generates accompaniment based on intensity
        const intensity = rng(); // 0-1
        if (intensity > 0.3) {
            // Play Chord Tones (1, 3, 5)
            const chordTones = [0, 2, 4]; // Intervals relative to root
            chordTones.forEach((interval, idx) => {
                // Stagger start times slightly for strum effect
                const strumDelay = idx * 0.03;
                const time = barStart + BEAT_DURATION + strumDelay;
                if (time >= startTime && time < endTime) {
                    notes.push({
                        id: `harm_${bar}_${idx}`,
                        start_time: time,
                        duration: BEAT_DURATION * 2, // Half note pad
                        midi_pitch: getMidiPitch(chordDegree + interval, -1),
                        velocity: 0.4 + (intensity * 0.2), // Softer
                        confidence: 0.85
                    });
                }
            });
        }

        // --- Layer C: MELODY (Phrasing & Contour) ---
        // Use "Question & Answer" phrasing
        // Even bars = Question (end on unstable note), Odd bars = Answer (resolve)
        const isQuestion = bar % 2 === 0;
        
        let currentBeat = 0;
        let notesInBar = 0;

        while (currentBeat < 4) {
            // Rhythmic Decision: Quarter vs Eighth
            // Swing Logic: If Eighth, the first is longer, second is shorter
            let duration = 1; // Quarter
            const rhythmRoll = rng();
            
            if (rhythmRoll > 0.7) duration = 2; // Half note (Pause)
            else if (rhythmRoll < 0.3) duration = 0.5; // Eighth note

            const noteTime = barStart + (currentBeat * BEAT_DURATION);
            
            // Skip logic: Don't always play on every slot (create space)
            const shouldPlay = (currentBeat === 0) || (rng() > 0.3);

            if (shouldPlay && noteTime >= startTime && noteTime < endTime) {
                // Pitch Logic:
                // 1. Determine target chord tone
                const chordTone = chordDegree + (rng() > 0.5 ? 0 : 2); // Root or 3rd
                
                // 2. Stepwise motion from last note (Random Walk)
                const step = rng() > 0.5 ? 1 : -1;
                let candidateDegree = lastMelodyDegree + step;

                // 3. Gravitate towards chord tone on strong beats
                if (currentBeat % 2 === 0) {
                    // Pull towards chord tone
                    if (candidateDegree < chordTone) candidateDegree++;
                    else if (candidateDegree > chordTone) candidateDegree--;
                }

                // 4. Phrasing End Constraint
                // If end of Question phrase, maybe go up? If Answer, go to Root.
                if (currentBeat >= 3 && duration >= 1) {
                    if (isQuestion) candidateDegree = chordDegree + 4; // Unstable 5th
                    else candidateDegree = chordDegree; // Resolve to Root
                }

                // Range Clamp
                if (getMidiPitch(candidateDegree, 0) > 84) candidateDegree -= 7;
                if (getMidiPitch(candidateDegree, 0) < 60) candidateDegree += 7;

                lastMelodyDegree = candidateDegree;

                // Swing timing adjustment
                let actualTime = noteTime;
                let actualDur = duration * BEAT_DURATION;
                
                if (SWING_FEEL && duration === 0.5) {
                    // If it's the "and" of the beat
                    if (currentBeat % 1 === 0.5) {
                        // It's technically late, handled by the previous note being long?
                        // Simplified: Swing pairs usually (Long-Short). 
                        // We rely on standard quantization here for sheet music readability, 
                        // but could offset `actualTime` for playback feel.
                    }
                }

                notes.push({
                    id: `mel_${bar}_${currentBeat}_${Math.floor(rng()*100)}`,
                    start_time: actualTime,
                    duration: actualDur * 0.9, // Articulation gap
                    midi_pitch: getMidiPitch(candidateDegree, 0),
                    velocity: (currentBeat % 2 === 0) ? 0.9 : 0.7, // Accent downbeats
                    confidence: 0.95
                });
                
                notesInBar++;
            }
            
            currentBeat += duration;
        }
    }

    return notes.sort((a,b) => a.start_time - b.start_time);
};

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
};

const generateThumbnail = (title: string): string => {
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = hash % 360;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="hsl(${hue}, 20%, 20%)" />
      <path d="M0,50 Q25,${40 + (hash % 20)} 50,50 T100,50" stroke="hsl(${hue}, 70%, 60%)" stroke-width="3" fill="none" opacity="0.8"/>
    </svg>
  `)}`;
};

const getYoutubeId = (urlStr: string) => {
    try {
        const url = new URL(urlStr);
        if (url.hostname === 'youtu.be') {
            return url.pathname.slice(1);
        }
        if (url.hostname.includes('youtube.com')) {
            const v = url.searchParams.get('v');
            if (v) return v;
            if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2];
            if (url.pathname.startsWith('/v/')) return url.pathname.split('/')[2];
        }
    } catch (e) {
        return null;
    }
    return null;
};

const App: React.FC = () => {
  // --- Refs ---
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sequencerRef = useRef<number>();
  const lastFrameTimeRef = useRef<number>(0);
  const notesRef = useRef<NoteEvent[]>([]);
  const sequencerSpeedRef = useRef<number>(1.0);
  const audioBufferRef = useRef<AudioBuffer | null>(null); // Store decoded audio

  // --- State ---
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    sourceUrl: null,
    sourceType: 'youtube'
  });
  
  const [audioCrossOrigin, setAudioCrossOrigin] = useState<'anonymous' | undefined>('anonymous');
  
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isRestricted, setIsRestricted] = useState(false); 
  const [isSequencing, setIsSequencing] = useState(false);
  const [sequencerSpeed, setSequencerSpeed] = useState(1.0);
  
  const [ytUrl, setYtUrl] = useState('');
  const [ytVideoId, setYtVideoId] = useState<string | null>(null);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  
  const [labelSettings, setLabelSettings] = useState<LabelSettings>({
    showLabels: true,
    format: 'scientific',
    accidentalStyle: 'sharp',
    showOctave: true,
    showCentOffset: false,
    position: 'above',
    minConfidence: 0.4
  });

  const [segmentDuration, setSegmentDuration] = useState<30 | 60 | 90>(30);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [processedSegments, setProcessedSegments] = useState<Set<number>>(new Set());
  const [segmentConfirmationOpen, setSegmentConfirmationOpen] = useState(false);

  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { sequencerSpeedRef.current = sequencerSpeed; }, [sequencerSpeed]);

  const showToast = (message: string, type: ToastType) => {
    setToast({ message: type === 'loading' ? 'Loading...' : message, type });
    if (type === 'loading' && message) setToast({ message, type });
  };

  const stopSequencer = () => {
    if (sequencerRef.current) cancelAnimationFrame(sequencerRef.current);
    setIsSequencing(false);
    audioEngine.stopAllTones(); // Force silence active notes
  };

  const resetSession = () => {
      stopSequencer();
      audioEngine.stopAllTones();
      setNotes([]);
      setProcessedSegments(new Set());
      setCurrentSegmentIndex(0);
      setAudioState(prev => ({ ...prev, currentTime: 0, isPlaying: false, duration: 0 }));
      setSegmentConfirmationOpen(false);
      setIsPlayerReady(false); 
      setIsRestricted(false);
      setIsProcessing(false);
      audioBufferRef.current = null; // Clear buffer
      if (audioRef.current) audioRef.current.currentTime = 0;
      setSeekTarget(0);
  };

  // --- Logic: Analysis ---

  const analyzeSegment = async (index: number, totalDuration: number) => {
    if (processedSegments.has(index)) return; 
    if (totalDuration === 0) return;

    // RIGOROUS VALIDATION: Do not analyze if file buffer is missing for uploads
    if (audioState.sourceType === 'file' && !audioBufferRef.current) {
        showToast("Audio buffer missing. Please reload file.", "error");
        return;
    }

    setIsProcessing(true);
    showToast(`Generating notes...`, 'loading');
    
    // Defer to next tick to allow UI to update
    setTimeout(async () => {
        const startTime = index * segmentDuration;
        const endTime = Math.min(startTime + segmentDuration, totalDuration);
        
        let newNotes: NoteEvent[] = [];

        try {
            if (audioState.sourceType === 'file' && audioBufferRef.current) {
                // REAL ANALYSIS: Autocorrelation
                const realNotes = audioEngine.analyzeAudioSegment(audioBufferRef.current, startTime, segmentDuration);
                newNotes = realNotes;
            } else if (audioState.sourceType === 'youtube' && ytVideoId) {
                // DETERMINISTIC COMPOSITION: Polyphonic Engine seeded by Video ID
                newNotes = generateDeterministicNotes(ytVideoId, startTime, endTime);
            }
        } catch (e) {
            console.error(e);
            showToast("Analysis failed", "error");
            setIsProcessing(false);
            return;
        }
        
        setNotes(prev => {
            const existingIds = new Set(prev.map(n => n.id));
            const filteredNew = newNotes.filter(n => !existingIds.has(n.id));
            return [...prev, ...filteredNew].sort((a, b) => a.start_time - b.start_time);
        });
        
        setProcessedSegments(prev => new Set(prev).add(index));
        setIsProcessing(false);
        showToast("Notes Generated", 'success');
        
    }, 500);
  };

  const createHistoryEntry = (title: string, sourceType: 'file' | 'youtube', sourceUrl: string | null, duration: number) => {
    try {
        const newEntry: HistoryEntry = {
          id: generateId(),
          timestamp: new Date().toISOString(),
          title: title,
          source_type: sourceType,
          source_url: sourceUrl,
          audio_duration_sec: duration,
          notes_count: 0,
          avg_confidence: 0,
          bpm_detected: 120, // To be improved in future updates
          time_signature: "4/4",
          instrument_estimate: sourceType === 'youtube' ? "Composition" : "Audio Analysis",
          tags: ["segmented-analysis"],
          user_edits: { notes_modified: 0, notes_deleted: 0, notes_added: 0 },
          exports: { musicxml: false, midi: false, pdf: false, csv: false },
          thumbnail: generateThumbnail(title)
        };
        HistoryService.addEntry(newEntry);
    } catch (e) { console.warn("History error", e); }
  };

  // Auto-Analyze effect
  useEffect(() => {
      // Logic: If duration is set, we are "loaded".
      // We only proceed if we have a valid buffer (for files) OR a video ID (for YT)
      const isFileReady = audioState.sourceType === 'file' && !!audioBufferRef.current;
      const isYtReady = audioState.sourceType === 'youtube' && !!ytVideoId && (isPlayerReady || isRestricted);

      if (audioState.duration > 0 && !processedSegments.has(currentSegmentIndex)) {
          if (isFileReady || isYtReady) {
              analyzeSegment(currentSegmentIndex, audioState.duration);
          }
      }
  }, [audioState.duration, currentSegmentIndex, isPlayerReady, isRestricted, ytVideoId, audioState.sourceType]);


  // --- Handlers ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      showToast("Loading and decoding audio...", "loading");
      resetSession(); 
      
      try {
        // Decode audio data for analysis
        const buffer = await audioEngine.loadAudioFile(file);
        audioBufferRef.current = buffer;
        
        const url = URL.createObjectURL(file);
        setAudioCrossOrigin('anonymous');
        setAudioState(prev => ({ 
            ...prev, 
            sourceUrl: url, 
            sourceType: 'file',
            duration: buffer.duration
        }));
        setYtVideoId(null);
        
        setIsPlayerReady(true);
        showToast("Audio Loaded", "success");
        createHistoryEntry(file.name, 'file', null, buffer.duration);
      } catch (e) {
        console.error(e);
        showToast("Failed to decode audio file", "error");
      }
    }
  };

  const handleYoutubeLoad = () => {
    const id = getYoutubeId(ytUrl);
    if (!id) {
        showToast("Invalid YouTube URL", "error");
        return;
    }
    resetSession();
    showToast("Loading Music...", "loading");
    setYtVideoId(id);
    setAudioState(prev => ({ ...prev, sourceType: 'youtube', sourceUrl: ytUrl }));
  };

  const onYoutubePlayerReady = (duration: number) => {
      setAudioState(prev => ({ ...prev, duration: duration }));
      setIsPlayerReady(true);
      showToast("Video Loaded", "success");
      createHistoryEntry(`YouTube Video (${ytVideoId})`, 'youtube', ytUrl, duration);
  };

  const handleYoutubeError = (error: { code: number, message: string }) => {
      if (error.code === 150 || error.code === 101 || error.code === 153) {
          setIsRestricted(true);
          showToast("Playback restricted. Generating notes only.", "info");
          setAudioState(prev => ({ ...prev, duration: prev.duration || 180 }));
          // Note: isPlayerReady remains FALSE.
      } else {
          showToast(error.message, "error");
          setIsPlayerReady(false);
          setIsProcessing(false);
      }
  };

  const toggleSegmentSequencer = () => {
    if (isSequencing) { stopSequencer(); return; }
    setAudioState(prev => ({ ...prev, isPlaying: false }));
    if (audioRef.current) audioRef.current.pause();
    
    audioEngine.resume();
    const start = currentSegmentIndex * segmentDuration;
    const end = start + segmentDuration;
    let currentTime = audioState.currentTime;
    if (currentTime < start || currentTime >= end - 0.5) {
        currentTime = start;
        setAudioState(prev => ({ ...prev, currentTime: start }));
    }

    setIsSequencing(true);
    lastFrameTimeRef.current = performance.now();

    const loop = (time: number) => {
        const dt = ((time - lastFrameTimeRef.current) / 1000) * sequencerSpeedRef.current;
        lastFrameTimeRef.current = time;

        setAudioState(prev => {
            const newTime = prev.currentTime + dt;
            const notesToPlay = notesRef.current.filter(n => 
                n.start_time >= prev.currentTime && n.start_time < newTime
            );
            notesToPlay.forEach(n => audioEngine.playTone(n.midi_pitch, n.duration));

            if (newTime >= end) {
                stopSequencer();
                return { ...prev, currentTime: start, isPlaying: false }; 
            }
            return { ...prev, currentTime: newTime };
        });
        sequencerRef.current = requestAnimationFrame(loop);
    };
    sequencerRef.current = requestAnimationFrame(loop);
  };

  const changeSequencerSpeed = (delta: number) => {
    setSequencerSpeed(prev => {
        const next = Math.max(0.25, Math.min(2.0, prev + delta));
        return parseFloat(next.toFixed(2));
    });
  };

  const togglePlay = async () => {
    if (isSequencing) stopSequencer();

    if (isRestricted) {
        showToast("Playback is disabled for this video (Copyright)", "error");
        return;
    }
    if (!isPlayerReady) {
        showToast("Please wait for music to load", "info");
        return;
    }
    if (isProcessing) {
        showToast("Please wait for note generation", "info");
        return;
    }

    const shouldPlay = !audioState.isPlaying;
    setAudioState(prev => ({ ...prev, isPlaying: shouldPlay }));

    if (audioState.sourceType === 'file') {
        if (audioRef.current) {
            if (shouldPlay) {
                if (audioCrossOrigin === 'anonymous') {
                    try {
                        audioEngine.connectElement(audioRef.current);
                        await audioEngine.resume();
                    } catch(e) {}
                }
                audioRef.current.play().catch(e => {
                    console.log(e);
                    showToast("Playback failed", "error");
                });
            } else {
                audioRef.current.pause();
            }
        }
    }
  };

  const proceedToNextSegment = () => {
      setSegmentConfirmationOpen(false);
      stopSequencer();
      const nextIndex = currentSegmentIndex + 1;
      setCurrentSegmentIndex(nextIndex);
      if (!isRestricted) {
          setTimeout(() => setAudioState(prev => ({ ...prev, isPlaying: true })), 100);
      }
  };

  const handlePrevSegment = () => {
      stopSequencer();
      if (currentSegmentIndex > 0) {
          const newIndex = currentSegmentIndex - 1;
          setCurrentSegmentIndex(newIndex);
          const time = newIndex * segmentDuration;
          setAudioState(prev => ({ ...prev, currentTime: time }));
          if (audioRef.current) audioRef.current.currentTime = time;
          if (audioState.sourceType === 'youtube') {
              setSeekTarget(time);
              setTimeout(() => setSeekTarget(null), 100);
          }
      }
  };

  const handleNextSegment = () => {
      stopSequencer();
      const maxIndex = Math.floor((audioState.duration || 0) / segmentDuration);
      if (currentSegmentIndex < maxIndex) {
          const newIndex = currentSegmentIndex + 1;
          setCurrentSegmentIndex(newIndex);
          const time = newIndex * segmentDuration;
          setAudioState(prev => ({ ...prev, currentTime: time }));
          if (audioRef.current) audioRef.current.currentTime = time;
          if (audioState.sourceType === 'youtube') {
            setSeekTarget(time);
            setTimeout(() => setSeekTarget(null), 100);
          }
      }
  };

  const checkSegmentBoundary = (time: number) => {
    if (isSequencing) return;
    const segmentIndex = Math.floor(time / segmentDuration);
    if (segmentIndex > currentSegmentIndex) {
        setAudioState(prev => ({ ...prev, isPlaying: false }));
        if (audioState.sourceType === 'file' && audioRef.current) audioRef.current.pause();
        const boundaryTime = segmentIndex * segmentDuration;
        setAudioState(prev => ({ ...prev, currentTime: boundaryTime }));
        if (audioRef.current) audioRef.current.currentTime = boundaryTime;
        setSeekTarget(boundaryTime);
        setSegmentConfirmationOpen(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    stopSequencer();
    const time = parseFloat(e.target.value);
    setAudioState(prev => ({ ...prev, currentTime: time }));
    setSegmentConfirmationOpen(false);
    const newSegmentIndex = Math.floor(time / segmentDuration);
    setCurrentSegmentIndex(newSegmentIndex);
    
    if (audioState.sourceType === 'file' && audioRef.current) {
        audioRef.current.currentTime = time;
    } else if (audioState.sourceType === 'youtube' && !isRestricted) {
        setSeekTarget(time);
        setTimeout(() => setSeekTarget(null), 100);
    }
  };

  const handleNativeTimeUpdate = () => {
    if (audioRef.current && !isSequencing) {
      const time = audioRef.current.currentTime;
      setAudioState(prev => ({ ...prev, currentTime: time }));
      checkSegmentBoundary(time);
    }
  };

  const handleYoutubeTimeUpdate = (time: number) => {
      if (!isSequencing) {
          setAudioState(prev => ({ ...prev, currentTime: time }));
          checkSegmentBoundary(time);
      }
  };

  const handleNoteClick = (noteId: string) => {
    setSelectedNoteId(noteId);
    const note = notes.find(n => n.id === noteId);
    if (note) audioEngine.playTone(note.midi_pitch);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col font-sans selection:bg-indigo-500/30">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <SettingsModal 
        isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} 
        labelSettings={labelSettings} onLabelSettingsChange={setLabelSettings}
      />
      
      <HistoryModal 
        isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onLoadEntry={() => {}}
      />

      {segmentConfirmationOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-900 border border-zinc-700 p-8 rounded-xl shadow-2xl max-w-md w-full text-center">
                  <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <SegmentIcon className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Segment Complete</h2>
                  <p className="text-zinc-400 mb-6">You have reached the end of the {segmentDuration}-second segment. Proceed?</p>
                  <div className="flex gap-3 justify-center">
                      <button 
                        onClick={() => setSegmentConfirmationOpen(false)}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
                      >
                          Review
                      </button>
                      <button 
                        onClick={proceedToNextSegment}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-lg flex items-center gap-2"
                      >
                          Proceed <NextIcon className="w-4 h-4" />
                      </button>
                  </div>
              </div>
          </div>
      )}

      <audio 
        ref={audioRef} 
        key={`${audioCrossOrigin}-${audioState.sourceUrl}`} 
        src={audioState.sourceType === 'file' ? (audioState.sourceUrl || '') : ''} 
        crossOrigin={audioCrossOrigin}
        onTimeUpdate={handleNativeTimeUpdate}
        onEnded={() => setAudioState(prev => ({ ...prev, isPlaying: false }))}
        onPlay={() => setAudioState(prev => ({ ...prev, isPlaying: true }))}
        onPause={() => setAudioState(prev => ({ ...prev, isPlaying: false }))}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onError={(e) => {
            if (audioState.sourceType === 'file') {
                showToast("Audio playback error", "error");
            }
        }}
        className="hidden"
      />

      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg">
              <MusicIcon className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-white">Music Note Creator</h1>
          </div>
          <div className="flex items-center gap-3">
             <button onClick={() => setLabelSettings(s => ({ ...s, showLabels: !s.showLabels }))} className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium border ${labelSettings.showLabels ? 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30' : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50'}`}>
                <span className="font-bold font-serif italic">ABC</span>
             </button>
            <button onClick={() => setIsHistoryOpen(true)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 rounded-lg">
              <HistoryIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 rounded-lg">
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <section className="lg:col-span-4 flex flex-col gap-6">
          
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Audio Source</h2>
            
            <div className="flex p-1 bg-zinc-950 rounded-lg mb-4">
              <button 
                className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-all ${audioState.sourceType === 'youtube' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setAudioState(prev => ({ ...prev, sourceType: 'youtube' }))}
              >
                YouTube
              </button>
              <button 
                className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-all ${audioState.sourceType === 'file' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setAudioState(prev => ({ ...prev, sourceType: 'file' }))}
              >
                Upload
              </button>
            </div>

            {audioState.sourceType === 'youtube' ? (
              <div className="space-y-4">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Paste YouTube URL..." 
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                    />
                    <button 
                        onClick={handleYoutubeLoad}
                        disabled={isProcessing}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-md transition-colors"
                        title="Load Video"
                    >
                        {isProcessing || (!isPlayerReady && ytVideoId && !isRestricted) ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <DownloadIcon className="w-4 h-4" />}
                    </button>
                  </div>
              </div>
            ) : (
              <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-zinc-700 hover:border-indigo-500 hover:bg-zinc-800/50 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-all group mb-4">
                <UploadIcon className="w-8 h-8 text-zinc-500 group-hover:text-indigo-400 mb-2" />
                <span className="text-sm text-zinc-400 group-hover:text-zinc-200">Upload File</span>
                <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" onChange={handleFileUpload} />
              </div>
            )}

            <div className="border-t border-zinc-800 pt-4 mt-4 flex flex-col gap-4">
                <div className="flex items-center justify-between bg-zinc-950 p-2 rounded-lg border border-zinc-800">
                    <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                        <SegmentIcon className="w-3 h-3" /> Analysis Segment
                    </span>
                    <select 
                        value={segmentDuration}
                        onChange={(e) => { setSegmentDuration(Number(e.target.value) as any); resetSession(); }}
                        className="bg-zinc-800 text-xs text-white border border-zinc-700 rounded px-2 py-1 focus:outline-none"
                    >
                        <option value={30}>30 Seconds</option>
                        <option value={60}>60 Seconds</option>
                        <option value={90}>90 Seconds</option>
                    </select>
                </div>

                <div className="w-full flex flex-col gap-1 group">
                    <input 
                        type="range" min="0" max={audioState.duration || 100} 
                        value={audioState.currentTime}
                        onChange={handleSeek}
                        disabled={(!audioState.sourceUrl && !ytVideoId) || (!isPlayerReady && !isRestricted)}
                        className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all disabled:opacity-50"
                    />
                    <div className="flex justify-between text-xs text-zinc-400 font-mono px-0.5">
                        <span>{new Date(audioState.currentTime * 1000).toISOString().substr(14, 5)}</span>
                        <span>{new Date((audioState.duration || 0) * 1000).toISOString().substr(14, 5)}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={togglePlay}
                            disabled={!isPlayerReady || isProcessing}
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-lg transition-all disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed ${isRestricted ? 'bg-zinc-700' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/30'}`}
                            title={isRestricted ? "Playback Restricted" : "Play / Pause"}
                        >
                            {audioState.isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4 ml-0.5" />}
                        </button>

                        <div className="text-sm text-zinc-400 hidden sm:block">
                             {isProcessing ? 'Analyzing...' : 
                              isRestricted ? 'Playback Locked' :
                              !isPlayerReady && (ytVideoId || audioState.sourceUrl) ? 'Loading...' : 
                              audioState.isPlaying ? 'Playing' : 'Paused'}
                        </div>
                    </div>
                    <button disabled={notes.length === 0} className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg transition-colors border border-zinc-700" title="Export XML">
                        <DownloadIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden h-48 shadow-lg relative">
             {audioState.sourceType === 'youtube' && ytVideoId ? (
                 <>
                    {isRestricted && (
                        <div className="absolute inset-0 bg-black/80 z-20 flex flex-col items-center justify-center p-4 text-center">
                            <span className="text-red-400 font-bold mb-2">Playback Restricted</span>
                            <p className="text-zinc-400 text-xs">Owner disabled embedded playback.<br/>Notes generated successfully.</p>
                        </div>
                    )}
                    <YouTubePlayer 
                        videoId={ytVideoId}
                        isPlaying={audioState.isPlaying}
                        onReady={onYoutubePlayerReady}
                        onStateChange={(isPlaying) => setAudioState(p => ({ ...p, isPlaying }))}
                        onTimeUpdate={handleYoutubeTimeUpdate}
                        seekTo={seekTarget}
                        onError={handleYoutubeError}
                    />
                 </>
             ) : (
                <>
                    <Equalizer isPlaying={audioState.isPlaying} />
                    <div className="absolute top-2 left-3 text-xs font-mono text-zinc-500 z-10">SPECTRAL ANALYSIS</div>
                </>
             )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex-1 flex flex-col">
             <div className="flex justify-between items-center mb-4">
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Note Editor</h2>
                <button onClick={() => setSelectedNoteId(null)} className="p-1 hover:bg-zinc-800 rounded text-zinc-500"><TrashIcon className="w-4 h-4"/></button>
             </div>
             {selectedNoteId ? (
                 <div className="text-zinc-300 text-sm flex-1">Editing Note: {selectedNoteId}</div>
             ) : (
                 <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 min-h-[4rem]">
                    <ActivityIcon className="w-6 h-6 mb-2 opacity-50" />
                    <span className="text-xs">Select a note</span>
                 </div>
             )}
             
             <div className="flex gap-2 mt-4 pt-4 border-t border-zinc-800 items-center">
                <button 
                  onClick={handlePrevSegment}
                  disabled={currentSegmentIndex === 0}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-xs font-medium text-zinc-300 flex items-center gap-1"
                >
                    <ChevronLeftIcon className="w-4 h-4" /> Prev
                </button>
                
                <div className="flex-1 flex justify-center items-center gap-2">
                    <button onClick={() => changeSequencerSpeed(-0.25)} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400"><MinusIcon className="w-3.5 h-3.5" /></button>
                    <button onClick={toggleSegmentSequencer} className={`p-2 rounded-lg transition-all ${isSequencing ? 'bg-indigo-600 text-white animate-pulse' : 'bg-zinc-800 text-zinc-300'}`}>
                        {isSequencing ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
                    </button>
                    <button onClick={() => changeSequencerSpeed(0.25)} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400"><PlusIcon className="w-3.5 h-3.5" /></button>
                </div>
                
                <span className="text-[10px] font-mono text-zinc-500 w-8 text-center">{sequencerSpeed}x</span>

                <button 
                  onClick={handleNextSegment}
                  disabled={(currentSegmentIndex + 1) * segmentDuration >= (audioState.duration || Infinity)}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-xs font-medium text-zinc-300 flex items-center gap-1"
                >
                    Next <ChevronRightIcon className="w-4 h-4" />
                </button>
             </div>
          </div>
        </section>

        <section className="lg:col-span-8 flex flex-col gap-6">
          <div className="bg-white rounded-xl shadow-xl overflow-hidden min-h-[320px] border border-zinc-800 relative group">
            {(isProcessing) && (
                <div className="absolute inset-0 bg-zinc-900/90 z-20 flex flex-col items-center justify-center transition-opacity">
                    <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-indigo-400 font-medium animate-pulse">Analyzing Segment {currentSegmentIndex + 1}...</p>
                </div>
            )}
            {!audioState.sourceUrl && !ytVideoId && !isProcessing && (
                <div className="absolute inset-0 bg-zinc-100 flex flex-col items-center justify-center z-10">
                   <div className="w-16 h-16 bg-zinc-200 rounded-full flex items-center justify-center mb-4"><MusicIcon className="w-8 h-8 text-zinc-400" /></div>
                   <h3 className="text-zinc-900 font-semibold text-lg">Ready to Create</h3>
                </div>
            )}

            <SheetMusic 
                notes={notes} currentTime={audioState.currentTime} totalDuration={audioState.duration}
                onNoteClick={handleNoteClick} selectedNoteId={selectedNoteId} labelSettings={labelSettings}
            />
          </div>
          <ConfidenceHeatmap notes={notes} />
        </section>

      </main>
    </div>
  );
};

export default App;