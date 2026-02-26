'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { AuthGuard } from '@/components/auth/auth-guard';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { DashboardHealthModule } from '@/components/dashboard/dashboard-health-module';
import { GlobalBanner } from '@/components/layout/global-banner';
import { TaskDrawer } from '@/components/tasks/task-drawer';
import { useDashboardData } from '@/hooks/use-dashboard-data';
import { useSocketSync } from '@/hooks/use-socket-sync';
import { useAuthStore } from '@/store/auth-store';
import { useDashboardStore } from '@/store/dashboard-store';
import { useTaskStore } from '@/store/tasks-store';

export default function DashboardHealthPage() {
  const router = useRouter();

  const [smoothFlow, setSmoothFlow] = useState(true);
  const [alpha] = useState(0.05);

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const fallbackPolling = useDashboardStore((state) => state.fallbackPolling);
  const canResumeRealtime = useDashboardStore((state) => state.canResumeRealtime);
  const banner = useDashboardStore((state) => state.banner);
  const setBanner = useDashboardStore((state) => state.setBanner);
  const resumeRealtime = useDashboardStore((state) => state.resumeRealtime);

  const setDrawerOpen = useTaskStore((state) => state.setDrawerOpen);

  const data = useDashboardData({ smoothFlow, alpha });
  useSocketSync({ smoothFlow, alpha });

  const snapshot = data.snapshotQuery.data?.snapshot;
  const canManageTasks = user?.role === 'superadmin';

  const allErrors = useMemo(
    () => [
      data.snapshotQuery.error,
      data.flowQuery.error,
      data.vpQuery.error,
      data.rhoQuery.error,
      data.produccionQuery.error,
      data.pressuresQuery.error,
      data.bswQuery.error,
      data.densidadLabQuery.error,
    ],
    [
      data.snapshotQuery.error,
      data.flowQuery.error,
      data.vpQuery.error,
      data.rhoQuery.error,
      data.produccionQuery.error,
      data.pressuresQuery.error,
      data.bswQuery.error,
      data.densidadLabQuery.error,
    ],
  );

  const lastError = useRef<string | null>(null);

  useEffect(() => {
    const firstError = allErrors.find(Boolean);
    if (!firstError) {
      return;
    }

    const message = firstError instanceof Error ? firstError.message : 'Error de datos';
    if (message === lastError.current) {
      return;
    }

    lastError.current = message;
    setBanner(message);
    toast.error(message);
  }, [allErrors, setBanner]);

  return (
    <AuthGuard>
      <main className="min-h-screen px-3 py-4 sm:px-4 lg:px-6 lg:py-6">
        <DashboardHeader
          moduleVariant="health"
          onOpenTasks={() => setDrawerOpen(true)}
          canManageTasks={canManageTasks}
          displayName={user?.displayName ?? 'Usuario'}
          role={user?.role ?? 'supervisor'}
          onLogout={() => {
            logout();
            router.replace('/login');
          }}
        />

        {banner ? (
          <GlobalBanner
            message={banner}
            actionLabel={fallbackPolling && canResumeRealtime ? 'Volver a realtime' : undefined}
            onAction={fallbackPolling && canResumeRealtime ? resumeRealtime : undefined}
          />
        ) : null}

        <DashboardHealthModule
          data={data}
          snapshot={snapshot}
          smoothFlow={smoothFlow}
          onToggleSmooth={() => setSmoothFlow((value) => !value)}
        />

        {canManageTasks ? <TaskDrawer /> : null}
      </main>
    </AuthGuard>
  );
}
