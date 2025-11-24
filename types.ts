
export enum NoteDuration {
  WHOLE = "1",
  HALF = "1/2",
  QUARTER = "1/4",
  EIGHTH = "1/8",
  SIXTEENTH = "1/16"
}

export interface NoteEvent {
  id: string;
  start_time: number; // seconds
  duration: number; // seconds
  midi_pitch: number;
  velocity: number; // 0-1
  confidence: number; // 0-1
  selected?: boolean;
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  sourceUrl: string | null;
  sourceType: 'file' | 'youtube' | 'mic';
}

export interface AnalysisMetric {
  time: number;
  energy: number;
  pitchConfidence: number;
}

// History & logging types
export interface UserEdits {
  notes_modified: number;
  notes_deleted: number;
  notes_added: number;
}

export interface ExportStatus {
  musicxml: boolean;
  midi: boolean;
  pdf: boolean;
  csv: boolean;
}

export type RetentionPolicy = '10_items' | '50_items' | '100_items' | '7_days' | '30_days' | 'forever';

export interface HistoryEntry {
  id: string;
  timestamp: string; // ISO string
  title: string;
  source_type: 'youtube' | 'file' | 'mic';
  source_url: string | null;
  audio_duration_sec: number;
  notes_count: number;
  avg_confidence: number;
  bpm_detected: number;
  time_signature: string;
  instrument_estimate: string;
  tags: string[];
  user_edits: UserEdits;
  exports: ExportStatus;
  thumbnail?: string; // Data URL or placeholder
}

export interface LabelSettings {
  showLabels: boolean;
  format: 'scientific' | 'note_only' | 'solfege';
  accidentalStyle: 'sharp' | 'flat' | 'double_sharp';
  showOctave: boolean;
  showCentOffset: boolean;
  position: 'above' | 'inside' | 'below';
  minConfidence: number;
  keyboardSize: 49 | 61 | 88;
}
