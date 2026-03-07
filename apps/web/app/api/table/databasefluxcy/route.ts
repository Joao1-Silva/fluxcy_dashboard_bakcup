import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { fetchExternal, fetchWithRangeFallback } from '@/lib/bff/external-api';
import { coerceNumber, toRows } from '@/lib/bff/normalizers';
import { parseRangeQuery } from '@/lib/bff/query';
import type { TableRow } from '@/types/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIME_KEYS = [
  'timestamp',
  'timestamp_hmi',
  'time',
  't',
  'datetime',
  'fecha_hora',
  'fechaHora',
  'fecha_creacion_iso',
  '_time',
] as const;

const FIELD_ALIASES = {
  ivo_liq: ['vliq', 'totalliq', 'liq_acum', 'total_liq'],
  ivo_gas: ['vgas', 'totalgas', 'gas_acum', 'total_gas'],
  qm_liq: ['qm_liq', 'qmliq', 'qmLiq', 'liquido'],
  qm_gas: ['qm_gas', 'qmgas', 'qmGas', 'gas'],
  vdf_amp: ['vdf_amp', 'amp', 'amperaje', 'motor_amp'],
  vdf_cons: ['vdf_cons', 'cons', 'consumo', 'kw', 'vdf_consumo'],
  vdf_tor: ['vdf_tor', 'torque', 'tor', 'vdf_torque', 'motor_torque'],
  vdf_vel: ['vdf_vel', 'rpm', 'vdf_rpm', 'motor_rpm'],
} as const;

type FieldKey = keyof typeof FIELD_ALIASES;

function toIsoTime(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function pickTime(row: Record<string, unknown>): string | null {
  for (const key of TIME_KEYS) {
    const time = toIsoTime(row[key]);
    if (time) {
      return time;
    }
  }

  return null;
}

function pickNumber(row: Record<string, unknown>, aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    const parsed = coerceNumber(row[alias]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function emptyNormalizedRow(time: string): TableRow {
  return {
    time,
    ivo_liq: null,
    ivo_gas: null,
    qm_liq: null,
    qm_gas: null,
    vdf_amp: null,
    vdf_cons: null,
    vdf_tor: null,
    vdf_vel: null,
  };
}

function normalizeDatabaseFluxcyTable(payload: unknown, fromIso: string, toIso: string): TableRow[] {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  const rows = toRows(payload) as Array<Record<string, unknown>>;

  const mergedByTime = new Map<string, TableRow>();

  for (const row of rows) {
    const time = pickTime(row);
    if (!time) {
      continue;
    }

    const timeMs = Date.parse(time);
    if (!Number.isFinite(timeMs) || timeMs < fromMs || timeMs > toMs) {
      continue;
    }

    const current = mergedByTime.get(time) ?? emptyNormalizedRow(time);

    (Object.keys(FIELD_ALIASES) as FieldKey[]).forEach((field) => {
      if (typeof current[field] === 'number') {
        return;
      }

      const value = pickNumber(row, FIELD_ALIASES[field]);
      if (value !== null) {
        current[field] = value;
      }
    });

    mergedByTime.set(time, current);
  }

  return [...mergedByTime.values()].sort((a, b) => b.time.localeCompare(a.time));
}

export async function GET(request: NextRequest) {
  const range = parseRangeQuery(request);
  if (!range.ok) {
    return NextResponse.json({ message: range.message }, { status: 400 });
  }

  try {
    const rangedPayload = await fetchWithRangeFallback('/databasefluxcy', {
      from: range.data.from,
      to: range.data.to,
    });

    let normalized = normalizeDatabaseFluxcyTable(rangedPayload, range.data.from, range.data.to);

    if (normalized.length === 0) {
      const fullPayload = await fetchExternal('/databasefluxcy');
      normalized = normalizeDatabaseFluxcyTable(fullPayload, range.data.from, range.data.to);
    }

    return NextResponse.json({ table: normalized.slice(0, range.data.limit ?? 200) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = message.includes('Finalizo su prueba') ? 403 : 500;
    return NextResponse.json({ message }, { status });
  }
}
