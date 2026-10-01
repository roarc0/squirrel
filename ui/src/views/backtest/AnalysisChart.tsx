import { useMemo, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { chartGeometry, chartTickIndexes, nearestChartIndex } from '../../utils/visual';
import { eur } from './format';

export type ChartLine = { name: string; color: string; values: number[]; dashed?: boolean };

// Display only: all returns, drawdowns and rolling analyses arrive from Go.
export function AnalysisChart({
  dates,
  lines,
  title,
  money = false,
}: {
  dates: string[];
  lines: ChartLine[];
  title: string;
  money?: boolean;
}) {
  const { ref, width } = useElementSize();
  const [hover, setHover] = useState<number>();
  const w = Math.max(360, Math.round(width || 800));
  const geometry = useMemo(() => {
    const values = lines.map((line) => line.values.map((value) => (money ? value : value * 100)));
    const scale = values.flat();
    return values.map((row) => chartGeometry(row, scale, false, w));
  }, [lines, money, w]);
  const active = hover === undefined ? undefined : Math.min(hover, dates.length - 1);
  const fmt = (value: number) => (money ? eur(value) : `${value.toFixed(2)}%`);

  if (dates.length === 0 || lines.length === 0)
    return (
      <Text c="dimmed" size="sm" py="xl" ta="center">
        Not enough shared history for this analysis.
      </Text>
    );
  const first = geometry[0];
  return (
    <Stack gap="xs" ref={ref}>
      <Group gap="md" justify="center" mih={24}>
        {active !== undefined && (
          <Text size="xs" fw={600}>
            {dates[active]}
          </Text>
        )}
        {lines.map((line, i) => (
          <Group key={line.name} gap={5}>
            <Box w={14} h={3} bg={line.color} />
            <Text size="xs">
              {line.name}
              {active !== undefined && ` · ${fmt(money ? line.values[active] : line.values[active] * 100)}`}
            </Text>
          </Group>
        ))}
      </Group>
      <svg
        viewBox={`0 0 ${w} 255`}
        style={{ width: '100%', height: 255, display: 'block' }}
        role="img"
        aria-label={`${title}. Use left and right arrow keys to inspect dates.`}
        tabIndex={0}
        onPointerMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          setHover(nearestChartIndex(((e.clientX - b.left) / b.width) * w, dates.length, w));
        }}
        onPointerLeave={() => setHover(undefined)}
        onBlur={() => setHover(undefined)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            setHover(
              Math.max(0, Math.min(dates.length - 1, (active ?? 0) + (e.key === 'ArrowLeft' ? -1 : 1))),
            );
          }
        }}
      >
        <title>{title}</title>
        {[0, 1, 2, 3, 4].map((i) => {
          const value = first.high - ((first.high - first.low) * i) / 4;
          const y = 24 + (196 * i) / 4;
          return (
            <g key={i}>
              <line x1={74} x2={w - 20} y1={y} y2={y} stroke="currentColor" opacity={0.08} />
              <text x={66} y={y + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.55}>
                {money ? eur(value) : `${value.toFixed(1)}%`}
              </text>
            </g>
          );
        })}
        {geometry.map((g, i) => (
          <polyline
            key={lines[i].name}
            points={g.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={lines[i].color}
            strokeWidth={1.8}
            strokeDasharray={lines[i].dashed ? '5 4' : undefined}
          />
        ))}
        {chartTickIndexes(dates.length, w < 500 ? 3 : 5).map((i) => (
          <text
            key={i}
            x={first.points[i].x}
            y={244}
            textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill="currentColor"
            opacity={0.55}
          >
            {dates[i].slice(0, 7)}
          </text>
        ))}
        {active !== undefined && (
          <g>
            <line
              x1={first.points[active].x}
              x2={first.points[active].x}
              y1={24}
              y2={220}
              stroke="currentColor"
              strokeDasharray="3 3"
              opacity={0.3}
            />
            {geometry.map((g, i) => (
              <circle key={i} cx={g.points[active].x} cy={g.points[active].y} r={3} fill={lines[i].color} />
            ))}
          </g>
        )}
      </svg>
    </Stack>
  );
}
