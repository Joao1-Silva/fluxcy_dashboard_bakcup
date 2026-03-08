import type { Server } from 'socket.io';

import { fetchExternal } from '../lib/externalApi.js';
import { normalizeSeries, normalizeSnapshot } from '../lib/normalizers.js';

type FlowRequest = {
  from?: string;
  to?: string;
  smooth?: '0' | '1';
  alpha?: number;
};

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
  const cappedToMs = Number.isFinite(rawToMs) ? Math.min(rawToMs, nowMs) : nowMs;
  const toMs = cappedToMs > fromMs ? cappedToMs : nowMs;

  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();

  const payload = await fetchExternal('/qm', {
    from,
    to,
    smooth: params.smooth ?? '1',
    alpha: params.alpha,
  });

  return normalizeSeries(payload, ['qm_liq', 'qm_gas']);
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


