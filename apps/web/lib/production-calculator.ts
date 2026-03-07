export type ProductionCalculatorInput = {
  fromIso: string;
  toIso: string;
  ivoLiqFrom: number;
  ivoLiqTo: number;
  diluentBarrels: number;
  waterPercent: number;
};

export type ProductionCalculatorResult = {
  hours: number;
  ivoDelta: number;
  hourlyRate: number;
  projected24h: number;
  grossBarrels: number;
  waterBarrels: number;
  netBarrels: number;
};

export type ProductionCalculationOutcome =
  | {
      ok: true;
      result: ProductionCalculatorResult;
    }
  | {
      ok: false;
      message: string;
    };

export function calculateProductionByIvo(
  input: ProductionCalculatorInput,
): ProductionCalculationOutcome {
  const from = new Date(input.fromIso);
  const to = new Date(input.toIso);

  const fromTime = from.getTime();
  const toTime = to.getTime();

  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) {
    return {
      ok: false,
      message: 'Las fechas de inicio y fin deben ser validas.',
    };
  }

  const hours = (toTime - fromTime) / (1000 * 60 * 60);
  if (hours <= 0) {
    return {
      ok: false,
      message: 'El rango de tiempo debe ser mayor a 0 horas.',
    };
  }

  if (input.waterPercent < 0 || input.waterPercent > 100) {
    return {
      ok: false,
      message: 'El porcentaje de agua debe estar entre 0 y 100.',
    };
  }

  const ivoDelta = input.ivoLiqTo - input.ivoLiqFrom;
  const hourlyRate = ivoDelta / hours;
  const projected24h = hourlyRate * 24;
  const grossBarrels = projected24h - input.diluentBarrels;

  if (grossBarrels < 0) {
    return {
      ok: false,
      message: 'El volumen de diluente no puede ser mayor al volumen total proyectado.',
    };
  }

  const waterBarrels = grossBarrels * (input.waterPercent / 100);
  const netBarrels = grossBarrels - waterBarrels;

  return {
    ok: true,
    result: {
      hours,
      ivoDelta,
      hourlyRate,
      projected24h,
      grossBarrels,
      waterBarrels,
      netBarrels,
    },
  };
}
