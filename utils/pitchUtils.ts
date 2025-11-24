import { NoteEvent } from '../types';

export interface NoteLabel {
  display: string;
  isAccidental: boolean;
  octave?: number;
}

export const formatPitch = (
  midiPitch: number,
  settings: {
    format: 'scientific' | 'note_only' | 'solfege';
    accidentalStyle: 'sharp' | 'flat' | 'double_sharp';
    showOctave: boolean;
  }
): NoteLabel => {
  const noteNamesSharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteNamesFlat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const solfegeNames = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];
  
  const octave = Math.floor(midiPitch / 12) - 1;
  const semitone = midiPitch % 12;

  let baseName = '';
  let isAccidental = false;

  if (settings.format === 'solfege') {
    // Simplified Fixed-do for demo
    baseName = solfegeNames[semitone];
    isAccidental = baseName.length === 2 && baseName.endsWith('i'); // Rough approximation
  } else {
    // Standard names
    const useSharps = settings.accidentalStyle !== 'flat'; // Default to sharp for simplicity
    const names = useSharps ? noteNamesSharp : noteNamesFlat;
    baseName = names[semitone];
    isAccidental = baseName.includes('#') || baseName.includes('b');
    
    if (settings.accidentalStyle === 'double_sharp' && isAccidental && useSharps) {
        // Rudimentary logic: pure display replacement for demo purposes
        // Real double-sharp logic requires key signature context
        if (baseName.includes('#')) baseName = baseName.replace('#', 'x');
    } else if (settings.accidentalStyle === 'flat' && isAccidental && !useSharps) {
       if (baseName.includes('b')) baseName = baseName.replace('b', '♭');
    } else if (settings.accidentalStyle === 'sharp' && isAccidental && useSharps) {
       if (baseName.includes('#')) baseName = baseName.replace('#', '♯');
    }
  }

  // Formatting output
  let display = baseName;
  if (settings.showOctave && settings.format !== 'note_only') {
    display += octave;
  }

  return { display, isAccidental, octave };
};
