import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../services/audioEngine';

interface EqualizerProps {
  isPlaying: boolean;
}

const Equalizer: React.FC<EqualizerProps> = ({ isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = audioEngine.getFrequencyData();
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas with a transparent or semi-transparent fill for trails
    ctx.clearRect(0, 0, width, height);
    
    const barWidth = (width / data.length) * 2.5;
    let barHeight;
    let x = 0;

    // Create gradient
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#4f46e5'); // Indigo 600
    gradient.addColorStop(0.5, '#ec4899'); // Pink 500
    gradient.addColorStop(1, '#a855f7'); // Purple 500

    ctx.fillStyle = gradient;

    for (let i = 0; i < data.length; i++) {
      barHeight = (data[i] / 255) * height;
      
      // Draw bars (fallback to regular rect for compatibility)
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, height - barHeight, barWidth, barHeight, [4, 4, 0, 0]);
      } else {
        ctx.rect(x, height - barHeight, barWidth, barHeight);
      }
      ctx.fill();

      x += barWidth + 1;
      
      if (x > width) break;
    }

    animationRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    if (isPlaying) {
      draw();
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      // One last draw to clear or show static
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying]);

  return (
    <div className="w-full h-full bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 shadow-inner relative">
      <div className="absolute top-2 left-3 text-xs font-mono text-zinc-500 z-10">SPECTRAL ANALYSIS</div>
      <canvas 
        ref={canvasRef} 
        width={300} 
        height={150} 
        className="w-full h-full opacity-80"
      />
    </div>
  );
};

export default Equalizer;