'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';

import { APP_CONFIG } from '@/lib/app-config';
import { useDashboardStore } from '@/store/dashboard-store';
import type { Snapshot } from '@/types/dashboard';

type UseSocketSyncOptions = {
  smoothFlow: boolean;
  alpha: number;
};

export function useSocketSync({ smoothFlow, alpha }: UseSocketSyncOptions) {
  const mode = useDashboardStore((state) => state.mode);
  const appliedRange = useDashboardStore((state) => state.appliedRange);
  const socketStatus = useDashboardStore((state) => state.socketStatus);
  const fallbackPolling = useDashboardStore((state) => state.fallbackPolling);
  const setSocketStatus = useDashboardStore((state) => state.setSocketStatus);
  const enableFallbackPolling = useDashboardStore((state) => state.enableFallbackPolling);

  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const flowOptionsRef = useRef({ smoothFlow, alpha });

  useEffect(() => {
    flowOptionsRef.current = { smoothFlow, alpha };
  }, [smoothFlow, alpha]);

  useEffect(() => {
    if (mode !== 'realtime') {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocketStatus('disconnected');
      return;
    }

    if (!APP_CONFIG.socketUrl) {
      setSocketStatus('error');
      enableFallbackPolling('Socket no configurado en este despliegue. Fallback automatico a polling API.');
      return;
    }

    const socket = io(APP_CONFIG.socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 8_000,
      autoConnect: true,
    });

    socketRef.current = socket;
    setSocketStatus('disconnected');

    socket.on('connect', () => {
      setSocketStatus('connected');
    });

    socket.on('snapshot', (snapshot: Snapshot) => {
      queryClient.setQueryData(['snapshot'], { snapshot });
    });

    socket.on('series:flow', (series) => {
      const { appliedRange: range } = useDashboardStore.getState();
      const current = flowOptionsRef.current;

      queryClient.setQueryData(
        ['series', 'flow', range.from, range.to, current.smoothFlow, current.alpha],
        { series },
      );
    });

    socket.on('disconnect', () => {
      setSocketStatus('disconnected');
      enableFallbackPolling('Socket desconectado. Fallback automatico a polling API.');
    });

    socket.on('connect_error', (error) => {
      setSocketStatus('error');
      enableFallbackPolling('Error de socket. Fallback automatico a polling API.');
      toast.error(error.message || 'Socket connection error');
    });

    socket.on('server:error', (payload: { message?: string }) => {
      if (payload?.message) {
        toast.error(payload.message);
      }
    });

    return () => {
      socket.disconnect();
      socket.removeAllListeners();
      socketRef.current = null;
    };
  }, [mode, setSocketStatus, enableFallbackPolling, queryClient]);

  useEffect(() => {
    if (mode !== 'realtime' || socketStatus !== 'connected' || fallbackPolling || !socketRef.current) {
      return;
    }

    socketRef.current.emit('series:flow:request', {
      from: appliedRange.from,
      to: appliedRange.to,
      smooth: smoothFlow ? '1' : '0',
      alpha,
    });
  }, [mode, socketStatus, fallbackPolling, appliedRange.from, appliedRange.to, smoothFlow, alpha]);
}
