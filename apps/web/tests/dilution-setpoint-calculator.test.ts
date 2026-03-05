import { describe, expect, it } from 'vitest';

import { computeDilutionSetpoint } from '@/lib/dilution-setpoint-calculator';

describe('dilution setpoint calculator', () => {
  it('calcula setpoint 70/30 correctamente con entradas validas', () => {
    const result = computeDilutionSetpoint({
      Qt: 100,
      WC: 0.2,
      Qd_actual: 20,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.result.Qhc_15).toBeCloseTo(80, 6);
    expect(result.result.Qd_target).toBeCloseTo(24, 6);
    expect(result.result.Qf_est).toBeCloseTo(56, 6);
    expect(result.result.delta_Qd).toBeCloseTo(4, 6);
  });

  it('falla cuando Qd_actual es negativo', () => {
    const result = computeDilutionSetpoint({
      Qt: 100,
      WC: 0.1,
      Qd_actual: -1,
    });

    expect(result.ok).toBe(false);
  });

  it('falla cuando WC esta fuera de rango', () => {
    const result = computeDilutionSetpoint({
      Qt: 100,
      WC: 1,
      Qd_actual: 10,
    });

    expect(result.ok).toBe(false);
  });

  it('falla cuando la salida no es numericamente valida', () => {
    const result = computeDilutionSetpoint({
      Qt: Number.MIN_VALUE,
      WC: 1 - Number.EPSILON,
      Qd_actual: 0,
    });

    expect(result.ok).toBe(false);
  });
});
