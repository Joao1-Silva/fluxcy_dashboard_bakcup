import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { fetchExternal, fetchWithRangeFallback } from '@/lib/bff/external-api';
import { normalizeSeries } from '@/lib/bff/normalizers';
import { parseRangeQuery } from '@/lib/bff/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const range = parseRangeQuery(request, { capToNow: true });
  if (!range.ok) {
    return NextResponse.json({ message: range.message }, { status: 400 });
  }

  try {
    const produccionPayload = await fetchExternal('/produccion', {
      from: range.data.from,
      to: range.data.to,
      stepMin: 1,
    });

    const produccionSeries = normalizeSeries(produccionPayload, ['liq_acum', 'vliq', 'totalliq']);
    if (produccionSeries.series.length > 0) {
      return NextResponse.json(produccionSeries);
    }

    const payload = await fetchWithRangeFallback('/total', {
      from: range.data.from,
      to: range.data.to,
    });

    return NextResponse.json(normalizeSeries(payload, ['liq_acum', 'vliq', 'totalliq']));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = message.includes('Finalizo su prueba') ? 403 : 500;
    return NextResponse.json({ message }, { status });
  }
}
