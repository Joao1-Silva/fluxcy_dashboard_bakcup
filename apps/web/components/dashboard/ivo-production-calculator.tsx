'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchJson, querySignal } from '@/lib/api-client';
import { extractIvoRange } from '@/lib/ivo-series';
import { calculateProductionByIvo } from '@/lib/production-calculator';
import { formatNumeric, toDateTimeLocalInput } from '@/lib/time';
import { useDashboardStore } from '@/store/dashboard-store';
import type { SeriesResponse } from '@/types/dashboard';

function parseNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

export function IvoProductionCalculator() {
  const appliedRange = useDashboardStore((state) => state.appliedRange);

  const [fromIso, setFromIso] = useState(appliedRange.from);
  const [toIso, setToIso] = useState(appliedRange.to);
  const [diluent, setDiluent] = useState('0');
  const [waterPercent, setWaterPercent] = useState('0');

  const ivoQuery = useQuery({
    queryKey: ['series', 'ivo-liq', 'calculator', fromIso, toIso],
    queryFn: (ctx) =>
      fetchJson<SeriesResponse>('/api/series/ivo-liq', {
        signal: querySignal(ctx),
        params: {
          from: fromIso,
          to: toIso,
        },
      }),
    staleTime: 5_000,
  });

  const ivoRange = useMemo(() => extractIvoRange(ivoQuery.data?.series ?? []), [ivoQuery.data?.series]);

  const calculation = useMemo(() => {
    const parsedDiluent = parseNumber(diluent) ?? 0;
    const parsedWater = parseNumber(waterPercent) ?? 0;

    if (ivoQuery.error instanceof Error) {
      return {
        ok: false as const,
        message: `No fue posible cargar IVO Liq para el rango: ${ivoQuery.error.message}`,
      };
    }

    if (!ivoRange) {
      return {
        ok: false as const,
        message:
          ivoQuery.isLoading || ivoQuery.isFetching
            ? 'Cargando IVO Liq del rango seleccionado...'
            : 'No hay datos de IVO Liq para el rango seleccionado.',
      };
    }

    return calculateProductionByIvo({
      fromIso,
      toIso,
      ivoLiqFrom: ivoRange.ivoFrom,
      ivoLiqTo: ivoRange.ivoTo,
      diluentBarrels: parsedDiluent,
      waterPercent: parsedWater,
    });
  }, [fromIso, toIso, ivoRange, diluent, waterPercent, ivoQuery.error, ivoQuery.isFetching, ivoQuery.isLoading]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calculadora IVO Liq (Produccion Aprox)</CardTitle>
        <CardDescription>
          Selecciona el rango y el sistema toma IVO Liq inicio/fin automaticamente. Solo ingresa diluente y agua.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Hora inicio</Label>
            <Input
              type="datetime-local"
              value={toDateTimeLocalInput(fromIso)}
              onChange={(event) => {
                if (!event.target.value) return;
                setFromIso(new Date(event.target.value).toISOString());
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Hora fin</Label>
            <Input
              type="datetime-local"
              value={toDateTimeLocalInput(toIso)}
              onChange={(event) => {
                if (!event.target.value) return;
                setToIso(new Date(event.target.value).toISOString());
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>IVO Liq inicio (auto)</Label>
            <Input
              readOnly
              value={ivoRange ? formatNumeric(ivoRange.ivoFrom, 2) : ''}
              placeholder={ivoQuery.isLoading || ivoQuery.isFetching ? 'Cargando...' : 'Sin datos'}
            />
          </div>
          <div className="space-y-1.5">
            <Label>IVO Liq fin (auto)</Label>
            <Input
              readOnly
              value={ivoRange ? formatNumeric(ivoRange.ivoTo, 2) : ''}
              placeholder={ivoQuery.isLoading || ivoQuery.isFetching ? 'Cargando...' : 'Sin datos'}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Barriles de diluente (Bls)</Label>
            <Input value={diluent} onChange={(event) => setDiluent(event.target.value)} placeholder="10" />
          </div>
          <div className="space-y-1.5">
            <Label>Porcentaje de agua (%)</Label>
            <Input
              value={waterPercent}
              onChange={(event) => setWaterPercent(event.target.value)}
              placeholder="15"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFromIso(appliedRange.from);
              setToIso(appliedRange.to);
            }}
          >
            Usar rango activo del dashboard
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDiluent('0');
              setWaterPercent('0');
            }}
          >
            Limpiar insumos
          </Button>
        </div>

        {calculation.ok ? (
          <div className="grid gap-2 rounded-xl border border-sky-400/30 bg-slate-900/70 p-3 text-sm md:grid-cols-3">
            <p>
              Horas del rango:{' '}
              <span className="font-semibold text-slate-100">{formatNumeric(calculation.result.hours, 2)}</span>
            </p>
            <p>
              IVO inicio / fin:{' '}
              <span className="font-semibold text-slate-100">
                {formatNumeric(ivoRange?.ivoFrom, 2)} / {formatNumeric(ivoRange?.ivoTo, 2)} Bls
              </span>
            </p>
            <p>
              Delta IVO Liq:{' '}
              <span className="font-semibold text-slate-100">
                {formatNumeric(calculation.result.ivoDelta, 2)} Bls
              </span>
            </p>
            <p>
              Promedio por hora:{' '}
              <span className="font-semibold text-slate-100">
                {formatNumeric(calculation.result.hourlyRate, 2)} Bls/h
              </span>
            </p>
            <p>
              Proyeccion 24h:{' '}
              <span className="font-semibold text-sky-300">
                {formatNumeric(calculation.result.projected24h, 2)} Bls
              </span>
            </p>
            <p>
              Brutos (Total - Diluente):{' '}
              <span className="font-semibold text-slate-100">
                {formatNumeric(calculation.result.grossBarrels, 2)} Bls
              </span>
            </p>
            <p>
              Agua descontada:{' '}
              <span className="font-semibold text-amber-300">
                {formatNumeric(calculation.result.waterBarrels, 2)} Bls
              </span>
            </p>
            <p>
              Barriles netos:{' '}
              <span className="font-semibold text-emerald-300">
                {formatNumeric(calculation.result.netBarrels, 2)} Bls
              </span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">{calculation.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
