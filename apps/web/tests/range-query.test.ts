import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRangeQuery } from '@/lib/bff/query';

function buildRequest(url: string) {
  return new NextRequest(url);
}

describe('parseRangeQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T15:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps historical ranges unchanged', () => {
    const request = buildRequest(
      'http://localhost:3001/api/series/produccion?from=2026-03-08T13:00:00.000Z&to=2026-03-08T14:00:00.000Z',
    );
    const parsed = parseRangeQuery(request);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.data.from).toBe('2026-03-08T13:00:00.000Z');
    expect(parsed.data.to).toBe('2026-03-08T14:00:00.000Z');
  });

  it('keeps future `to` values when capToNow is disabled', () => {
    const request = buildRequest(
      'http://localhost:3001/api/series/produccion?from=2026-03-08T14:00:00.000Z&to=2026-03-08T16:00:00.000Z',
    );
    const parsed = parseRangeQuery(request);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.data.from).toBe('2026-03-08T14:00:00.000Z');
    expect(parsed.data.to).toBe('2026-03-08T16:00:00.000Z');
  });

  it('caps future `to` values at current server time when capToNow is enabled', () => {
    const request = buildRequest(
      'http://localhost:3001/api/series/produccion?from=2026-03-08T14:00:00.000Z&to=2026-03-08T16:00:00.000Z',
    );
    const parsed = parseRangeQuery(request, { capToNow: true });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.data.from).toBe('2026-03-08T14:00:00.000Z');
    expect(parsed.data.to).toBe('2026-03-08T15:30:00.000Z');
  });

  it('rejects ranges when `from` is after clamped `to`', () => {
    const request = buildRequest(
      'http://localhost:3001/api/series/produccion?from=2026-03-08T15:40:00.000Z&to=2026-03-08T16:00:00.000Z',
    );
    const parsed = parseRangeQuery(request, { capToNow: true });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }

    expect(parsed.message).toContain('from debe ser menor');
  });
});
