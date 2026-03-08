import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { fetchExternal } from '@/lib/bff/external-api';
import { normalizeSeries } from '@/lib/bff/normalizers';
import { parsePositiveIntParam, parseRangeQuery } from '@/lib/bff/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const range = parseRangeQuery(request, { capToNow: true });
  if (!range.ok) {
    return NextResponse.json({ message: range.message }, { status: 400 });
  }

  const stepMin = parsePositiveIntParam(request, 'stepMin', 1, 60);
  if (!stepMin.ok) {
    return NextResponse.json({ message: stepMin.message }, { status: 400 });
  }

  try {
    const payload = await fetchExternal('/produccion', {
      from: range.data.from,
      to: range.data.to,
      stepMin: stepMin.data ?? 1,
    });

    return NextResponse.json(normalizeSeries(payload, ['liq_acum', 'gas_acum']));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = message.includes('Finalizo su prueba') ? 403 : 500;
    return NextResponse.json({ message }, { status });
  }
}
