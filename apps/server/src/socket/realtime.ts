import type { Server } from 'socket.io';

import { fetchExternal } from '../lib/externalApi.js';
import { normalizeSeries, normalizeSnapshot } from '../lib/normalizers.js';

type FlowRequest = {
  from?: string;
  to?: string;
  smooth?: '0' | '1';
  alpha?: number;
};

const EXTERNAL_SERIES_TIME_SHIFT_MS = 60 * 60 * 1000;

function shiftIsoTimestamp(iso: string, shiftMs: number) {
  const epoch = new Date(iso).getTime();
  if (Number.isNaN(epoch)) {
    return iso;
  }

  return new Date(epoch + shiftMs).toISOString();
}

async function fetchSnapshot() {
  const [clockmeter, drivgain, temp, possvalve, rholiq, total, densidadapi] = await Promise.all([
    fetchExternal('/clockmeter'),
    fetchExternal('/drivgain'),
    fetchExternal('/temp'),
    fetchExternal('/possvalve'),
    fetchExternal('/rholiq'),
    fetchExternal('/total'),
    fetchExternal('/densidadapi'),
  ]);

  return normalizeSnapshot({
    clockmeter,
    drivgain,
    temp,
    possvalve,
    rholiq,
    total,
    densidadapi,
  });
}

async function fetchFlowSeries(params: FlowRequest) {
  const nowMs = Date.now();
  const fallbackFromMs = nowMs - 6 * 60 * 60 * 1000;

  const rawFromMs = params.from ? new Date(params.from).getTime() : fallbackFromMs;
  const rawToMs = params.to ? new Date(params.to).getTime() : nowMs;

  const fromMs = Number.isFinite(rawFromMs) ? rawFromMs : fallbackFromMs;
  const resolvedToMs = Number.isFinite(rawToMs) ? rawToMs : nowMs;
  const toMs = resolvedToMs > fromMs ? resolvedToMs : fromMs + 60_000;

  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();

  const payload = await fetchExternal('/qm', {
    from,
    to,
    smooth: params.smooth ?? '1',
    alpha: params.alpha,
  });

  const normalized = normalizeSeries(payload, ['qm_liq', 'qm_gas']);
  return {
    series: normalized.series.map((point) => ({
      ...point,
      t: shiftIsoTimestamp(point.t, EXTERNAL_SERIES_TIME_SHIFT_MS),
    })),
  };
}

export function initRealtime(io: Server, intervalMs: number) {
  let timer: NodeJS.Timeout | null = null;

  const emitSnapshot = async () => {
    try {
      const payload = await fetchSnapshot();
      io.emit('snapshot', payload.snapshot);
    } catch (error) {
      io.emit('server:error', {
        message: error instanceof Error ? error.message : 'No fue posible obtener snapshot realtime',
      });
    }
  };

  io.on('connection', (socket) => {
    socket.emit('status', { connected: true });

    socket.on('series:flow:request', async (params: FlowRequest = {}) => {
      try {
        const payload = await fetchFlowSeries(params);
        socket.emit('series:flow', payload.series);
      } catch (error) {
        socket.emit('server:error', {
          message: error instanceof Error ? error.message : 'No fue posible obtener series realtime',
        });
      }
    });
  });

  timer = setInterval(() => {
    void emitSnapshot();
  }, intervalMs);

  void emitSnapshot();

  return () => {
    if (timer) {
      clearInterval(timer);
    }
  };
}


