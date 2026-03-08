import type { NextRequest } from 'next/server';

type ParsedSuccess<T> = { ok: true; data: T };
type ParsedFailure = { ok: false; message: string };

type RangeParams = {
  from: string;
  to: string;
  limit?: number;
};

function isValidDateTime(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

function normalizeSearchValue(value: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRangeBounds(fromParam: string, toParam: string): ParsedSuccess<RangeParams> | ParsedFailure {
  const fromMs = new Date(fromParam).getTime();
  const toMs = new Date(toParam).getTime();

  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { ok: false, message: 'Parametros invalidos: from/to deben ser fechas validas.' };
  }

  const cappedToMs = Math.min(toMs, Date.now());
  if (cappedToMs <= fromMs) {
    return {
      ok: false,
      message: 'Parametros invalidos: from debe ser menor que to y no puede quedar en el futuro.',
    };
  }

  return {
    ok: true,
    data: {
      from: new Date(fromMs).toISOString(),
      to: new Date(cappedToMs).toISOString(),
    },
  };
}

export function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function parseRangeQuery(request: NextRequest): ParsedSuccess<RangeParams> | ParsedFailure {
  const fromParam = normalizeSearchValue(request.nextUrl.searchParams.get('from'));
  const toParam = normalizeSearchValue(request.nextUrl.searchParams.get('to'));
  const limitParam = normalizeSearchValue(request.nextUrl.searchParams.get('limit'));

  let limit: number | undefined;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1000) {
      return { ok: false, message: 'Parametros invalidos: limit debe ser entero entre 1 y 1000.' };
    }
    limit = parsed;
  }

  if (fromParam && toParam) {
    if (!isValidDateTime(fromParam) || !isValidDateTime(toParam)) {
      return { ok: false, message: 'Parametros invalidos: from/to deben ser fechas validas.' };
    }

    const normalizedRange = normalizeRangeBounds(fromParam, toParam);
    if (!normalizedRange.ok) {
      return normalizedRange;
    }

    return {
      ok: true,
      data: {
        from: normalizedRange.data.from,
        to: normalizedRange.data.to,
        limit,
      },
    };
  }

  const range = defaultRange();
  return {
    ok: true,
    data: {
      ...range,
      limit,
    },
  };
}

export function parsePositiveIntParam(
  request: NextRequest,
  key: string,
  min: number,
  max: number,
): ParsedSuccess<number | undefined> | ParsedFailure {
  const raw = normalizeSearchValue(request.nextUrl.searchParams.get(key));
  if (!raw) {
    return { ok: true, data: undefined };
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { ok: false, message: `Parametro invalido: ${key} debe ser entero entre ${min} y ${max}.` };
  }

  return { ok: true, data: parsed };
}

export function parseNumberParam(
  request: NextRequest,
  key: string,
  min: number,
  max: number,
): ParsedSuccess<number | undefined> | ParsedFailure {
  const raw = normalizeSearchValue(request.nextUrl.searchParams.get(key));
  if (!raw) {
    return { ok: true, data: undefined };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return { ok: false, message: `Parametro invalido: ${key} debe estar entre ${min} y ${max}.` };
  }

  return { ok: true, data: parsed };
}

export function parseEnumParam<T extends string>(
  request: NextRequest,
  key: string,
  options: readonly T[],
): ParsedSuccess<T | undefined> | ParsedFailure {
  const raw = normalizeSearchValue(request.nextUrl.searchParams.get(key));
  if (!raw) {
    return { ok: true, data: undefined };
  }

  if (!options.includes(raw as T)) {
    return {
      ok: false,
      message: `Parametro invalido: ${key} debe ser uno de ${options.join(', ')}.`,
    };
  }

  return { ok: true, data: raw as T };
}
