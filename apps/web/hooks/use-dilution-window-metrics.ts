'use client';

import { useMemo } from 'react';

import type { DashboardDataHookResult } from '@/hooks/use-dashboard-data';
import { useDashboardStore } from '@/store/dashboard-store';
import type { SeriesPoint, TableRow } from '@/types/dashboard';

export type QtAggregationMode = 'avg' | 'delta';
export type WaterCutSource = 'series' | 'table' | 'none';

export type DilutionWindowMetrics = {
  qtAvg: number | null;
  qtDelta: number | null;
  qtSelected: number | null;
  wcData: number | null;
  wcSource: WaterCutSource;
  rhoLine15: number | null;
  windowStartIso: string;
  windowEndIso: string;
  qmPoints: number;
  wcPoints: number;
  rhoPoints: number;
};

type SamplePoint = {
  tMs: number;
  value: number;
};

const WINDOW_15_MIN_MS = 15 * 60 * 1000;
const QM_LIQ_KEYS = ['qm_liq'] as const;
const WC_KEYS = ['wc', 'watercut', 'water_cut', 'bsw', 'h2o', 'agua_pct', 'bsw_lab'] as const;
const RHO_LINE_KEYS = ['rho_line', 'densidad_linea', 'densidad', 'rho_liq'] as const;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function pickNumericValue(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const parsed = toFiniteNumber(record[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function normalizeWcToFraction(raw: number): number | null {
  if (!Number.isFinite(raw) || raw < 0) {
    return null;
  }

  if (raw >= 1 && raw <= 100) {
    return raw / 100;
  }

  if (raw >= 0 && raw < 1) {
    return raw;
  }

  return null;
}

function dedupeByTimestamp(samples: SamplePoint[]): SamplePoint[] {
  const map = new Map<number, number>();
  for (const sample of samples) {
    map.set(sample.tMs, sample.value);
  }

  return [...map.entries()]
    .map(([tMs, value]) => ({ tMs, value }))
    .sort((a, b) => a.tMs - b.tMs);
}

function extractSeriesSamples(
  series: SeriesPoint[],
  keys: readonly string[],
  windowStartMs: number,
  windowEndMs: number,
  normalizeValue?: (value: number) => number | null,
): SamplePoint[] {
  const mapped: SamplePoint[] = [];

  for (const point of series) {
    const tMs = new Date(point.t).getTime();
    if (Number.isNaN(tMs) || tMs > windowEndMs) {
      continue;
    }

    const value = pickNumericValue(point as Record<string, unknown>, keys);
    if (value === null) {
      continue;
    }

    const normalized = normalizeValue ? normalizeValue(value) : value;
    if (normalized === null || !Number.isFinite(normalized)) {
      continue;
    }

    if (tMs < windowStartMs - WINDOW_15_MIN_MS) {
      continue;
    }

    mapped.push({ tMs, value: normalized });
  }

  return dedupeByTimestamp(mapped);
}

function extractTableSamples(
  rows: TableRow[],
  keys: readonly string[],
  windowStartMs: number,
  windowEndMs: number,
  normalizeValue?: (value: number) => number | null,
): SamplePoint[] {
  const mapped: SamplePoint[] = [];

  for (const row of rows) {
    const tMs = new Date(row.time).getTime();
    if (Number.isNaN(tMs) || tMs < windowStartMs || tMs > windowEndMs) {
      continue;
    }

    const value = pickNumericValue(row as Record<string, unknown>, keys);
    if (value === null) {
      continue;
    }

    const normalized = normalizeValue ? normalizeValue(value) : value;
    if (normalized === null || !Number.isFinite(normalized)) {
      continue;
    }

    mapped.push({ tMs, value: normalized });
  }

  return dedupeByTimestamp(mapped);
}

function computeAverage(samples: SamplePoint[]): number | null {
  if (samples.length === 0) {
    return null;
  }

  const sum = samples.reduce((acc, sample) => acc + sample.value, 0);
  return sum / samples.length;
}

function computeTimeWeightedAverage(
  samples: SamplePoint[],
  windowStartMs: number,
  windowEndMs: number,
): number | null {
  if (samples.length === 0 || windowEndMs <= windowStartMs) {
    return null;
  }

  const sorted = [...samples].sort((a, b) => a.tMs - b.tMs);
  const previous = [...sorted].reverse().find((sample) => sample.tMs < windowStartMs) ?? null;
  const inWindow = sorted.filter((sample) => sample.tMs >= windowStartMs && sample.tMs <= windowEndMs);

  const timeline: SamplePoint[] = previous ? [previous, ...inWindow] : inWindow;
  if (timeline.length === 0) {
    return null;
  }

  if (timeline.length === 1) {
    return timeline[0].value;
  }

  let area = 0;
  let totalMs = 0;

  for (let index = 0; index < timeline.length; index += 1) {
    const current = timeline[index];
    const next = timeline[index + 1];

    const segmentStart = Math.max(current.tMs, windowStartMs);
    const segmentEnd = Math.min(next ? next.tMs : windowEndMs, windowEndMs);

    if (segmentEnd <= segmentStart) {
      continue;
    }

    area += current.value * (segmentEnd - segmentStart);
    totalMs += segmentEnd - segmentStart;
  }

  if (totalMs <= 0) {
    return timeline[timeline.length - 1]?.value ?? null;
  }

  return area / totalMs;
}

function resolveWindowBounds(fromIso: string, toIso: string) {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();

  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
    const end = Date.now();
    return {
      windowStartMs: end - WINDOW_15_MIN_MS,
      windowEndMs: end,
    };
  }

  return {
    windowStartMs: Math.max(fromMs, toMs - WINDOW_15_MIN_MS),
    windowEndMs: toMs,
  };
}

export function useDilutionWindowMetrics(
  data: DashboardDataHookResult,
  qtMode: QtAggregationMode,
): DilutionWindowMetrics {
  const appliedRange = useDashboardStore((state) => state.appliedRange);

  return useMemo(() => {
    const { windowStartMs, windowEndMs } = resolveWindowBounds(appliedRange.from, appliedRange.to);

    const flowSeries = data.flowQuery.data?.series ?? [];
    const vpSeries = data.vpQuery.data?.series ?? [];
    const rhoSeries = data.rhoQuery.data?.series ?? [];
    const bswRows = data.bswQuery.data?.table ?? [];

    const qmSamples = extractSeriesSamples(flowSeries, QM_LIQ_KEYS, windowStartMs, windowEndMs);
    const qtAvg = computeTimeWeightedAverage(qmSamples, windowStartMs, windowEndMs);

    const qmInWindow = qmSamples.filter((sample) => sample.tMs >= windowStartMs && sample.tMs <= windowEndMs);
    const qtDelta =
      qmInWindow.length >= 2 ? qmInWindow[qmInWindow.length - 1].value - qmInWindow[0].value : null;

    const wcSeriesSamples = dedupeByTimestamp(
      [
        ...extractSeriesSamples(flowSeries, WC_KEYS, windowStartMs, windowEndMs, normalizeWcToFraction),
        ...extractSeriesSamples(vpSeries, WC_KEYS, windowStartMs, windowEndMs, normalizeWcToFraction),
        ...extractSeriesSamples(rhoSeries, WC_KEYS, windowStartMs, windowEndMs, normalizeWcToFraction),
      ].filter((sample) => sample.tMs >= windowStartMs && sample.tMs <= windowEndMs),
    );

    const wcTableSamples = extractTableSamples(
      bswRows,
      WC_KEYS,
      windowStartMs,
      windowEndMs,
      normalizeWcToFraction,
    );

    const wcFromSeries = computeTimeWeightedAverage(wcSeriesSamples, windowStartMs, windowEndMs);
    const wcFromTable = computeAverage(wcTableSamples);
    const wcData = wcFromSeries ?? wcFromTable;
    const wcSource: WaterCutSource = wcFromSeries !== null ? 'series' : wcFromTable !== null ? 'table' : 'none';
    const wcPoints = wcFromSeries !== null ? wcSeriesSamples.length : wcFromTable !== null ? wcTableSamples.length : 0;

    const rhoSamples = extractSeriesSamples(rhoSeries, RHO_LINE_KEYS, windowStartMs, windowEndMs).filter(
      (sample) => sample.tMs >= windowStartMs && sample.tMs <= windowEndMs,
    );
    let rhoLine15 = computeAverage(rhoSamples);

    if (rhoLine15 === null) {
      const snapshotDensity = data.snapshotQuery.data?.snapshot?.densidad;
      const parsedSnapshotDensity = toFiniteNumber(snapshotDensity);
      if (parsedSnapshotDensity !== null) {
        rhoLine15 = parsedSnapshotDensity;
      }
    }

    return {
      qtAvg,
      qtDelta,
      qtSelected: qtMode === 'delta' ? qtDelta : qtAvg,
      wcData,
      wcSource,
      rhoLine15,
      windowStartIso: new Date(windowStartMs).toISOString(),
      windowEndIso: new Date(windowEndMs).toISOString(),
      qmPoints: qmInWindow.length,
      wcPoints,
      rhoPoints: rhoSamples.length,
    };
  }, [
    appliedRange.from,
    appliedRange.to,
    data.bswQuery.data?.table,
    data.flowQuery.data?.series,
    data.rhoQuery.data?.series,
    data.snapshotQuery.data?.snapshot?.densidad,
    data.vpQuery.data?.series,
    qtMode,
  ]);
}
