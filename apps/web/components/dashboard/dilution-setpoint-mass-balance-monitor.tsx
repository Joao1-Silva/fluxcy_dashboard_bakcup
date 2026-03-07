'use client';

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDilutionWindowMetrics, type QtAggregationMode } from '@/hooks/use-dilution-window-metrics';
import type { DashboardDataHookResult } from '@/hooks/use-dashboard-data';
import {
  DILUTION_STORAGE_KEYS,
  getStoredBoolean,
  getStoredString,
  setStoredBoolean,
  setStoredString,
} from '@/lib/dilution-local-storage';
import { computeDilutionSetpoint } from '@/lib/dilution-setpoint-calculator';
import { formatNumeric, formatTimeLabel } from '@/lib/time';

type DilutionSetpointMassBalanceMonitorProps = {
  data: DashboardDataHookResult;
};

const FLOW_UNIT = 'Bls/d';
const DEFAULT_RATIO_DIL = 0.3;

function parseNumberInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWcInput(raw: string): number | null {
  const parsed = parseNumberInput(raw);
  if (parsed === null) {
    return null;
  }

  if (parsed >= 1 && parsed <= 100) {
    return parsed / 100;
  }

  if (parsed >= 0 && parsed < 1) {
    return parsed;
  }

  return null;
}

function formatWcFraction(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return `${formatNumeric(value * 100, 2)}%`;
}

function resolveDeltaAction(delta: number) {
  if (delta > 0) {
    return '↑ Subir inyeccion de diluente';
  }
  if (delta < 0) {
    return '↓ Bajar inyeccion de diluente';
  }
  return '= En setpoint';
}

export function DilutionSetpointMassBalanceMonitor({ data }: DilutionSetpointMassBalanceMonitorProps) {
  const [qdActualInput, setQdActualInput] = useState(() =>
    getStoredString(DILUTION_STORAGE_KEYS.qdActual, '0'),
  );
  const [apiDiluenteInput, setApiDiluenteInput] = useState(() =>
    getStoredString(DILUTION_STORAGE_KEYS.apiDil, ''),
  );
  const [wcManualInput, setWcManualInput] = useState(() =>
    getStoredString(DILUTION_STORAGE_KEYS.wcOverride, '0'),
  );
  const [wcOverrideEnabled, setWcOverrideEnabled] = useState(() =>
    getStoredBoolean(DILUTION_STORAGE_KEYS.wcOverrideEnabled, false),
  );
  const [qtMode, setQtMode] = useState<QtAggregationMode>(() =>
    getStoredString(DILUTION_STORAGE_KEYS.calcMode, 'avg') === 'delta' ? 'delta' : 'avg',
  );
  const [rhoWaterInput, setRhoWaterInput] = useState('1');

  useEffect(() => {
    setStoredString(DILUTION_STORAGE_KEYS.qdActual, qdActualInput);
  }, [qdActualInput]);

  useEffect(() => {
    setStoredString(DILUTION_STORAGE_KEYS.apiDil, apiDiluenteInput);
  }, [apiDiluenteInput]);

  useEffect(() => {
    setStoredString(DILUTION_STORAGE_KEYS.wcOverride, wcManualInput);
  }, [wcManualInput]);

  useEffect(() => {
    setStoredBoolean(DILUTION_STORAGE_KEYS.wcOverrideEnabled, wcOverrideEnabled);
  }, [wcOverrideEnabled]);

  useEffect(() => {
    setStoredString(DILUTION_STORAGE_KEYS.calcMode, qtMode);
  }, [qtMode]);

  const windowMetrics = useDilutionWindowMetrics(data, qtMode);

  const qdActual = useMemo(() => parseNumberInput(qdActualInput), [qdActualInput]);
  const manualWc = useMemo(() => parseWcInput(wcManualInput), [wcManualInput]);
  const rhoWater = useMemo(() => parseNumberInput(rhoWaterInput), [rhoWaterInput]);

  const hasWcData = windowMetrics.wcData !== null;
  const useManualWc = !hasWcData || wcOverrideEnabled;
  const wcForCalculation = useManualWc ? manualWc : windowMetrics.wcData;

  const calculation = useMemo(() => {
    if (windowMetrics.qtSelected === null) {
      return {
        ok: false as const,
        message:
          qtMode === 'delta'
            ? 'No hay puntos suficientes de qm_liq para modo delta en la ventana activa.'
            : 'No hay datos suficientes de qm_liq en la ventana activa.',
      };
    }

    if (qdActual === null) {
      return {
        ok: false as const,
        message: 'Ingresa un valor numerico para Qd_actual.',
      };
    }

    if (wcForCalculation === null) {
      return {
        ok: false as const,
        message: 'Ingresa WC valido en [0,1) o [0,100].',
      };
    }

    return computeDilutionSetpoint({
      Qt: windowMetrics.qtSelected,
      WC: wcForCalculation,
      Qd_actual: qdActual,
      ratioDil: DEFAULT_RATIO_DIL,
    });
  }, [qdActual, qtMode, wcForCalculation, windowMetrics.qtSelected]);

  const diagnostics = useMemo(() => {
    const warnings: string[] = [];
    let rhoHcCorr: number | null = null;
    let apiMixCorr: number | null = null;

    if (windowMetrics.rhoLine15 === null) {
      warnings.push('rho_line no disponible en ventana (se omite API_mix_corr).');
      return { warnings, rhoHcCorr, apiMixCorr };
    }

    if (wcForCalculation === null) {
      warnings.push('WC no disponible para diagnostico.');
      return { warnings, rhoHcCorr, apiMixCorr };
    }

    if (rhoWater === null || rhoWater <= 0) {
      warnings.push('rho_w debe ser numerico y > 0.');
      return { warnings, rhoHcCorr, apiMixCorr };
    }

    const denominator = 1 - wcForCalculation;
    if (!(denominator > 0)) {
      warnings.push('WC invalido para calcular rho_hc_corr.');
      return { warnings, rhoHcCorr, apiMixCorr };
    }

    rhoHcCorr = (windowMetrics.rhoLine15 - wcForCalculation * rhoWater) / denominator;
    if (!Number.isFinite(rhoHcCorr) || rhoHcCorr <= 0) {
      warnings.push('rho_hc_corr fuera de rango fisico.');
      return { warnings, rhoHcCorr: null, apiMixCorr: null };
    }

    apiMixCorr = 141.5 / rhoHcCorr - 131.5;
    if (!Number.isFinite(apiMixCorr)) {
      warnings.push('API_mix_corr invalido (NaN/Infinity).');
      return { warnings, rhoHcCorr, apiMixCorr: null };
    }

    if (apiMixCorr < 0 || apiMixCorr > 80) {
      warnings.push('API_mix_corr fuera del rango tipico 0-80 API.');
    }

    return { warnings, rhoHcCorr, apiMixCorr };
  }, [rhoWater, wcForCalculation, windowMetrics.rhoLine15]);

  const wcSourceLabel = useMemo(() => {
    if (useManualWc) {
      return 'manual';
    }
    if (windowMetrics.wcSource === 'series') {
      return 'serie';
    }
    if (windowMetrics.wcSource === 'table') {
      return 'tabla';
    }
    return 'sin data';
  }, [useManualWc, windowMetrics.wcSource]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dilution Setpoint & Mass-Balance Monitor (70/30)</CardTitle>
        <CardDescription>
          Monitor en vivo para controlar dilucion sobre hidrocarburo usando qm_liq y WC en la
          ventana activa del rango seleccionado.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="dilution-qd-actual">Inyeccion actual de diluente (Qd_actual)</Label>
            <Input
              id="dilution-qd-actual"
              inputMode="decimal"
              value={qdActualInput}
              onChange={(event) => setQdActualInput(event.target.value)}
              placeholder={`Ej: 120 (${FLOW_UNIT})`}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dilution-api-dil">API de diluente (opcional)</Label>
            <Input
              id="dilution-api-dil"
              inputMode="decimal"
              value={apiDiluenteInput}
              onChange={(event) => setApiDiluenteInput(event.target.value)}
              placeholder="Ej: 42"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dilution-qt-mode">Modo de Qt</Label>
            <select
              id="dilution-qt-mode"
              className="h-10 w-full rounded-xl border border-slate-700/70 bg-slate-900/85 px-3 text-sm text-slate-100"
              value={qtMode}
              onChange={(event) => setQtMode(event.target.value === 'delta' ? 'delta' : 'avg')}
            >
              <option value="avg">Promedio ponderado (rate)</option>
              <option value="delta">Delta (totalizador)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dilution-wc-input">
              Water cut (WC) {useManualWc ? '(manual)' : '(data)'}
            </Label>
            <Input
              id="dilution-wc-input"
              inputMode="decimal"
              value={useManualWc ? wcManualInput : formatWcFraction(windowMetrics.wcData)}
              onChange={(event) => setWcManualInput(event.target.value)}
              placeholder="Ej: 0.15 o 15"
              readOnly={!useManualWc}
            />
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wcOverrideEnabled}
                  onChange={(event) => setWcOverrideEnabled(event.target.checked)}
                  disabled={!hasWcData}
                />
                Override manual
              </label>
              <Badge variant="muted">WC source: {wcSourceLabel}</Badge>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Ventana activa: {formatTimeLabel(windowMetrics.windowStartIso)} -{' '}
          {formatTimeLabel(windowMetrics.windowEndIso)}
        </p>

        {calculation.ok ? (
          <div className="space-y-3 rounded-xl border border-sky-400/30 bg-slate-900/70 p-3 text-sm">
            <div className="grid gap-2 md:grid-cols-3">
              <p>
                Qd_target (recomendado):{' '}
                <span className="font-semibold text-sky-300">
                  {formatNumeric(calculation.result.Qd_target, 2)} {FLOW_UNIT}
                </span>
              </p>
              <p>
                delta_Qd:{' '}
                <span className="font-semibold text-amber-300">
                  {formatNumeric(calculation.result.delta_Qd, 2)} {FLOW_UNIT}
                </span>
              </p>
              <p>
                Accion:{' '}
                <span className="font-semibold text-slate-100">
                  {resolveDeltaAction(calculation.result.delta_Qd)}
                </span>
              </p>
              <p>
                Qf_est (formacion):{' '}
                <span className="font-semibold text-emerald-300">
                  {formatNumeric(calculation.result.Qf_est, 2)} {FLOW_UNIT}
                </span>
              </p>
              <p>
                Qt_ventana:{' '}
                <span className="font-semibold text-slate-100">
                  {formatNumeric(calculation.result.Qt, 2)} {FLOW_UNIT}
                </span>
              </p>
              <p>
                WC_ventana:{' '}
                <span className="font-semibold text-slate-100">{formatWcFraction(calculation.result.WC)}</span>
              </p>
              <p>
                Qhc_ventana:{' '}
                <span className="font-semibold text-slate-100">
                  {formatNumeric(calculation.result.Qhc_15, 2)} {FLOW_UNIT}
                </span>
              </p>
              <p>
                Puntos qm_liq:{' '}
                <span className="font-semibold text-slate-100">{windowMetrics.qmPoints}</span>
              </p>
              <p>
                Puntos WC:{' '}
                <span className="font-semibold text-slate-100">{windowMetrics.wcPoints}</span>
              </p>
            </div>

            <details className="rounded-lg border border-slate-700/70 p-2 text-sm text-slate-300">
              <summary className="cursor-pointer select-none">Diagnostico</summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <p>
                  rho_line_ventana:{' '}
                  <span className="font-semibold text-slate-100">
                    {formatNumeric(windowMetrics.rhoLine15, 5)} g/cm3
                  </span>
                </p>
                <p>
                  rho_w (config): <span className="font-semibold text-slate-100">{formatNumeric(rhoWater ?? null, 5)} g/cm3</span>
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="dilution-rho-water">Ajustar rho_w</Label>
                  <Input
                    id="dilution-rho-water"
                    inputMode="decimal"
                    value={rhoWaterInput}
                    onChange={(event) => setRhoWaterInput(event.target.value)}
                    placeholder="1.0"
                  />
                </div>
                <p>
                  API_mix_corr aprox:{' '}
                  <span className="font-semibold text-slate-100">{formatNumeric(diagnostics.apiMixCorr, 2)} API</span>
                </p>
                <p>
                  rho_hc_corr:{' '}
                  <span className="font-semibold text-slate-100">{formatNumeric(diagnostics.rhoHcCorr, 5)} g/cm3</span>
                </p>
                <p>
                  API de diluente (usuario):{' '}
                  <span className="font-semibold text-slate-100">
                    {formatNumeric(parseNumberInput(apiDiluenteInput), 2)}
                  </span>
                </p>
                <p>
                  Puntos rho_line:{' '}
                  <span className="font-semibold text-slate-100">{windowMetrics.rhoPoints}</span>
                </p>
              </div>

              {diagnostics.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-amber-300">
                  {diagnostics.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </details>
          </div>
        ) : (
          <p
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200"
          >
            {calculation.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
