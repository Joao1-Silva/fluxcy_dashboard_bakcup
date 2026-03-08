import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { fetchExternal } from '@/lib/bff/external-api';
import { normalizeSeries } from '@/lib/bff/normalizers';
import { parseRangeQuery } from '@/lib/bff/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const EXTERNAL_SERIES_TIME_SHIFT_MS = 60 * 60 * 1000;

function shiftIsoTimestamp(iso: string, shiftMs: number) {
  const epoch = new Date(iso).getTime();
  if (Number.isNaN(epoch)) {
    return iso;
  }
  return new Date(epoch + shiftMs).toISOString();
}

export async function GET(request: NextRequest) {
  const range = parseRangeQuery(request);
  if (!range.ok) {
    return NextResponse.json({ message: range.message }, { status: 400 });
  }

  try {
    const payload = await fetchExternal('/rho', {
      from: range.data.from,
      to: range.data.to,
    });

    const normalized = normalizeSeries(payload, ['rho_liq', 'rho_gas']);
    const shifted = {
      series: normalized.series.map((point) => ({
        ...point,
        t: shiftIsoTimestamp(point.t, EXTERNAL_SERIES_TIME_SHIFT_MS),
      })),
    };

    return NextResponse.json(shifted);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = message.includes('Finalizo su prueba') ? 403 : 500;
    return NextResponse.json({ message }, { status });
  }
}
