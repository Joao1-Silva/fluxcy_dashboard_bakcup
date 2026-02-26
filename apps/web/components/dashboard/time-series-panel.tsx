'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Expand, Minimize2 } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumeric, formatTimeLabel } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { SeriesPoint } from '@/types/dashboard';

type SeriesLine = {
  key: string;
  label: string;
  color: string;
};

type TimeSeriesPanelProps = {
  title: string;
  subtitle?: string;
  data: SeriesPoint[];
  lines: SeriesLine[];
  loading?: boolean;
  rightActions?: ReactNode;
};

type LineStats = {
  latest: number;
  min: number;
  max: number;
  avg: number;
  points: number;
};

function buildLineStats(data: SeriesPoint[], lineKey: string): LineStats | null {
  const values = data
    .map((row) => row[lineKey])
    .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : null))
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return null;
  }

  const latest = values[values.length - 1];
  const min = values.reduce((acc, value) => Math.min(acc, value), values[0]);
  const max = values.reduce((acc, value) => Math.max(acc, value), values[0]);
  const avg = values.reduce((acc, value) => acc + value, 0) / values.length;

  return {
    latest,
    min,
    max,
    avg,
    points: values.length,
  };
}

export function TimeSeriesPanel({
  title,
  subtitle,
  data,
  lines,
  loading = false,
  rightActions,
}: TimeSeriesPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [fallbackExpanded, setFallbackExpanded] = useState(false);
  const [nativeExpanded, setNativeExpanded] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);

  const isExpanded = fallbackExpanded || nativeExpanded;
  const activeSelectedLineKey = useMemo(
    () => (selectedLineKey && lines.some((line) => line.key === selectedLineKey) ? selectedLineKey : null),
    [lines, selectedLineKey],
  );
  const selectedLine = useMemo(
    () => lines.find((line) => line.key === activeSelectedLineKey) ?? null,
    [activeSelectedLineKey, lines],
  );
  const selectedStats = useMemo(
    () => (activeSelectedLineKey ? buildLineStats(data, activeSelectedLineKey) : null),
    [activeSelectedLineKey, data],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const media = window.matchMedia('(max-width: 640px)');
    const setCompact = () => setIsCompact(media.matches);

    setCompact();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', setCompact);
      return () => media.removeEventListener('change', setCompact);
    }

    media.addListener(setCompact);
    return () => media.removeListener(setCompact);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const onFullscreenChange = () => {
      const expanded = document.fullscreenElement === panelRef.current;
      setNativeExpanded(expanded);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!fallbackExpanded || typeof window === 'undefined') {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFallbackExpanded(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fallbackExpanded]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (fallbackExpanded) {
      document.body.classList.add('panel-overlay-open');
    } else {
      document.body.classList.remove('panel-overlay-open');
    }

    return () => document.body.classList.remove('panel-overlay-open');
  }, [fallbackExpanded]);

  const chartHeightClass = useMemo(() => {
    if (isExpanded) {
      return 'h-[calc(100dvh-180px)] min-h-[320px]';
    }
    return 'h-[240px] sm:h-[290px]';
  }, [isExpanded]);

  const toggleExpand = async () => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    if (isExpanded) {
      setFallbackExpanded(false);
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
      }
      return;
    }

    try {
      if (typeof panel.requestFullscreen === 'function') {
        await panel.requestFullscreen();
        return;
      }
    } catch {
      setFallbackExpanded(true);
      return;
    }

    setFallbackExpanded(true);
  };

  return (
    <div
      ref={panelRef}
      className={cn(
        'chart-panel relative',
        fallbackExpanded ? 'fixed inset-0 z-[70] overflow-y-auto bg-slate-950/95 p-2 sm:p-4' : '',
      )}
    >
      <Card className={cn('h-full overflow-hidden', isExpanded ? 'mx-auto max-w-[1880px]' : '')}>
        <CardHeader className="mb-2">
          <div className="min-w-0">
            <CardTitle className="truncate">{title}</CardTitle>
            {subtitle ? <p className="text-xs text-slate-400">{subtitle}</p> : null}
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {rightActions}
            <Button
              type="button"
              variant={isExpanded ? 'outline' : 'secondary'}
              size="sm"
              onClick={toggleExpand}
              aria-label={isExpanded ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {isExpanded ? <Minimize2 className="mr-1 h-4 w-4" /> : <Expand className="mr-1 h-4 w-4" />}
              {isExpanded ? 'Salir' : 'Expandir'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={chartHeightClass}>
          {loading ? (
            <Skeleton className="h-full w-full rounded-2xl" />
          ) : (
            <div className="flex h-full flex-col">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {lines.map((line) => {
                  const selected = activeSelectedLineKey === line.key;
                  const muted = activeSelectedLineKey !== null && !selected;

                  return (
                    <button
                      key={line.key}
                      type="button"
                      onClick={() => setSelectedLineKey((current) => (current === line.key ? null : line.key))}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs transition',
                        selected
                          ? 'border-slate-100 bg-slate-100/10 text-slate-100'
                          : 'border-slate-700/70 bg-slate-900/70 text-slate-300 hover:border-slate-500',
                        muted ? 'opacity-50' : '',
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
                      {line.label}
                    </button>
                  );
                })}

                {activeSelectedLineKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setSelectedLineKey(null)}
                  >
                    Salir de seleccion
                  </Button>
                ) : null}
              </div>

              {selectedLine && selectedStats ? (
                <div className="mb-2 rounded-xl border border-slate-700/70 bg-slate-950/70 px-3 py-2 text-xs text-slate-200">
                  <span className="mr-3 inline-flex items-center gap-2 font-medium text-slate-100">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: selectedLine.color }}
                    />
                    Detalle {selectedLine.label}
                  </span>
                  <span className="mr-3 text-slate-300">Ultimo: {formatNumeric(selectedStats.latest, 2)}</span>
                  <span className="mr-3 text-slate-300">Min: {formatNumeric(selectedStats.min, 2)}</span>
                  <span className="mr-3 text-slate-300">Max: {formatNumeric(selectedStats.max, 2)}</span>
                  <span className="mr-3 text-slate-300">Prom: {formatNumeric(selectedStats.avg, 2)}</span>
                  <span className="text-slate-400">Puntos: {selectedStats.points}</span>
                </div>
              ) : null}

              <div className="min-h-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    margin={{ top: 8, right: isCompact ? 6 : 12, left: 0, bottom: isCompact ? 2 : 6 }}
                  >
                    <CartesianGrid stroke="rgba(148,163,184,0.18)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="t"
                      tickFormatter={formatTimeLabel}
                      tick={{ fill: '#94A3B8', fontSize: isCompact ? 10 : 11 }}
                      minTickGap={isCompact ? 28 : 14}
                    />
                    <YAxis
                      tick={{ fill: '#94A3B8', fontSize: isCompact ? 10 : 11 }}
                      width={isCompact ? 36 : 44}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid rgba(56,189,248,0.35)',
                        background: 'rgba(2,6,23,0.9)',
                      }}
                      labelFormatter={(value) => formatTimeLabel(String(value))}
                    />
                    {lines.map((line) => {
                      const selected = activeSelectedLineKey === line.key;
                      const muted = activeSelectedLineKey !== null && !selected;

                      return (
                        <Line
                          key={line.key}
                          type="monotone"
                          dataKey={line.key}
                          stroke={line.color}
                          strokeOpacity={muted ? 0.22 : 1}
                          strokeWidth={selected ? 3.6 : muted ? 1.4 : 2.2}
                          dot={selected ? { r: 1.8, fill: line.color, strokeWidth: 0 } : false}
                          activeDot={{ r: selected ? 5 : 3 }}
                          name={line.label}
                          isAnimationActive={false}
                          onClick={() =>
                            setSelectedLineKey((current) => (current === line.key ? null : line.key))
                          }
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


