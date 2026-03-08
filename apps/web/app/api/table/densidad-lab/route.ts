import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { fetchWithRangeFallback } from '@/lib/bff/external-api';
import { normalizeTable } from '@/lib/bff/normalizers';
import { parseRangeQuery } from '@/lib/bff/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const range = parseRangeQuery(request, { capToNow: true });
  if (!range.ok) {
    return NextResponse.json({ message: range.message }, { status: 400 });
  }

  try {
    const payload = await fetchWithRangeFallback('/densidad_lab_changes', {
      from: range.data.from,
      to: range.data.to,
    });

    const normalized = normalizeTable(payload, ['densidad_lab']);
    return NextResponse.json({ table: normalized.table.slice(0, range.data.limit ?? 100) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = message.includes('Finalizo su prueba') ? 403 : 500;
    return NextResponse.json({ message }, { status });
  }
}
