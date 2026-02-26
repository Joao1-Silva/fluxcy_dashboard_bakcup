import { coerceNumber, toRows } from '@/lib/bff/normalizers';

export const ASSISTANT_FOCUS_VALUES = ['flow', 'pressure', 'density', 'power', 'watercut'] as const;

export type AssistantFocus = (typeof ASSISTANT_FOCUS_VALUES)[number];

export type AssistantAnalyzeInput = {
  from: string;
  to: string;
  timezone: string;
  pozo?: string;
  focus?: AssistantFocus[];
};

export type AssistantAxisInput = {
  from: string;
  to: string;
  timezone?: string;
  mode?: 'auto' | 'pow2' | 'nice125';
};

export type AssistantSourceMeta = {
  endpoint: string;
  ok: boolean;
  latencyMs: number;
  fallback: boolean;
  error?: string;
  rowCount: number;
};

type UnknownRecord = Record<string, unknown>;

type NumericPoint = {
  t: number;
  v: number;
  interpolated?: boolean;
};

type Trigger = {
  rule: string;
  algorithm: string;
  metric?: string;
  threshold?: number;
  score?: number;
  details?: Record<string, number | string | boolean>;
};

type DataQualityIssue = {
  id: string;
  type: 'gap' | 'freeze' | 'outlier';
  metric: string;
  start: string;
  end: string;
  score: number;
  details: Record<string, number | string | boolean>;
  triggeredBy: Trigger[];
};

type SeriesQuality = {
  metric: string;
  sampleCount: number;
  expectedStepMs: number;
  confidence: number;
  issues: DataQualityIssue[];
};

type ChangePointCandidate = {
  metric: string;
  t: number;
  delta: number;
  score: number;
  window: number;
};

type ChangePointCluster = {
  t: number;
  score: number;
  metrics: Array<{
    metric: string;
    delta: number;
    score: number;
  }>;
  triggeredBy: Trigger[];
};

type BucketDriver = {
  metric: string;
  absZ: number;
};

type AnomalyBucket = {
  t: number;
  score: number;
  drivers: BucketDriver[];
};

const EPS = 1e-9;
const MAX_POINTS_PER_SERIES = 1_800;
const GAP_FACTOR = 2;
const OUTLIER_Z = 3.5;
const ANOMALY_Z = 3.0;
const MIN_CORR_SAMPLES = 10;
const CORR_MIN_ABS = 0.5;
const BUCKET_MS = 60_000;

const TIME_KEYS = [
  'time',
  't',
  'timestamp',
  'timestamp_hmi',
  'timestamp_short',
  'fecha_creacion_iso',
  'datetime',
  'date',
  '_time',
] as const;

const SERIES_ALIASES = {
  qm_liq: ['qm_liq', 'liquido', 'flow_liq', 'qm_liquid'],
  qm_gas: ['qm_gas', 'gas', 'flow_gas', 'qm_gas_flow'],
  liq_acum: ['liq_acum', 'total_liq', 'totalliq', 'prod_liq_h', 'vliq'],
  gas_acum: ['gas_acum', 'total_gas', 'totalgas', 'prod_gas_h', 'vgas'],
  pres_f_liq: ['pres_f_liq', 'psi_liq', 'presion_liquido', 'presion_linea', 'presion_cabezal'],
  pres_f_gas: ['pres_f_gas', 'psi_gas', 'presion_gas', 'presion_casing'],
  rpm: ['rpm', 'vdf_rpm', 'motor_rpm'],
  torque: ['torque', 'tor', 'vdf_tor', 'vdf_torque', 'motor_torque'],
  amp: ['amp', 'amperaje', 'vdf_amp', 'motor_amp'],
  consumo: ['cons', 'consumo', 'vdf_cons', 'vdf_consumo', 'kw'],
  densidad_liq: ['densidad_liq', 'rho_liq', 'densidad', 'densidad_linea'],
  densidad_gas: ['densidad_gas', 'rho_gas'],
  h2o: ['h2o', 'watercut', 'water_cut', 'agua_pct', 'bsw'],
} as const;

type MetricName = keyof typeof SERIES_ALIASES;

const METRIC_TO_FOCUS: Record<MetricName, AssistantFocus> = {
  qm_liq: 'flow',
  qm_gas: 'flow',
  liq_acum: 'flow',
  gas_acum: 'flow',
  pres_f_liq: 'pressure',
  pres_f_gas: 'pressure',
  rpm: 'power',
  torque: 'power',
  amp: 'power',
  consumo: 'power',
  densidad_liq: 'density',
  densidad_gas: 'density',
  h2o: 'watercut',
};

const CORRELATION_PAIRS: Array<{ left: MetricName; right: MetricName }> = [
  { left: 'qm_liq', right: 'pres_f_liq' },
  { left: 'qm_gas', right: 'pres_f_gas' },
  { left: 'rpm', right: 'torque' },
  { left: 'amp', right: 'torque' },
  { left: 'h2o', right: 'densidad_liq' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function getInsensitiveValue(row: UnknownRecord, key: string): unknown {
  const direct = row[key];
  if (direct !== undefined) {
    return direct;
  }
  const lookup = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(row)) {
    if (entryKey.toLowerCase() === lookup) {
      return entryValue;
    }
  }
  return undefined;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[middle - 1] ?? sorted[0] ?? 0;
    const right = sorted[middle] ?? left;
    return (left + right) / 2;
  }
  return sorted[middle] ?? 0;
}

function mad(values: number[], baseMedian?: number): number {
  if (values.length === 0) {
    return 0;
  }
  const pivot = baseMedian ?? median(values);
  const deviations = values.map((value) => Math.abs(value - pivot));
  return median(deviations);
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function parseClockValue(value: string, referenceMs: number): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }

  const reference = new Date(referenceMs);
  const candidateMs = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    hours,
    minutes,
    seconds,
    0,
  );
  if (candidateMs < referenceMs - 12 * 60 * 60 * 1000) {
    return candidateMs + 24 * 60 * 60 * 1000;
  }
  if (candidateMs > referenceMs + 12 * 60 * 60 * 1000) {
    return candidateMs - 24 * 60 * 60 * 1000;
  }
  return candidateMs;
}

function coerceEpochMs(value: unknown, referenceMs: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return asDate;
  }

  return parseClockValue(trimmed, referenceMs);
}

function pickTime(row: UnknownRecord, referenceMs: number): number | null {
  for (const key of TIME_KEYS) {
    const raw = getInsensitiveValue(row, key);
    const parsed = coerceEpochMs(raw, referenceMs);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function pickNumber(row: UnknownRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = getInsensitiveValue(row, key);
    const parsed = coerceNumber(raw);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function normalizePoints(points: NumericPoint[]): NumericPoint[] {
  if (points.length === 0) {
    return [];
  }
  const grouped = new Map<number, NumericPoint[]>();
  for (const point of points) {
    if (!Number.isFinite(point.t) || !Number.isFinite(point.v)) {
      continue;
    }
    const current = grouped.get(point.t) ?? [];
    current.push(point);
    grouped.set(point.t, current);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, bucket]) => {
      const values = bucket.map((entry) => entry.v);
      return {
        t,
        v: median(values),
        interpolated: bucket.some((entry) => entry.interpolated === true),
      };
    });
}

function mergeSeries(...series: NumericPoint[][]): NumericPoint[] {
  const flattened = series.flat();
  return normalizePoints(flattened);
}

function downsample(points: NumericPoint[], targetPoints: number) {
  if (points.length <= targetPoints) {
    return {
      points,
      applied: false,
      originalCount: points.length,
      sampledCount: points.length,
      bucketSize: 1,
    };
  }

  const bucketSize = Math.ceil(points.length / targetPoints);
  const compact: NumericPoint[] = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const chunk = points.slice(index, index + bucketSize);
    compact.push({
      t: Math.round(median(chunk.map((point) => point.t))),
      v: median(chunk.map((point) => point.v)),
      interpolated: chunk.some((point) => point.interpolated === true),
    });
  }

  return {
    points: compact,
    applied: true,
    originalCount: points.length,
    sampledCount: compact.length,
    bucketSize,
  };
}

function expectedStepMs(points: NumericPoint[], rangeMs: number): number {
  if (points.length < 2) {
    return Math.max(60_000, Math.round(rangeMs / 60));
  }
  const diffs: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (!current || !previous) {
      continue;
    }
    const delta = current.t - previous.t;
    if (delta > 0) {
      diffs.push(delta);
    }
  }
  if (diffs.length === 0) {
    return Math.max(60_000, Math.round(rangeMs / 60));
  }
  return Math.max(1_000, Math.round(median(diffs)));
}

function robustZ(value: number, pivot: number, scaleMad: number): number {
  const safeMad = scaleMad < EPS ? EPS : scaleMad;
  return (0.6745 * (value - pivot)) / safeMad;
}

function bucketSeries(points: NumericPoint[], bucketMs: number): Map<number, number> {
  const grouped = new Map<number, number[]>();
  for (const point of points) {
    const bucket = Math.floor(point.t / bucketMs) * bucketMs;
    const current = grouped.get(bucket) ?? [];
    current.push(point.v);
    grouped.set(bucket, current);
  }
  const reduced = new Map<number, number>();
  for (const [bucket, values] of grouped) {
    reduced.set(bucket, median(values));
  }
  return reduced;
}

function calcPearson(left: number[], right: number[]): number | null {
  if (left.length < 2 || right.length !== left.length) {
    return null;
  }
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftDen = 0;
  let rightDen = 0;
  for (let i = 0; i < left.length; i += 1) {
    const leftValue = left[i];
    const rightValue = right[i];
    if (leftValue === undefined || rightValue === undefined) {
      continue;
    }
    const dx = leftValue - leftMean;
    const dy = rightValue - rightMean;
    numerator += dx * dy;
    leftDen += dx * dx;
    rightDen += dy * dy;
  }
  if (leftDen <= EPS || rightDen <= EPS) {
    return null;
  }
  return numerator / Math.sqrt(leftDen * rightDen);
}

function metricEnabled(metric: MetricName, focusSet: Set<AssistantFocus> | null): boolean {
  if (!focusSet || focusSet.size === 0) {
    return true;
  }
  return focusSet.has(METRIC_TO_FOCUS[metric]);
}

function extractSeriesFromRows(
  rows: UnknownRecord[],
  metric: MetricName,
  referenceMs: number,
): NumericPoint[] {
  const aliases = SERIES_ALIASES[metric];
  const points: NumericPoint[] = [];
  for (const row of rows) {
    const timeMs = pickTime(row, referenceMs);
    if (timeMs === null) {
      continue;
    }
    const value = pickNumber(row, aliases);
    if (value === null) {
      continue;
    }
    points.push({ t: timeMs, v: value, interpolated: false });
  }
  return normalizePoints(points);
}

function analyzeSeriesQuality(
  metric: string,
  points: NumericPoint[],
  fromMs: number,
  toMs: number,
): SeriesQuality {
  const rangeMs = Math.max(1, toMs - fromMs);
  if (points.length === 0) {
    return {
      metric,
      sampleCount: 0,
      expectedStepMs: Math.max(60_000, Math.round(rangeMs / 60)),
      confidence: 0,
      issues: [],
    };
  }

  const step = expectedStepMs(points, rangeMs);
  const issues: DataQualityIssue[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) {
      continue;
    }
    const delta = current.t - previous.t;
    if (delta > step * GAP_FACTOR) {
      const missingMs = delta - step;
      issues.push({
        id: `dq-${metric}-gap-${issues.length + 1}`,
        type: 'gap',
        metric,
        start: toIso(previous.t),
        end: toIso(current.t),
        score: Number((delta / step).toFixed(2)),
        details: { observedDeltaMs: delta, expectedStepMs: step, missingMs },
        triggeredBy: [
          {
            rule: 'gap_threshold',
            algorithm: 'expected_step_gap_detector',
            metric,
            threshold: step * GAP_FACTOR,
            score: Number((delta / step).toFixed(2)),
            details: { expectedStepMs: step, factor: GAP_FACTOR },
          },
        ],
      });
    }
  }

  const freezeWindow = Math.min(12, Math.max(5, Math.round((20 * 60_000) / step)));
  if (points.length >= freezeWindow) {
    let openFreeze: { start: number; end: number; maxScore: number } | null = null;
    for (let index = 0; index <= points.length - freezeWindow; index += 1) {
      const windowPoints = points.slice(index, index + freezeWindow);
      const firstPoint = windowPoints[0];
      const lastPoint = windowPoints.at(-1);
      if (!firstPoint || !lastPoint) {
        continue;
      }
      const values = windowPoints.map((point) => point.v);
      const center = median(values);
      const dispersion = mad(values, center);
      const epsilon = Math.max(1e-6, Math.abs(center) * 1e-4);
      const frozen = dispersion <= epsilon;
      if (frozen) {
        const score = Number((1 - dispersion / (epsilon + EPS)).toFixed(4));
        if (!openFreeze) {
          openFreeze = {
            start: firstPoint.t,
            end: lastPoint.t,
            maxScore: score,
          };
        } else {
          openFreeze.end = lastPoint.t;
          openFreeze.maxScore = Math.max(openFreeze.maxScore, score);
        }
      } else if (openFreeze) {
        issues.push({
          id: `dq-${metric}-freeze-${issues.length + 1}`,
          type: 'freeze',
          metric,
          start: toIso(openFreeze.start),
          end: toIso(openFreeze.end),
          score: Number(openFreeze.maxScore.toFixed(4)),
          details: { window: freezeWindow, expectedStepMs: step },
          triggeredBy: [
            {
              rule: 'freeze_mad_zero',
              algorithm: 'rolling_mad_detector',
              metric,
              threshold: 1e-4,
              score: Number(openFreeze.maxScore.toFixed(4)),
              details: { window: freezeWindow, expectedStepMs: step },
            },
          ],
        });
        openFreeze = null;
      }
    }
    if (openFreeze) {
      issues.push({
        id: `dq-${metric}-freeze-${issues.length + 1}`,
        type: 'freeze',
        metric,
        start: toIso(openFreeze.start),
        end: toIso(openFreeze.end),
        score: Number(openFreeze.maxScore.toFixed(4)),
        details: { window: freezeWindow, expectedStepMs: step },
        triggeredBy: [
          {
            rule: 'freeze_mad_zero',
            algorithm: 'rolling_mad_detector',
            metric,
            threshold: 1e-4,
            score: Number(openFreeze.maxScore.toFixed(4)),
            details: { window: freezeWindow, expectedStepMs: step },
          },
        ],
      });
    }
  }

  const values = points.map((point) => point.v);
  const med = median(values);
  const scale = mad(values, med);
  for (const point of points) {
    const z = robustZ(point.v, med, scale);
    if (Math.abs(z) >= OUTLIER_Z) {
      issues.push({
        id: `dq-${metric}-outlier-${issues.length + 1}`,
        type: 'outlier',
        metric,
        start: toIso(point.t),
        end: toIso(point.t),
        score: Number(Math.abs(z).toFixed(4)),
        details: { value: point.v, median: med, mad: scale },
        triggeredBy: [
          {
            rule: 'robust_outlier_mad',
            algorithm: 'median_mad_outlier',
            metric,
            threshold: OUTLIER_Z,
            score: Number(Math.abs(z).toFixed(4)),
          },
        ],
      });
    }
  }

  const gapDuration = issues
    .filter((issue) => issue.type === 'gap')
    .reduce((acc, issue) => acc + (Number(issue.details.missingMs) || 0), 0);
  const freezeDuration = issues
    .filter((issue) => issue.type === 'freeze')
    .reduce((acc, issue) => {
      const start = Date.parse(issue.start);
      const end = Date.parse(issue.end);
      return acc + Math.max(0, end - start);
    }, 0);
  const outlierCount = issues.filter((issue) => issue.type === 'outlier').length;

  const missingFraction = clamp(gapDuration / rangeMs, 0, 1);
  const freezeFraction = clamp(freezeDuration / rangeMs, 0, 1);
  const outlierFraction = clamp(outlierCount / Math.max(1, points.length), 0, 1);
  const confidence = clamp(
    1 - 0.5 * missingFraction - 0.25 * freezeFraction - 0.25 * Math.min(1, outlierFraction * 3),
    0,
    1,
  );

  return {
    metric,
    sampleCount: points.length,
    expectedStepMs: step,
    confidence: Number(confidence.toFixed(4)),
    issues,
  };
}

function detectChangePoints(metric: string, points: NumericPoint[], stepMs: number): ChangePointCandidate[] {
  if (points.length < 20) {
    return [];
  }
  const window = Math.max(6, Math.min(40, Math.round(points.length * 0.08)));
  if (points.length < window * 2 + 1) {
    return [];
  }

  const threshold = 3.0;
  const candidates: ChangePointCandidate[] = [];
  for (let index = window; index < points.length - window; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }
    const left = points.slice(index - window, index).map((point) => point.v);
    const right = points.slice(index, index + window).map((point) => point.v);
    const leftMedian = median(left);
    const rightMedian = median(right);
    const scale = mad(left, leftMedian) + mad(right, rightMedian) + EPS;
    const delta = rightMedian - leftMedian;
    const score = Math.abs(delta) / scale;
    if (score >= threshold) {
      candidates.push({
        metric,
        t: point.t,
        delta: Number(delta.toFixed(6)),
        score: Number(score.toFixed(6)),
        window,
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const minSeparation = Math.max(5 * 60_000, Math.round(stepMs * window * 0.5));
  const compact: ChangePointCandidate[] = [];
  const sorted = [...candidates].sort((a, b) => a.t - b.t);
  for (const candidate of sorted) {
    const previous = compact[compact.length - 1];
    if (!previous || candidate.t - previous.t > minSeparation) {
      compact.push(candidate);
      continue;
    }
    if (candidate.score > previous.score) {
      compact[compact.length - 1] = candidate;
    }
  }

  return compact;
}

function clusterChangePoints(candidates: ChangePointCandidate[]): ChangePointCluster[] {
  if (candidates.length === 0) {
    return [];
  }

  const toleranceMs = 5 * 60_000;
  const sorted = [...candidates].sort((a, b) => a.t - b.t);
  const clusters: ChangePointCandidate[][] = [];
  for (const candidate of sorted) {
    const current = clusters[clusters.length - 1];
    if (!current) {
      clusters.push([candidate]);
      continue;
    }
    const latest = current[current.length - 1];
    if (!latest) {
      clusters.push([candidate]);
      continue;
    }
    if (candidate.t - latest.t <= toleranceMs) {
      current.push(candidate);
      continue;
    }
    clusters.push([candidate]);
  }

  return clusters.map((cluster) => {
    const times = cluster.map((entry) => entry.t);
    const score = Math.max(...cluster.map((entry) => entry.score));
    return {
      t: Math.round(median(times)),
      score: Number(score.toFixed(4)),
      metrics: cluster.map((entry) => ({
        metric: entry.metric,
        delta: entry.delta,
        score: entry.score,
      })),
      triggeredBy: cluster.map((entry) => ({
        rule: 'regime_change_median_shift',
        algorithm: 'rolling_window_median_shift',
        metric: entry.metric,
        threshold: 3,
        score: Number(entry.score.toFixed(4)),
        details: { window: entry.window },
      })),
    };
  });
}

function buildRegimeEvents(clusters: ChangePointCluster[], fromMs: number, toMs: number) {
  const boundaries = [fromMs, ...clusters.map((cluster) => cluster.t), toMs].sort((a, b) => a - b);
  const uniqueBoundaries = boundaries.filter((value, index, list) => index === 0 || value !== list[index - 1]);
  const clusterByBoundary = new Map<number, ChangePointCluster>();
  for (const cluster of clusters) {
    clusterByBoundary.set(cluster.t, cluster);
  }

  return uniqueBoundaries.slice(0, -1).map((start, index) => {
    const end = uniqueBoundaries[index + 1];
    if (end === undefined) {
      return {
        id: `event-${index + 1}`,
        type: 'regime_segment',
        start: toIso(start),
        end: toIso(start),
        changePointAt: null,
        variablesChanged: [],
        score: 0,
        triggeredBy: [],
      };
    }
    const cluster = clusterByBoundary.get(start) ?? null;
    return {
      id: `event-${index + 1}`,
      type: 'regime_segment',
      start: toIso(start),
      end: toIso(end),
      changePointAt: cluster ? toIso(cluster.t) : null,
      variablesChanged: cluster?.metrics ?? [],
      score: Number((cluster?.score ?? 0).toFixed(4)),
      triggeredBy: cluster?.triggeredBy ?? [],
    };
  });
}

function detectAnomalies(
  seriesMap: Partial<Record<MetricName, NumericPoint[]>>,
  focusSet: Set<AssistantFocus> | null,
) {
  const bucketed = new Map<MetricName, Map<number, number>>();
  for (const [metric, points] of Object.entries(seriesMap) as Array<[MetricName, NumericPoint[] | undefined]>) {
    if (!points || points.length < 8 || !metricEnabled(metric, focusSet)) {
      continue;
    }
    bucketed.set(metric, bucketSeries(points, BUCKET_MS));
  }

  const allBuckets = new Set<number>();
  for (const map of bucketed.values()) {
    for (const bucket of map.keys()) {
      allBuckets.add(bucket);
    }
  }
  if (allBuckets.size === 0) {
    return [];
  }

  const stats = new Map<MetricName, { median: number; mad: number }>();
  for (const [metric, map] of bucketed) {
    const values = [...map.values()];
    const pivot = median(values);
    stats.set(metric, { median: pivot, mad: mad(values, pivot) });
  }

  const buckets = [...allBuckets].sort((a, b) => a - b);
  const flagged: AnomalyBucket[] = [];
  for (const bucket of buckets) {
    const drivers: BucketDriver[] = [];
    for (const [metric, map] of bucketed) {
      const value = map.get(bucket);
      if (value === undefined) {
        continue;
      }
      const stat = stats.get(metric);
      if (!stat) {
        continue;
      }
      const z = robustZ(value, stat.median, stat.mad);
      drivers.push({ metric, absZ: Math.abs(z) });
    }
    if (drivers.length < 2) {
      continue;
    }
    const score = Math.sqrt(
      drivers.reduce((sum, driver) => sum + driver.absZ * driver.absZ, 0) / drivers.length,
    );
    if (score >= ANOMALY_Z) {
      flagged.push({
        t: bucket,
        score: Number(score.toFixed(4)),
        drivers: drivers.sort((a, b) => b.absZ - a.absZ).slice(0, 5),
      });
    }
  }

  if (flagged.length === 0) {
    return [];
  }

  const grouped: AnomalyBucket[][] = [];
  const maxGap = BUCKET_MS * 2;
  for (const sample of flagged) {
    const current = grouped[grouped.length - 1];
    if (!current) {
      grouped.push([sample]);
      continue;
    }
    const previous = current[current.length - 1];
    if (!previous) {
      grouped.push([sample]);
      continue;
    }
    if (sample.t - previous.t <= maxGap) {
      current.push(sample);
      continue;
    }
    grouped.push([sample]);
  }

  return grouped.map((group, index) => {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) {
      return {
        id: `anomaly-${index + 1}`,
        start: toIso(0),
        end: toIso(0),
        score: 0,
        drivers: [],
        triggeredBy: [],
      };
    }
    const score = Math.max(...group.map((entry) => entry.score));
    const driverMap = new Map<string, { total: number; max: number; count: number }>();
    for (const entry of group) {
      for (const driver of entry.drivers) {
        const current = driverMap.get(driver.metric) ?? { total: 0, max: 0, count: 0 };
        current.total += driver.absZ;
        current.max = Math.max(current.max, driver.absZ);
        current.count += 1;
        driverMap.set(driver.metric, current);
      }
    }
    const drivers = [...driverMap.entries()]
      .map(([metric, value]) => ({
        metric,
        meanAbsZ: Number((value.total / Math.max(1, value.count)).toFixed(4)),
        maxAbsZ: Number(value.max.toFixed(4)),
      }))
      .sort((a, b) => b.maxAbsZ - a.maxAbsZ)
      .slice(0, 3);

    return {
      id: `anomaly-${index + 1}`,
      start: toIso(first.t),
      end: toIso(last.t + BUCKET_MS),
      score: Number(score.toFixed(4)),
      drivers,
      triggeredBy: [
        {
          rule: 'multivariate_robust_z',
          algorithm: 'combined_robust_zscore',
          threshold: ANOMALY_Z,
          score: Number(score.toFixed(4)),
          details: { buckets: group.length, bucketMs: BUCKET_MS },
        },
      ],
    };
  });
}

function detectCorrelations(
  seriesMap: Partial<Record<MetricName, NumericPoint[]>>,
  focusSet: Set<AssistantFocus> | null,
) {
  const correlations = [];
  for (const pair of CORRELATION_PAIRS) {
    if (!metricEnabled(pair.left, focusSet) && !metricEnabled(pair.right, focusSet)) {
      continue;
    }
    const leftSeries = seriesMap[pair.left];
    const rightSeries = seriesMap[pair.right];
    if (!leftSeries || !rightSeries || leftSeries.length < MIN_CORR_SAMPLES || rightSeries.length < MIN_CORR_SAMPLES) {
      continue;
    }

    const leftMap = bucketSeries(leftSeries, BUCKET_MS);
    const rightMap = bucketSeries(rightSeries, BUCKET_MS);

    let best: { lagMinutes: number; value: number; samples: number } | null = null;
    for (let lag = -15; lag <= 15; lag += 1) {
      const leftValues: number[] = [];
      const rightValues: number[] = [];
      for (const [bucket, value] of leftMap) {
        const shifted = bucket + lag * BUCKET_MS;
        const rhs = rightMap.get(shifted);
        if (rhs === undefined) {
          continue;
        }
        leftValues.push(value);
        rightValues.push(rhs);
      }
      if (leftValues.length < MIN_CORR_SAMPLES) {
        continue;
      }
      const corr = calcPearson(leftValues, rightValues);
      if (corr === null) {
        continue;
      }
      if (!best || Math.abs(corr) > Math.abs(best.value)) {
        best = {
          lagMinutes: lag,
          value: Number(corr.toFixed(4)),
          samples: leftValues.length,
        };
      }
    }

    if (!best || Math.abs(best.value) < CORR_MIN_ABS) {
      continue;
    }

    const relationship =
      best.lagMinutes > 0
        ? `${pair.left} lidera a ${pair.right} por ${best.lagMinutes} min`
        : best.lagMinutes < 0
          ? `${pair.right} lidera a ${pair.left} por ${Math.abs(best.lagMinutes)} min`
          : `${pair.left} y ${pair.right} se mueven en sincronia`;
    correlations.push({
      id: `corr-${correlations.length + 1}`,
      pair: `${pair.left}~${pair.right}`,
      lagMinutes: best.lagMinutes,
      strength: best.value,
      samples: best.samples,
      relationship,
      triggeredBy: [
        {
          rule: 'cross_correlation_lag_scan',
          algorithm: 'pearson_lag_scan',
          threshold: CORR_MIN_ABS,
          score: Number(Math.abs(best.value).toFixed(4)),
          details: { lagMin: -15, lagMax: 15, samples: best.samples },
        },
      ],
    });
  }

  return correlations.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
}

function slopePerMinute(points: NumericPoint[]): number | null {
  if (points.length < 2) {
    return null;
  }
  const first = points[0];
  if (!first) {
    return null;
  }
  const t0 = first.t;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  const n = points.length;
  for (const point of points) {
    const x = (point.t - t0) / 60_000;
    const y = point.v;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (Math.abs(denominator) < EPS) {
    return null;
  }
  return (n * sumXY - sumX * sumY) / denominator;
}

function computeFeatures(
  seriesMap: Partial<Record<MetricName, NumericPoint[]>>,
  focusSet: Set<AssistantFocus> | null,
) {
  const featureMetrics = [];
  for (const [metric, points] of Object.entries(seriesMap) as Array<[MetricName, NumericPoint[] | undefined]>) {
    if (!points || points.length < 3 || !metricEnabled(metric, focusSet)) {
      continue;
    }
    const windowSize = Math.min(15, points.length);
    const window = points.slice(-windowSize);
    const values = window.map((point) => point.v);
    const slope = slopePerMinute(window);
    const diffs: number[] = [];
    for (let index = 1; index < values.length; index += 1) {
      const current = values[index];
      const previous = values[index - 1];
      if (current === undefined || previous === undefined) {
        continue;
      }
      diffs.push(current - previous);
    }
    featureMetrics.push({
      metric,
      windowSamples: windowSize,
      rollingMedian: Number(median(values).toFixed(6)),
      rollingMad: Number(mad(values).toFixed(6)),
      slopePerMin: slope === null ? null : Number(slope.toFixed(6)),
      volatility: Number(standardDeviation(diffs).toFixed(6)),
    });
  }

  const ratioPairs: Array<{ name: string; numerator: MetricName; denominator: MetricName }> = [
    { name: 'qm_gas/qm_liq', numerator: 'qm_gas', denominator: 'qm_liq' },
    { name: 'torque/rpm', numerator: 'torque', denominator: 'rpm' },
    { name: 'amp/torque', numerator: 'amp', denominator: 'torque' },
  ];

  const ratios = [];
  for (const pair of ratioPairs) {
    if (!metricEnabled(pair.numerator, focusSet) && !metricEnabled(pair.denominator, focusSet)) {
      continue;
    }
    const left = seriesMap[pair.numerator];
    const right = seriesMap[pair.denominator];
    if (!left || !right || left.length < 5 || right.length < 5) {
      continue;
    }
    const leftMap = bucketSeries(left, BUCKET_MS);
    const rightMap = bucketSeries(right, BUCKET_MS);
    const values: number[] = [];
    for (const [bucket, leftValue] of leftMap) {
      const rightValue = rightMap.get(bucket);
      if (rightValue === undefined || Math.abs(rightValue) < EPS) {
        continue;
      }
      values.push(leftValue / rightValue);
    }
    if (values.length === 0) {
      continue;
    }
    ratios.push({
      ratio: pair.name,
      samples: values.length,
      median: Number(median(values).toFixed(6)),
      mad: Number(mad(values).toFixed(6)),
      last: Number((values[values.length - 1] ?? 0).toFixed(6)),
    });
  }

  return { metrics: featureMetrics, ratios };
}

function buildRecommendations(params: {
  confidence: number;
  qualityIssues: DataQualityIssue[];
  events: Array<{ id: string; changePointAt: string | null; start: string; end: string; variablesChanged: unknown[] }>;
  anomalies: Array<{ id: string; start: string; end: string; score: number }>;
  correlations: Array<{ id: string; pair: string; lagMinutes: number; strength: number }>;
}) {
  const recommendations = [];

  if (params.confidence < 0.75 || params.qualityIssues.length > 0) {
    const topIssues = [...params.qualityIssues]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (topIssues.length > 0) {
      recommendations.push({
        id: `rec-${recommendations.length + 1}`,
        title: 'Verificar calidad de senal antes de decisiones operativas',
        checklist: [
          'Inspeccionar conectividad de sensores en los intervalos referenciados.',
          'Corregir tags/fuentes con gaps o freeze persistente.',
          'Re-ejecutar analisis tras normalizar la captura.',
        ],
        evidence: topIssues.map((issue) => ({
          type: 'data_quality',
          id: issue.id,
          timestamps: [issue.start, issue.end],
        })),
        triggeredBy: [
          {
            rule: 'low_confidence_guardrail',
            algorithm: 'confidence_penalty_model',
            threshold: 0.75,
            score: Number((1 - params.confidence).toFixed(4)),
          },
        ],
      });
    }
  }

  if (params.anomalies.length > 0) {
    const critical = [...params.anomalies].sort((a, b) => b.score - a.score)[0];
    if (critical) {
      recommendations.push({
        id: `rec-${recommendations.length + 1}`,
        title: 'Revisar condicion operativa en ventana anomala',
        checklist: [
        'Cruzar bitacora de operacion con la ventana anomala.',
        'Validar cambios de setpoint o maniobras de valvula.',
        'Confirmar si hubo intervencion de mantenimiento.',
      ],
      evidence: [
        {
          type: 'anomaly',
          id: critical.id,
          timestamps: [critical.start, critical.end],
        },
      ],
      triggeredBy: [
        {
          rule: 'anomaly_severity_check',
          algorithm: 'combined_robust_zscore',
          threshold: ANOMALY_Z,
          score: Number(critical.score.toFixed(4)),
        },
      ],
      });
    }
  }

  const changeEvents = params.events.filter((event) => event.changePointAt !== null);
  if (changeEvents.length > 0) {
    const recent = changeEvents.slice(-1)[0];
    if (recent) {
      recommendations.push({
      id: `rec-${recommendations.length + 1}`,
      title: 'Auditar transicion de regimen detectada',
      checklist: [
        'Comparar parametros antes y despues del cambio de regimen.',
        'Corroborar si la transicion coincide con acciones operativas esperadas.',
        'Registrar setpoints y condiciones para reproducibilidad.',
      ],
      evidence: [
        {
          type: 'event',
          id: recent.id,
          timestamps: [recent.start, recent.end],
        },
      ],
      triggeredBy: [
        {
          rule: 'regime_transition_check',
          algorithm: 'rolling_window_median_shift',
          score: 1,
        },
      ],
      });
    }
  }

  const strongCorrelation = [...params.correlations].sort(
    (a, b) => Math.abs(b.strength) - Math.abs(a.strength),
  )[0];
  if (strongCorrelation && Math.abs(strongCorrelation.strength) >= 0.7) {
    recommendations.push({
      id: `rec-${recommendations.length + 1}`,
      title: 'Validar relacion lead/lag para optimizacion',
      checklist: [
        'Usar el lag detectado para adelantar ajuste de control.',
        'Verificar que la relacion se mantenga en proximos ciclos.',
        'Definir umbral de alerta cuando la correlacion cambie de signo.',
      ],
      evidence: [
        {
          type: 'correlation',
          id: strongCorrelation.id,
          timestamps: [],
        },
      ],
      triggeredBy: [
        {
          rule: 'strong_lag_correlation',
          algorithm: 'pearson_lag_scan',
          threshold: 0.7,
          score: Number(Math.abs(strongCorrelation.strength).toFixed(4)),
          details: { lagMinutes: strongCorrelation.lagMinutes },
        },
      ],
    });
  }

  return recommendations.slice(0, 5);
}

function buildSummary(params: {
  from: string;
  to: string;
  confidence: number;
  events: number;
  anomalies: number;
  correlations: number;
  issues: number;
}) {
  const confidencePct = Math.round(params.confidence * 100);
  return `Rango ${params.from} a ${params.to}: ${params.events} segmentos, ${params.anomalies} anomalias y ${params.correlations} correlaciones significativas. Calidad ${confidencePct}% (${params.issues} hallazgos de data quality).`;
}

function extractAllSeries(
  payloads: {
    qm: unknown;
    produccion: unknown;
    databasefluxcy: unknown;
    clockmeter: unknown;
    clockmeterQm: unknown;
  },
  fromMs: number,
) {
  const rowsBySource = {
    qm: toRows(payloads.qm),
    produccion: toRows(payloads.produccion),
    databasefluxcy: toRows(payloads.databasefluxcy),
    clockmeter: toRows(payloads.clockmeter),
    clockmeterQm: toRows(payloads.clockmeterQm),
  };

  const seriesByMetric: Partial<Record<MetricName, NumericPoint[]>> = {};
  const metricSources: Partial<Record<MetricName, string[]>> = {};

  const sourceOrder: Array<{
    name: keyof typeof rowsBySource;
    metrics: MetricName[];
  }> = [
    { name: 'qm', metrics: ['qm_liq', 'qm_gas'] },
    { name: 'produccion', metrics: ['liq_acum', 'gas_acum'] },
    {
      name: 'databasefluxcy',
      metrics: [
        'pres_f_liq',
        'pres_f_gas',
        'rpm',
        'torque',
        'amp',
        'consumo',
        'densidad_liq',
        'densidad_gas',
        'h2o',
        'qm_liq',
        'qm_gas',
      ],
    },
    { name: 'clockmeter', metrics: ['pres_f_liq', 'pres_f_gas', 'densidad_liq'] },
    { name: 'clockmeterQm', metrics: ['qm_liq', 'qm_gas'] },
  ];

  for (const source of sourceOrder) {
    const rows = rowsBySource[source.name] ?? [];
    for (const metric of source.metrics) {
      const extracted = extractSeriesFromRows(rows, metric, fromMs);
      if (extracted.length === 0) {
        continue;
      }
      seriesByMetric[metric] = mergeSeries(seriesByMetric[metric] ?? [], extracted);
      const currentSources = metricSources[metric] ?? [];
      if (!currentSources.includes(source.name)) {
        currentSources.push(source.name);
      }
      metricSources[metric] = currentSources;
    }
  }

  return {
    seriesByMetric,
    metricSources,
    rowCounts: {
      qm: rowsBySource.qm.length,
      produccion: rowsBySource.produccion.length,
      databasefluxcy: rowsBySource.databasefluxcy.length,
      clockmeter: rowsBySource.clockmeter.length,
      clockmeterQm: rowsBySource.clockmeterQm.length,
    },
  };
}

function roundForAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (Math.abs(value) >= 1) {
    return Number(value.toFixed(6));
  }
  return Number(value.toPrecision(6));
}

function nextPowerOfTwo(value: number): number {
  if (value <= 0) {
    return 1;
  }
  return 2 ** Math.ceil(Math.log2(value));
}

function nextNice125(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction = 1;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

function niceTickStep(value: number): number {
  if (value <= 0) {
    return 1;
  }
  return nextNice125(value / 5);
}

export function buildAxisScale(
  input: AssistantAxisInput,
  payloads: { qm: unknown; databasefluxcy?: unknown },
) {
  const fromMs = Date.parse(input.from);
  const qmRows = toRows(payloads.qm);
  const dbRows = payloads.databasefluxcy ? toRows(payloads.databasefluxcy) : [];
  const qmLiq = extractSeriesFromRows(qmRows, 'qm_liq', fromMs);
  const qmGas = extractSeriesFromRows(qmRows, 'qm_gas', fromMs);
  const backupLiq = extractSeriesFromRows(dbRows, 'qm_liq', fromMs);
  const backupGas = extractSeriesFromRows(dbRows, 'qm_gas', fromMs);
  const merged = mergeSeries(qmLiq, qmGas, backupLiq, backupGas);

  const maxObserved = merged.length === 0 ? 0 : Math.max(...merged.map((point) => point.v));
  const mode = input.mode ?? 'auto';
  const algorithm =
    mode === 'pow2' ? 'pow2' : mode === 'nice125' ? 'nice125' : maxObserved >= 16 ? 'pow2' : 'nice125';
  const maxAxisRaw = algorithm === 'pow2' ? nextPowerOfTwo(maxObserved) : nextNice125(maxObserved);
  const tickStepRaw = algorithm === 'pow2' ? maxAxisRaw / 4 : niceTickStep(maxAxisRaw);
  const maxAxis = roundForAxis(maxAxisRaw);
  const tickStep = roundForAxis(tickStepRaw);

  return {
    from: input.from,
    to: input.to,
    timezone: input.timezone ?? 'UTC',
    maxObserved: roundForAxis(maxObserved),
    maxAxis,
    tickStep,
    algorithm,
    triggeredBy: [
      {
        rule: 'axis_nice_scale',
        algorithm,
        details: { mode, points: merged.length },
      },
    ],
  };
}

export function buildAssistantAnalysis(params: {
  input: AssistantAnalyzeInput;
  payloads: {
    qm: unknown;
    produccion: unknown;
    databasefluxcy: unknown;
    clockmeter: unknown;
    clockmeterQm: unknown;
  };
  sources: AssistantSourceMeta[];
}) {
  const startedAt = Date.now();
  const fromMs = Date.parse(params.input.from);
  const toMs = Date.parse(params.input.to);
  const rangeMs = Math.max(1, toMs - fromMs);
  const focusSet = params.input.focus?.length ? new Set(params.input.focus) : null;

  const extracted = extractAllSeries(params.payloads, fromMs);
  const seriesByMetric: Partial<Record<MetricName, NumericPoint[]>> = {};
  const downsampleMeta: Record<string, { original: number; sampled: number; bucketSize: number }> = {};
  for (const [metric, points] of Object.entries(extracted.seriesByMetric) as Array<[MetricName, NumericPoint[]]>) {
    const compact = downsample(points, MAX_POINTS_PER_SERIES);
    seriesByMetric[metric] = compact.points;
    if (compact.applied) {
      downsampleMeta[metric] = {
        original: compact.originalCount,
        sampled: compact.sampledCount,
        bucketSize: compact.bucketSize,
      };
    }
  }

  const qualityPerSeries = (Object.entries(seriesByMetric) as Array<[MetricName, NumericPoint[]]>)
    .filter(([metric]) => metricEnabled(metric, focusSet))
    .map(([metric, points]) => analyzeSeriesQuality(metric, points, fromMs, toMs));
  const qualityIssues = qualityPerSeries
    .flatMap((series) => series.issues)
    .sort((a, b) => {
      if (a.metric !== b.metric) {
        return a.metric.localeCompare(b.metric);
      }
      return a.start.localeCompare(b.start);
    });

  const weightedConfidenceDenominator = qualityPerSeries.reduce(
    (sum, quality) => sum + Math.max(1, quality.sampleCount),
    0,
  );
  const weightedConfidenceNumerator = qualityPerSeries.reduce(
    (sum, quality) => sum + quality.confidence * Math.max(1, quality.sampleCount),
    0,
  );
  const confidence =
    weightedConfidenceDenominator === 0
      ? 0
      : clamp(weightedConfidenceNumerator / weightedConfidenceDenominator, 0, 1);

  const changeCandidates = qualityPerSeries.flatMap((quality) =>
    detectChangePoints(quality.metric, seriesByMetric[quality.metric as MetricName] ?? [], quality.expectedStepMs),
  );
  const changeClusters = clusterChangePoints(changeCandidates);
  const events = buildRegimeEvents(changeClusters, fromMs, toMs).filter((event) => {
    if (!focusSet || focusSet.size === 0) {
      return true;
    }
    if (event.variablesChanged.length === 0) {
      return true;
    }
    const metrics = event.variablesChanged
      .map((entry) => (asRecord(entry)?.metric as MetricName | undefined) ?? null)
      .filter((value): value is MetricName => value !== null);
    return metrics.some((metric) => metricEnabled(metric, focusSet));
  });

  const anomalies = detectAnomalies(seriesByMetric, focusSet).sort((a, b) => a.start.localeCompare(b.start));
  const correlations = detectCorrelations(seriesByMetric, focusSet);
  const featureWindows = computeFeatures(seriesByMetric, focusSet);

  const recommendations = buildRecommendations({
    confidence,
    qualityIssues,
    events,
    anomalies,
    correlations,
  });

  const summary = buildSummary({
    from: params.input.from,
    to: params.input.to,
    confidence,
    events: events.length,
    anomalies: anomalies.length,
    correlations: correlations.length,
    issues: qualityIssues.length,
  });

  return {
    summary,
    confidence: Number(confidence.toFixed(4)),
    events,
    anomalies,
    correlations,
    recommendations,
    dataQuality: {
      confidencePerSeries: qualityPerSeries.map((entry) => ({
        metric: entry.metric,
        confidence: entry.confidence,
        expectedStepMs: entry.expectedStepMs,
        sampleCount: entry.sampleCount,
      })),
      issues: qualityIssues,
    },
    features: featureWindows,
    meta: {
      timezone: params.input.timezone,
      pozo: params.input.pozo ?? null,
      focus: params.input.focus ?? null,
      sources: params.sources,
      metricsDetected: Object.keys(seriesByMetric),
      metricSources: extracted.metricSources,
      rowCounts: extracted.rowCounts,
      interpolationApplied: false,
      downsample: downsampleMeta,
      algorithms: [
        'expected_step_gap_detector',
        'rolling_mad_detector',
        'median_mad_outlier',
        'rolling_window_median_shift',
        'combined_robust_zscore',
        'pearson_lag_scan',
      ],
      elapsedMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
      rangeMs,
    },
  };
}

