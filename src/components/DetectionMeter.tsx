import { useEffect, useState } from 'react';

type Props = {
  value: number;
  isHateful: boolean;
};

export default function DetectionMeter({ value, isHateful }: Props) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 800;
    const start = performance.now();
    let frame: number;

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(eased * value));
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const color = isHateful
    ? value >= 85
      ? '#dc2626'
      : value >= 65
        ? '#ea580c'
        : value >= 45
          ? '#d97706'
          : '#eab308'
    : '#16a34a';

  const segments = 20;
  const filledSegments = Math.round((displayValue / 100) * segments);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-end gap-1 h-20">
        {Array.from({ length: segments }).map((_, i) => {
          const isActive = i < filledSegments;
          const height = 30 + (i / segments) * 70;
          return (
            <div
              key={i}
              className="w-2 rounded-sm transition-all duration-300"
              style={{
                height: `${height}%`,
                backgroundColor: isActive ? color : '#e5e7eb',
                opacity: isActive ? 1 : 0.4,
                transform: isActive ? 'scaleY(1)' : 'scaleY(0.8)',
              }}
            />
          );
        })}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-4xl font-bold tabular-nums transition-colors duration-500"
          style={{ color }}
        >
          {displayValue}
        </span>
        <span className="text-lg font-medium text-gray-400">%</span>
      </div>
    </div>
  );
}
