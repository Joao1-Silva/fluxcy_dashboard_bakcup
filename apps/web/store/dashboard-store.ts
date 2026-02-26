'use client';

import { subHours } from 'date-fns';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { buildRange, RANGE_PRESETS } from '@/lib/time';
import type { DashboardThemeMode, DataMode, SocketStatus, TimeRange } from '@/types/dashboard';

type DashboardState = {
  mode: DataMode;
  themeMode: DashboardThemeMode;
  socketStatus: SocketStatus;
  fallbackPolling: boolean;
  canResumeRealtime: boolean;
  paused: boolean;
  refreshMs: number;
  presetKey: string;
  draftRange: TimeRange;
  appliedRange: TimeRange;
  rangeVersion: number;
  banner: string | null;
  setMode: (mode: DataMode) => void;
  setThemeMode: (themeMode: DashboardThemeMode) => void;
  setSocketStatus: (status: SocketStatus) => void;
  enableFallbackPolling: (message: string) => void;
  resumeRealtime: () => void;
  setPaused: (paused: boolean) => void;
  setRefreshMs: (refreshMs: number) => void;
  setPresetKey: (presetKey: string) => void;
  applyPreset: (presetKey: string) => void;
  setDraftRange: (range: TimeRange) => void;
  applyRange: () => void;
  setBanner: (message: string | null) => void;
};

const initialRange = buildRange(subHours(new Date(), 1), new Date());

const defaultState = {
  mode: 'realtime' as DataMode,
  themeMode: 'Default' as DashboardThemeMode,
  socketStatus: 'disconnected' as SocketStatus,
  fallbackPolling: false,
  canResumeRealtime: false,
  paused: false,
  refreshMs: 30_000,
  presetKey: '1h',
  draftRange: initialRange,
  appliedRange: initialRange,
  rangeVersion: 0,
  banner: null,
};

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      ...defaultState,
      setMode: (mode) => {
        set({
          mode,
          fallbackPolling: false,
          canResumeRealtime: false,
          banner: null,
        });
      },
      setThemeMode: (themeMode) => set({ themeMode }),
      setSocketStatus: (status) => {
        const state = get();
        const next = {
          socketStatus: status,
          canResumeRealtime:
            status === 'connected' && state.mode === 'realtime' && state.fallbackPolling,
        };

        set(next);
      },
      enableFallbackPolling: (message) => {
        set({
          fallbackPolling: true,
          banner: message,
        });
      },
      resumeRealtime: () => {
        set({
          fallbackPolling: false,
          canResumeRealtime: false,
          banner: null,
        });
      },
      setPaused: (paused) => set({ paused }),
      setRefreshMs: (refreshMs) => set({ refreshMs }),
      setPresetKey: (presetKey) => set({ presetKey }),
      applyPreset: (presetKey) => {
        const preset = RANGE_PRESETS.find((item) => item.key === presetKey);
        if (!preset) {
          return;
        }

        const range = preset.getRange();
        set((state) => ({
          presetKey,
          draftRange: range,
          appliedRange: range,
          rangeVersion: state.rangeVersion + 1,
        }));
      },
      setDraftRange: (range) => set({ draftRange: range }),
      applyRange: () => {
        const { draftRange } = get();
        set((state) => ({
          appliedRange: draftRange,
          rangeVersion: state.rangeVersion + 1,
        }));
      },
      setBanner: (banner) => set({ banner }),
    }),
    {
      name: 'fluxcy-dashboard-store',
      partialize: (state) => ({
        mode: state.mode,
        themeMode: state.themeMode,
        paused: state.paused,
        refreshMs: state.refreshMs,
        presetKey: state.presetKey,
      }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);


