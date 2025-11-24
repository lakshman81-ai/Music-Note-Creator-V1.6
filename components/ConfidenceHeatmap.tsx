import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { NoteEvent } from '../types';

interface HeatmapProps {
  notes: NoteEvent[];
}

const ConfidenceHeatmap: React.FC<HeatmapProps> = ({ notes }) => {
  const data = notes.map(n => ({
    time: n.start_time.toFixed(1),
    confidence: n.confidence,
    pitch: n.midi_pitch
  }));

  return (
    <div className="h-48 w-full bg-zinc-900 rounded-lg p-4 border border-zinc-800">
      <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">ML Confidence & Pitch Tracking</h3>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorConf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis dataKey="time" hide />
          <YAxis domain={[0, 1]} hide />
          <Tooltip 
            contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '4px', fontSize: '12px' }}
            itemStyle={{ color: '#e4e4e7' }}
          />
          <Area type="monotone" dataKey="confidence" stroke="#10b981" fillOpacity={1} fill="url(#colorConf)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ConfidenceHeatmap;