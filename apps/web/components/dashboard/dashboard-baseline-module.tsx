'use client';

import { GaugeCircle, Waves } from 'lucide-react';

import { DataTablePanel } from '@/components/dashboard/data-table-panel';
import { DualKpiCard } from '@/components/dashboard/dual-kpi-card';
import { GaugeCard } from '@/components/dashboard/gauge-card';
import { IvoProductionCalculator } from '@/components/dashboard/ivo-production-calculator';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { TimeSeriesPanel } from '@/components/dashboard/time-series-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardDataHookResult } from '@/hooks/use-dashboard-data';
import type { Snapshot } from '@/types/dashboard';

type DashboardBaselineModuleProps = {
  data: DashboardDataHookResult;
  snapshot: Snapshot | undefined;
  smoothFlow: boolean;
  onToggleSmooth: () => void;
};

export function DashboardBaselineModule({
  data,
  snapshot,
  smoothFlow,
  onToggleSmooth,
}: DashboardBaselineModuleProps) {
  return (
    <>
      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        {data.snapshotQuery.isLoading
          ? Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="h-[154px] rounded-2xl" />
            ))
          : (
              <>
                <GaugeCard label="TP Liquido" min={0} max={400} value={snapshot?.psi_liq ?? null} unit="psi" />
                <GaugeCard label="TP Gas" min={0} max={400} value={snapshot?.psi_gas ?? null} unit="psi" />

                <DualKpiCard
                  title="DG Flow"
                  leftLabel="Gas"
                  rightLabel="Liquido"
                  leftValue={snapshot?.drive_gain_gas ?? null}
                  rightValue={snapshot?.drive_gain_liquido ?? null}
                />

                <DualKpiCard
                  title="Temps"
                  leftLabel="Liquido"
                  rightLabel="Gas"
                  leftValue={snapshot?.temp_liquido ?? null}
                  rightValue={snapshot?.temp_gas ?? null}
                  unit="F"
                />

                <KpiCard label="POS" value={snapshot?.posicion_valvula ?? null} emphasized />
                <KpiCard label="Densidad Linea" value={snapshot?.densidad ?? null} unit="g/cm3" />
                <KpiCard label="Total Liq" value={snapshot?.totalliq ?? null} unit="Bls" />
                <KpiCard label="Total Gas" value={snapshot?.totalgas ?? null} unit="MSCF" />
                <KpiCard label="API mezcla" value={snapshot?.api ?? null} unit="API" />
                <KpiCard label="Ivo Liq" value={snapshot?.vliq ?? null} unit="Bls" />
                <KpiCard label="Ivo Gas" value={snapshot?.vgas ?? null} unit="MSCF" />
                <KpiCard label="Delta P" value={snapshot?.delta_p ?? null} />
              </>
            )}
      </section>

      <section className="mb-5">
        <IvoProductionCalculator />
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TimeSeriesPanel
          title="Flow Rate"
          subtitle="qm_liq / qm_gas"
          data={data.flowQuery.data?.series ?? []}
          loading={data.flowQuery.isLoading}
          lines={[
            { key: 'qm_liq', label: 'Liquido Bls/d', color: '#38bdf8' },
            { key: 'qm_gas', label: 'Gas MSCFD', color: '#22d3ee' },
          ]}
          rightActions={
            <Button variant={smoothFlow ? 'default' : 'secondary'} size="sm" onClick={onToggleSmooth}>
              <Waves className="mr-1 h-4 w-4" />
              Smooth {smoothFlow ? 'ON' : 'OFF'}
            </Button>
          }
        />

        <TimeSeriesPanel
          title="VP"
          subtitle="temp_liq, temperatura_gas_f, psi_gas, psi_liq"
          data={data.vpQuery.data?.series ?? []}
          loading={data.vpQuery.isLoading}
          lines={[
            { key: 'temp_liq', label: 'Temp Liq', color: '#60a5fa' },
            { key: 'temperatura_gas_f', label: 'Temp Gas', color: '#f59e0b' },
            { key: 'psi_gas', label: 'PSI Gas', color: '#22c55e' },
            { key: 'psi_liq', label: 'PSI Liq', color: '#f43f5e' },
          ]}
        />

        <TimeSeriesPanel
          title="rHo"
          subtitle="rho_liq / rho_gas"
          data={data.rhoQuery.data?.series ?? []}
          loading={data.rhoQuery.isLoading}
          lines={[
            { key: 'rho_liq', label: 'rho_liq', color: '#818cf8' },
            { key: 'rho_gas', label: 'rho_gas', color: '#14b8a6' },
          ]}
        />

        <TimeSeriesPanel
          title="Pro Calc 1m"
          subtitle="liq_acum / gas_acum"
          data={data.produccionQuery.data?.series ?? []}
          loading={data.produccionQuery.isLoading}
          lines={[
            { key: 'liq_acum', label: 'liq_acum (Bls)', color: '#38bdf8' },
            { key: 'gas_acum', label: 'gas_acum (MSCF)', color: '#fb7185' },
          ]}
          rightActions={<GaugeCircle className="h-4 w-4 text-slate-400" />}
        />
      </section>

      <section className="grid grid-cols-1 gap-3">
        <DataTablePanel
          title="Pressures"
          rows={data.pressuresQuery.data?.table ?? []}
          loading={data.pressuresQuery.isLoading}
          columns={[
            { key: 'presion_cabezal', label: 'presion_cabezal' },
            { key: 'presion_casing', label: 'presion_casing' },
            { key: 'presion_linea', label: 'presion_linea' },
            { key: 'presion_macolla', label: 'presion_macolla' },
          ]}
        />

        <DataTablePanel
          title="BSW LAB Changes"
          rows={data.bswQuery.data?.table ?? []}
          loading={data.bswQuery.isLoading}
          columns={[{ key: 'bsw_lab', label: 'bsw_lab' }]}
          pageSize={6}
        />

        <DataTablePanel
          title="Densidad LAB Changes"
          rows={data.densidadLabQuery.data?.table ?? []}
          loading={data.densidadLabQuery.isLoading}
          columns={[{ key: 'densidad_lab', label: 'densidad_lab' }]}
          pageSize={6}
        />
      </section>
    </>
  );
}
