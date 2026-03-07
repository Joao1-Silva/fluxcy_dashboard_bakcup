export type DilutionSetpointInput = {
  Qt: number;
  WC: number;
  Qd_actual: number;
  ratioDil?: number;
};

export type DilutionSetpointResult = {
  Qt: number;
  WC: number;
  Qgross_15: number;
  Qhc_15: number;
  Qd_target: number;
  delta_Qd: number;
  Qf_est: number;
  ratioDil: number;
};

export type DilutionSetpointOutcome =
  | {
      ok: true;
      result: DilutionSetpointResult;
    }
  | {
      ok: false;
      message: string;
    };

const DEFAULT_DILUTION_RATIO = 0.3;

function isFiniteNumber(value: number) {
  return Number.isFinite(value) && !Number.isNaN(value);
}

export function computeDilutionSetpoint(input: DilutionSetpointInput): DilutionSetpointOutcome {
  const ratioDil = input.ratioDil ?? DEFAULT_DILUTION_RATIO;

  if (
    !isFiniteNumber(input.Qt) ||
    !isFiniteNumber(input.WC) ||
    !isFiniteNumber(input.Qd_actual) ||
    !isFiniteNumber(ratioDil)
  ) {
    return {
      ok: false,
      message: 'Entradas invalidas: revisa que todos los valores sean numericos.',
    };
  }

  if (input.Qd_actual < 0) {
    return {
      ok: false,
      message: 'Qd_actual debe ser mayor o igual a 0.',
    };
  }

  if (input.Qt <= 0) {
    return {
      ok: false,
      message: 'Qt_15 debe ser mayor a 0.',
    };
  }

  if (input.WC < 0 || input.WC >= 1) {
    return {
      ok: false,
      message: 'WC debe estar en el rango [0, 1).',
    };
  }

  if (ratioDil <= 0 || ratioDil >= 1) {
    return {
      ok: false,
      message: 'ratioDil debe estar en el rango (0, 1).',
    };
  }

  const Qgross_15 = input.Qt - input.Qd_actual;
  if (!(Qgross_15 > 0)) {
    return {
      ok: false,
      message: 'Qt debe ser mayor que Qd_actual para obtener volumen bruto de formacion.',
    };
  }

  const Qhc_15 = Qgross_15 * (1 - input.WC);
  if (!(Qhc_15 > 0)) {
    return {
      ok: false,
      message: 'No hay hidrocarburo suficiente en la ventana',
    };
  }

  const Qd_target = ratioDil * Qhc_15;
  const Qf_est = (1 - ratioDil) * Qhc_15;
  const delta_Qd = Qd_target - input.Qd_actual;

  if (!isFiniteNumber(Qd_target) || !isFiniteNumber(Qf_est) || !isFiniteNumber(delta_Qd)) {
    return {
      ok: false,
      message: 'El calculo produjo valores invalidos (NaN/Infinity).',
    };
  }

  return {
    ok: true,
    result: {
      Qt: input.Qt,
      WC: input.WC,
      Qgross_15,
      Qhc_15,
      Qd_target,
      delta_Qd,
      Qf_est,
      ratioDil,
    },
  };
}
