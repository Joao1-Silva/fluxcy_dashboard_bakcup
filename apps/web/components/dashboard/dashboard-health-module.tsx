'use client';

import { useMemo } from 'react';
import { GaugeCircle, Waves } from 'lucide-react';

import { DataTablePanel } from '@/components/dashboard/data-table-panel';
import {
  HealthDiagnosticsPanel,
  type HealthCheck,
  type HealthStatus,
} from '@/components/dashboard/health-diagnostics-panel';
import { GaugeCard } from '@/components/dashboard/gauge-card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { TimeSeriesPanel } from '@/components/dashboard/time-series-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardDataHookResult } from '@/hooks/use-dashboard-data';
import { formatNumeric } from '@/lib/time';
import type { SeriesPoint, Snapshot, TableRow } from '@/types/dashboard';

type DashboardHealthModuleProps = {
  data: DashboardDataHookResult;
  snapshot: Snapshot | undefined;
  smoothFlow: boolean;
  onToggleSmooth: () => void;
};

const STATUS_WEIGHT: Record<HealthStatus, number> = {
  OK: 0,
  WARN: 1,
  CRITICAL: 2,
};

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function latestSeriesValue(series: SeriesPoint[], key: string): number | null {
  const point = series.at(-1);
  return asNumber(point?.[key]);
}

function latestTimestamp(series: SeriesPoint[]): string | null {
  const point = series.at(-1);
  return typeof point?.t === 'string' ? point.t : null;
}

function ageSeconds(iso: string | null): number | null {
  if (!iso) {
    return null;
  }

  const millis = new Date(iso).getTime();
  if (Number.isNaN(millis)) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - millis) / 1000));
}

function statusFromAge(age: number | null, warn: number, critical: number): HealthStatus {
  if (age === null) {
    return 'CRITICAL';
  }
  if (age > critical) {
    return 'CRITICAL';
  }
  if (age > warn) {
    return 'WARN';
  }
  return 'OK';
}

function mergeStatus(checks: HealthCheck[]): HealthStatus {
  const worst = checks.reduce((max, row) => Math.max(max, STATUS_WEIGHT[row.status]), 0);
  if (worst === 2) {
    return 'CRITICAL';
  }
  if (worst === 1) {
    return 'WARN';
  }
  return 'OK';
}

function latestTableTime(rows: TableRow[]): string | null {
  if (rows.length === 0) {
    return null;
  }

  const latest = rows.reduce((current, row) => (row.time > current ? row.time : current), rows[0].time);
  return latest ?? null;
}

export function DashboardHealthModule({
  data,
  snapshot,
  smoothFlow,
  onToggleSmooth,
}: DashboardHealthModuleProps) {
  const flowSeries = useMemo(() => data.flowQuery.data?.series ?? [], [data.flowQuery.data?.series]);
  const vpSeries = useMemo(() => data.vpQuery.data?.series ?? [], [data.vpQuery.data?.series]);

  const recentFlow = useMemo(() => flowSeries.slice(-60), [flowSeries]);
  const recentVp = useMemo(() => vpSeries.slice(-60), [vpSeries]);

  const qmLiq = latestSeriesValue(flowSeries, 'qm_liq');
  const qmGas = latestSeriesValue(flowSeries, 'qm_gas');
  const psiLiq = snapshot?.psi_liq ?? latestSeriesValue(vpSeries, 'psi_liq');
  const tempLiq = snapshot?.temp_liquido ?? latestSeriesValue(vpSeries, 'temp_liq');

  const checks = useMemo<HealthCheck[]>(() => {
    const snapshotAge = ageSeconds(snapshot?.t ?? null);
    const flowAge = ageSeconds(latestTimestamp(flowSeries));
    const vpAge = ageSeconds(latestTimestamp(vpSeries));
    const pressureAge = ageSeconds(latestTableTime(data.pressuresQuery.data?.table ?? []));

    const coreValues = [qmLiq, qmGas, psiLiq, tempLiq];
    const missingValues = coreValues.filter((value) => value === null).length;

    return [
      {
        check: 'Freshness snapshot',
        status: statusFromAge(snapshotAge, 90, 240),
        detail:
          snapshotAge === null
            ? 'Sin timestamp'
            : `Ultimo dato hace ${snapshotAge}s (${snapshot?.t ?? 'N/A'})`,
      },
      {
        check: 'Freshness flow',
        status: statusFromAge(flowAge, 120, 300),
        detail: flowAge === null ? 'Sin serie flow' : `Ultimo punto hace ${flowAge}s`,
      },
      {
        check: 'Freshness VP',
        status: statusFromAge(vpAge, 120, 300),
        detail: vpAge === null ? 'Sin serie VP' : `Ultimo punto hace ${vpAge}s`,
      },
      {
        check: 'Freshness pressures',
        status: statusFromAge(pressureAge, 180, 420),
        detail: pressureAge === null ? 'Sin tabla de presiones' : `Ultima fila hace ${pressureAge}s`,
      },
      {
        check: 'Cobertura KPI',
        status: missingValues >= 2 ? 'CRITICAL' : missingValues === 1 ? 'WARN' : 'OK',
        detail: `${4 - missingValues}/4 KPI disponibles`,
      },
      {
        check: 'PSI separador',
        status: psiLiq === null ? 'CRITICAL' : psiLiq < 20 || psiLiq > 380 ? 'WARN' : 'OK',
        detail: psiLiq === null ? 'psi_liq no disponible' : `${formatNumeric(psiLiq)} psi`,
      },
      {
        check: 'Temperatura liquido',
        status: tempLiq === null ? 'CRITICAL' : tempLiq < 40 || tempLiq > 260 ? 'WARN' : 'OK',
        detail: tempLiq === null ? 'temp_liq no disponible' : `${formatNumeric(tempLiq)} F`,
      },
      {
        check: 'Caudales',
        status:
          qmLiq === null || qmGas === null
            ? 'CRITICAL'
            : qmLiq <= 0 || qmGas <= 0
              ? 'WARN'
              : 'OK',
        detail: `Liq ${formatNumeric(qmLiq)} Bls/d | Gas ${formatNumeric(qmGas)} MSCFD`,
      },
    ];
  }, [data.pressuresQuery.data?.table, flowSeries, qmGas, qmLiq, psiLiq, snapshot?.t, tempLiq, vpSeries]);

  const overall = mergeStatus(checks);

  return (
    <>
      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.snapshotQuery.isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[154px] rounded-2xl" />
            ))
          : (
              <>
                <KpiCard
                  label="Caudal liquido actual"
                  value={qmLiq}
                  unit="Bls/d"
                  subtitle="clockmeter_qm / qm_liq"
                  emphasized
                />
                <KpiCard
                  label="Gas actual"
                  value={qmGas}
                  unit="MSCFD"
                  subtitle="clockmeter_qm / qm_gas"
                  emphasized
                />
                <GaugeCard label="Presion separador" min={0} max={400} value={psiLiq} unit="psi" />
                <KpiCard label="Temp liquido" value={tempLiq} unit="F" subtitle="vp/temp_liq" />
              </>
            )}
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TimeSeriesPanel
          title="Tendencia corta: Flow (60 pts)"
          subtitle="qm_liq / qm_gas"
          data={recentFlow}
          loading={data.flowQuery.isLoading}
          lines={[
            { key: 'qm_liq', label: 'Liquido Bls/d', color: '#8b5cf6' },
            { key: 'qm_gas', label: 'Gas MSCFD', color: '#f97316' },
          ]}
          rightActions={
            <Button variant={smoothFlow ? 'default' : 'secondary'} size="sm" onClick={onToggleSmooth}>
              <Waves className="mr-1 h-4 w-4" />
              Smooth {smoothFlow ? 'ON' : 'OFF'}
            </Button>
          }
        />

        <TimeSeriesPanel
          title="Tendencia corta: VP (60 pts)"
          subtitle="temp_liq / psi_gas / psi_liq"
          data={recentVp}
          loading={data.vpQuery.isLoading}
          lines={[
            { key: 'temp_liq', label: 'Temp Liq', color: '#60a5fa' },
            { key: 'psi_gas', label: 'PSI Gas', color: '#22c55e' },
            { key: 'psi_liq', label: 'PSI Liq', color: '#f43f5e' },
          ]}
          rightActions={<GaugeCircle className="h-4 w-4 text-slate-400" />}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <HealthDiagnosticsPanel overall={overall} checks={checks} />

        <DataTablePanel
          title="Diagnostico de presiones"
          rows={data.pressuresQuery.data?.table ?? []}
          loading={data.pressuresQuery.isLoading}
          pageSize={6}
          columns={[
            { key: 'presion_cabezal', label: 'presion_cabezal' },
            { key: 'presion_casing', label: 'presion_casing' },
            { key: 'presion_linea', label: 'presion_linea' },
            { key: 'presion_macolla', label: 'presion_macolla' },
          ]}
        />
      </section>
    </>
  );
}
