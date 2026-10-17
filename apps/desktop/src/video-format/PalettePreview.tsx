import { useEffect, useRef, type RefObject } from 'react';
import { drawPaletteBackground } from '../services/video-palette-background';
import { gradientColors, type RatioRule } from './model';
export function PalettePreview({ video, rule, aspect }: { video: RefObject<HTMLVideoElement | null>; rule: RatioRule; aspect: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const scratch = document.createElement('canvas'); let request = 0;
    const draw = () => {
      const source = video.current, target = canvas.current;
      if (target && source && source.readyState >= 2) {
        const context = target.getContext('2d');
        if (context) drawPaletteBackground(context, source, source.videoWidth, source.videoHeight, target.width, target.height, { colors: gradientColors(rule), intensity: rule.intensity }, scratch);
      }
      request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw); return () => cancelAnimationFrame(request);
  }, [video, rule, aspect]);
  return <canvas className="vfb-palette-preview" ref={canvas} width={192} height={aspect === '9:16' ? 341 : 108} aria-hidden="true" />;
}
