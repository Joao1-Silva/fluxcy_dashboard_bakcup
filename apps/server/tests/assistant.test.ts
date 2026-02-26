import { describe, expect, it } from 'vitest';

import { buildAssistantAnalysis, buildAxisScale, type AssistantSourceMeta } from '../src/lib/assistant.js';

function isoMinute(baseMs: number, minuteOffset: number): string {
  return new Date(baseMs + minuteOffset * 60_000).toISOString();
}

describe('assistant analytics', () => {
  it('computes axis scale with nice pow2 defaults for high ranges', () => {
    const baseMs = Date.parse('2026-02-25T00:00:00Z');
    const qm = Array.from({ length: 10 }, (_, index) => ({
      time: isoMinute(baseMs, index),
      qm_liq: 120 + index,
      qm_gas: 250 + index * 2,
    }));

    const axis = buildAxisScale(
      {
        from: '2026-02-25T00:00:00Z',
        to: '2026-02-25T01:00:00Z',
        mode: 'auto',
      },
      { qm },
    );

    expect(axis.algorithm).toBe('pow2');
    expect(axis.maxAxis).toBeGreaterThanOrEqual(axis.maxObserved);
    expect(axis.tickStep).toBe(axis.maxAxis / 4);
  });

  it('produces deterministic findings with evidence and no persistence', () => {
    const from = '2026-02-25T00:00:00Z';
    const to = '2026-02-25T03:00:00Z';
    const baseMs = Date.parse(from);

    const qm = Array.from({ length: 160 }, (_, index) => {
      const t = isoMinute(baseMs, index);
      const liqBase = index < 80 ? 80 + index * 0.4 : 130 + (index - 80) * 0.2;
      const qm_liq = index === 120 ? liqBase + 180 : liqBase;
      return {
        time: t,
        qm_liq,
        qm_gas: 60 + index * 0.3,
      };
    }).filter((_, index) => index < 40 || index > 55);

    const produccion = Array.from({ length: 160 }, (_, index) => ({
      time: isoMinute(baseMs, index),
      liq_acum: 2_000 + index * 3.5,
      gas_acum: 1_500 + index * 2.2,
    }));

    const databasefluxcy = Array.from({ length: 160 }, (_, index) => ({
      time: isoMinute(baseMs, index),
      pres_f_liq: 40 + index * 0.25,
      pres_f_gas: 35 + index * 0.18,
      rpm: 950 + index,
      torque: 120 + index * 0.12,
      amp: 65 + index * 0.05,
      densidad_liq: 0.88 + index * 0.0002,
      densidad_gas: 0.62 + index * 0.0001,
      h2o: 12 + Math.sin(index / 8),
    }));

    const sourceMeta: AssistantSourceMeta[] = [
      { endpoint: '/qm', ok: true, latencyMs: 10, fallback: false, rowCount: qm.length },
      { endpoint: '/produccion', ok: true, latencyMs: 10, fallback: false, rowCount: produccion.length },
      {
        endpoint: '/databasefluxcy',
        ok: true,
        latencyMs: 10,
        fallback: false,
        rowCount: databasefluxcy.length,
      },
      { endpoint: '/clockmeter', ok: true, latencyMs: 5, fallback: false, rowCount: 0 },
      { endpoint: '/clockmeter_qm', ok: true, latencyMs: 5, fallback: false, rowCount: 0 },
    ];

    const result = buildAssistantAnalysis({
      input: {
        from,
        to,
        timezone: 'America/New_York',
      },
      payloads: {
        qm,
        produccion,
        databasefluxcy,
        clockmeter: [],
        clockmeterQm: [],
      },
      sources: sourceMeta,
    });

    expect(result.summary).toContain(from);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.dataQuality.issues.length).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.meta.interpolationApplied).toBe(false);
    expect(result.meta.algorithms).toContain('combined_robust_zscore');
  });
});
