import React, { useRef, useEffect } from 'react';
import { NoteEvent } from '../types';
import { LabelSettings } from '../types';
import { formatPitch } from '../utils/pitchUtils';

interface SheetMusicProps {
  notes: NoteEvent[];
  currentTime: number;
  totalDuration: number;
  onNoteClick: (noteId: string) => void;
  selectedNoteId: string | null;
  labelSettings: LabelSettings;
}

const STAFF_LINE_SPACING = 10;
const PIXELS_PER_SECOND = 80; // Scale: 80px per 1 second of audio
const PADDING_LEFT = 40;

const SheetMusic: React.FC<SheetMusicProps> = ({ notes, currentTime, totalDuration, onNoteClick, selectedNoteId, labelSettings }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync scroll with playhead
  useEffect(() => {
    if (containerRef.current) {
      const playheadX = PADDING_LEFT + (currentTime * PIXELS_PER_SECOND);
      const targetScroll = playheadX - (containerRef.current.clientWidth / 2);
      
      // Auto-scroll logic: only if off-center by a margin
      if (Math.abs(containerRef.current.scrollLeft - targetScroll) > 100) {
        containerRef.current.scrollTo({
            left: Math.max(0, targetScroll),
            behavior: 'smooth'
        });
      }
    }
  }, [currentTime]);

  const getYForPitch = (midiPitch: number) => {
    const semitoneDiff = midiPitch - 71; // 71 is B4
    return 80 - (semitoneDiff * (STAFF_LINE_SPACING / 2));
  };

  const renderStaffLines = (width: number) => {
    const lines = [];
    for (let i = 0; i < 5; i++) {
      const y = 60 + (i * STAFF_LINE_SPACING);
      lines.push(
        <line key={`line-${i}`} x1={0} y1={y} x2={width} y2={y} stroke="#52525b" strokeWidth="1" />
      );
    }
    return lines;
  };

  // Generate ticks for the ruler
  const renderRuler = (width: number) => {
      const ticks = [];
      const totalSeconds = Math.ceil(width / PIXELS_PER_SECOND);
      
      for (let s = 0; s <= totalSeconds; s++) {
          const x = PADDING_LEFT + (s * PIXELS_PER_SECOND);
          if (x > width) break;
          
          const isMajor = s % 5 === 0;
          
          ticks.push(
              <g key={`tick-${s}`}>
                  <line 
                      x1={x} 
                      y1={280} 
                      x2={x} 
                      y2={isMajor ? 290 : 285} 
                      stroke={isMajor ? "#a1a1aa" : "#52525b"} 
                      strokeWidth={isMajor ? 2 : 1} 
                  />
                  {isMajor && (
                      <text x={x} y={305} fontSize="10" fill="#a1a1aa" textAnchor="middle" fontFamily="monospace">
                          {new Date(s * 1000).toISOString().substr(14, 5)}
                      </text>
                  )}
              </g>
          );
      }
      return ticks;
  };

  // Ensure canvas is at least screen width, or duration based
  const minWidth = 1000;
  const computedWidth = PADDING_LEFT + (Math.max(1, totalDuration) * PIXELS_PER_SECOND) + 100; // Extra buffer
  const totalWidth = Math.max(minWidth, computedWidth);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[320px] overflow-x-auto bg-white rounded-lg shadow-sm relative select-none border border-zinc-200"
    >
      <svg width={totalWidth} height={320} className="absolute top-0 left-0">
        
        {/* Bar Lines (every 4 seconds approx as measure for viz only) */}
        {Array.from({ length: Math.floor(totalDuration / 4) + 1 }).map((_, i) => {
            const x = PADDING_LEFT + (i * 4 * PIXELS_PER_SECOND);
            return <line key={`bar-${i}`} x1={x} y1={60} x2={x} y2={100} stroke="#e4e4e7" strokeWidth="1" />;
        })}

        {renderStaffLines(totalWidth)}
        {renderRuler(totalWidth)}

        {/* Treble Clef */}
        <path 
            d="M 30 110 C 20 110 20 80 35 80 C 45 80 45 100 30 100 C 20 100 20 130 35 130 C 50 130 50 70 30 70 L 30 140 C 20 140 15 135 25 125"
            stroke="black"
            fill="none"
            strokeWidth="2"
            transform="scale(1.2)"
        />

        {/* Notes */}
        {notes.map((note) => {
            // Time-based X Position
            const x = PADDING_LEFT + (note.start_time * PIXELS_PER_SECOND);
            const y = getYForPitch(note.midi_pitch);
            const isSelected = selectedNoteId === note.id;
            
            let labelContent = null;
            if (labelSettings.showLabels && note.confidence >= labelSettings.minConfidence) {
                const labelData = formatPitch(note.midi_pitch, labelSettings);
                labelContent = labelData.display;
            }

            let labelY = y - 15;
            let labelFill = "#4f46e5";
            let fontSize = "10";
            
            if (labelSettings.position === 'below') {
                labelY = y + 25;
            } else if (labelSettings.position === 'inside') {
                labelY = y + 3;
                labelFill = "white";
                fontSize = "8";
            }

            return (
                <g 
                    key={note.id} 
                    onClick={(e) => { e.stopPropagation(); onNoteClick(note.id); }}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                >
                    {y < 60 && <line x1={x-10} y1={y} x2={x+10} y2={y} stroke="black" strokeWidth="1" />}
                    {y > 100 && <line x1={x-10} y1={y} x2={x+10} y2={y} stroke="black" strokeWidth="1" />}

                    <ellipse 
                        cx={x} 
                        cy={y} 
                        rx={6} 
                        ry={5} 
                        fill={isSelected ? "#4f46e5" : "black"} 
                        transform={`rotate(-20 ${x} ${y})`}
                    />
                    
                    <line 
                        x1={x + 5} 
                        y1={y} 
                        x2={x + 5} 
                        y2={y - 35} 
                        stroke={isSelected ? "#4f46e5" : "black"} 
                        strokeWidth="1.5" 
                    />

                    {labelContent && (
                        <text 
                            x={x} 
                            y={labelY} 
                            fontSize={fontSize} 
                            fontWeight="bold"
                            fill={labelFill} 
                            textAnchor="middle"
                            className="pointer-events-none select-none"
                            style={{ textShadow: labelSettings.position === 'inside' ? 'none' : '0 1px 2px rgba(255,255,255,0.8)' }}
                        >
                            {labelContent}
                        </text>
                    )}

                    {note.confidence < 0.8 && !labelContent && (
                        <text x={x} y={130} fontSize="10" fill="#ef4444" textAnchor="middle">?</text>
                    )}
                </g>
            );
        })}

        {/* Playhead */}
        <line 
            x1={PADDING_LEFT + (currentTime * PIXELS_PER_SECOND)} 
            y1={20} 
            x2={PADDING_LEFT + (currentTime * PIXELS_PER_SECOND)} 
            y2={300} 
            stroke="#ef4444" 
            strokeWidth="2"
            strokeDasharray="4"
            className="transition-all duration-75"
        />
      </svg>
    </div>
  );
};

export default SheetMusic;