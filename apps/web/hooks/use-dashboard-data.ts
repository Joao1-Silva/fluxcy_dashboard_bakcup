'use client';

import { useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchJson, querySignal } from '@/lib/api-client';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { shiftIsoForExternalApi } from '@/lib/time';
import { useDashboardStore } from '@/store/dashboard-store';
import type { SeriesResponse, SnapshotResponse, TableResponse } from '@/types/dashboard';

type DashboardDataOptions = {
  smoothFlow: boolean;
  alpha: number;
};

function getPollingEnabled(mode: 'realtime' | 'api', fallback: boolean, paused: boolean) {
  if (paused) {
    return false;
  }
  return mode === 'api' || fallback;
}

export function useDashboardData(options: DashboardDataOptions) {
  const mode = useDashboardStore((state) => state.mode);
  const fallbackPolling = useDashboardStore((state) => state.fallbackPolling);
  const paused = useDashboardStore((state) => state.paused);
  const refreshMs = useDashboardStore((state) => state.refreshMs);
  const appliedRange = useDashboardStore((state) => state.appliedRange);
  const rangeVersion = useDashboardStore((state) => state.rangeVersion);

  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.cancelQueries({ queryKey: ['series'] });
    queryClient.cancelQueries({ queryKey: ['table'] });
  }, [rangeVersion, queryClient]);

  const debouncedRange = useDebouncedValue(appliedRange, 250);
  const pollingEnabled = getPollingEnabled(mode, fallbackPolling, paused);
  const refetchInterval = pollingEnabled ? refreshMs : false;

  const rangeParams = useMemo(
    () => ({
      // External API currently resolves timezone-aware ranges one hour behind.
      // We compensate at query time while preserving user-visible local inputs.
      from: shiftIsoForExternalApi(debouncedRange.from),
      to: shiftIsoForExternalApi(debouncedRange.to),
    }),
    [debouncedRange.from, debouncedRange.to],
  );

  const snapshotQuery = useQuery({
    queryKey: ['snapshot'],
    queryFn: (ctx) => fetchJson<SnapshotResponse>('/api/snapshot', { signal: querySignal(ctx) }),
    refetchInterval,
    staleTime: 3_000,
    placeholderData: keepPreviousData,
  });

  const flowQuery = useQuery({
    queryKey: ['series', 'flow', rangeParams.from, rangeParams.to, options.smoothFlow, options.alpha],
    queryFn: (ctx) =>
      fetchJson<SeriesResponse>('/api/series/flow', {
        signal: querySignal(ctx),
        params: {
          ...rangeParams,
          smooth: options.smoothFlow ? '1' : '0',
          alpha: options.alpha,
        },
      }),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  const vpQuery = useQuery({
    queryKey: ['series', 'vp', rangeParams.from, rangeParams.to],
    queryFn: (ctx) =>
      fetchJson<SeriesResponse>('/api/series/vp', {
        signal: querySignal(ctx),
        params: rangeParams,
      }),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  const rhoQuery = useQuery({
    queryKey: ['series', 'rho', rangeParams.from, rangeParams.to],
    queryFn: (ctx) =>
      fetchJson<SeriesResponse>('/api/series/rho', {
        signal: querySignal(ctx),
        params: rangeParams,
      }),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  const produccionQuery = useQuery({
    queryKey: ['series', 'produccion', rangeParams.from, rangeParams.to],
    queryFn: (ctx) =>
      fetchJson<SeriesResponse>('/api/series/produccion', {
        signal: querySignal(ctx),
        params: { ...rangeParams, stepMin: 1 },
      }),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  const pressuresQuery = useQuery({
    queryKey: ['table', 'pressures', rangeParams.from, rangeParams.to],
    queryFn: (ctx) =>
      fetchJson<TableResponse>('/api/table/pressures', {
        signal: querySignal(ctx),
        params: { ...rangeParams, limit: 200 },
      }),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  const bswQuery = useQuery({
    queryKey: ['table', 'bsw', rangeParams.from, rangeParams.to],
    queryFn: (ctx) =>
      fetchJson<TableResponse>('/api/table/bsw-lab', {
        signal: querySignal(ctx),
        params: { ...rangeParams, limit: 200 },
      }),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  const densidadLabQuery = useQuery({
    queryKey: ['table', 'densidadLab', rangeParams.from, rangeParams.to],
    queryFn: (ctx) =>
      fetchJson<TableResponse>('/api/table/densidad-lab', {
        signal: querySignal(ctx),
        params: { ...rangeParams, limit: 200 },
      }),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

  return {
    pollingEnabled,
    snapshotQuery,
    flowQuery,
    vpQuery,
    rhoQuery,
    produccionQuery,
    pressuresQuery,
    bswQuery,
    densidadLabQuery,
  };
}

export type DashboardDataHookResult = ReturnType<typeof useDashboardData>;


