import { useMemo } from 'react';
import { encodeCode128B } from '../utils/code128.js';

export default function BarcodeSvg({ value, className, modulePx = 1, height = 48 }) {
  const { bars, width } = useMemo(() => {
    const { segments, totalModules } = encodeCode128B(value || '');
    const renderedBars = [];
    let cursor = 0;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const segmentWidth = segment.width * modulePx;
      if (segment.black) {
        renderedBars.push({ key: index, x: cursor, width: segmentWidth });
      }
      cursor += segmentWidth;
    }

    return { bars: renderedBars, width: totalModules * modulePx };
  }, [modulePx, value]);

  if (!width) return null;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Cod de bare ${value}`}
    >
      {bars.map((bar) => (
        <rect key={bar.key} x={bar.x} y="0" width={bar.width} height={height} fill="#000" />
      ))}
    </svg>
  );
}
