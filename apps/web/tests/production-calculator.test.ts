import { describe, expect, it } from 'vitest';

import { calculateProductionByIvo } from '@/lib/production-calculator';

describe('production calculator', () => {
  it('calcula proyeccion y neto correctamente', () => {
    const result = calculateProductionByIvo({
      fromIso: '2026-02-26T20:00:00.000Z',
      toIso: '2026-02-26T23:00:00.000Z',
      ivoLiqFrom: 100,
      ivoLiqTo: 130,
      diluentBarrels: 10,
      waterPercent: 20,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.result.hours).toBe(3);
    expect(result.result.hourlyRate).toBe(10);
    expect(result.result.projected24h).toBe(240);
    expect(result.result.grossBarrels).toBe(230);
    expect(result.result.waterBarrels).toBe(46);
    expect(result.result.netBarrels).toBe(184);
  });

  it('falla si el rango no es valido', () => {
    const result = calculateProductionByIvo({
      fromIso: '2026-02-26T23:00:00.000Z',
      toIso: '2026-02-26T20:00:00.000Z',
      ivoLiqFrom: 100,
      ivoLiqTo: 130,
      diluentBarrels: 0,
      waterPercent: 0,
    });

    expect(result.ok).toBe(false);
  });

  it('falla si el diluente supera el volumen total proyectado', () => {
    const result = calculateProductionByIvo({
      fromIso: '2026-02-26T20:00:00.000Z',
      toIso: '2026-02-26T23:00:00.000Z',
      ivoLiqFrom: 100,
      ivoLiqTo: 101,
      diluentBarrels: 20,
      waterPercent: 10,
    });

    expect(result.ok).toBe(false);
  });
});
