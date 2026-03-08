import { Router } from 'express';
import { z } from 'zod';

import { fetchExternal } from '../lib/externalApi.js';
import { normalizeSeries, normalizeSnapshot, normalizeTable } from '../lib/normalizers.js';

const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

const flowQuerySchema = rangeSchema.extend({
  smooth: z.enum(['0', '1']).optional(),
  alpha: z.coerce.number().min(0).max(1).optional(),
});

const produccionSchema = rangeSchema.extend({
  stepMin: z.coerce.number().int().positive().max(60).optional(),
});

const router = Router();
const EXTERNAL_SERIES_TIME_SHIFT_MS = 60 * 60 * 1000;

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function normalizeRange(
  raw: {
    from?: string;
    to?: string;
  },
  options?: {
    shiftMs?: number;
    capToNow?: boolean;
  },
) {
  const fallback = defaultRange();
  const fromIso = raw.from ?? fallback.from;
  const toIso = raw.to ?? fallback.to;

  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { ok: false as const, message: 'Parametros invalidos: from/to deben ser fechas validas.' };
  }

  const capToNow = options?.capToNow ?? true;
  const boundedToMs = capToNow ? Math.min(toMs, Date.now()) : toMs;

  if (boundedToMs <= fromMs) {
    return {
      ok: false as const,
      message: capToNow
        ? 'Parametros invalidos: from debe ser menor que to y no puede quedar en el futuro.'
        : 'Parametros invalidos: from debe ser menor que to.',
    };
  }

  const shiftMs = options?.shiftMs ?? 0;
  return {
    ok: true as const,
    data: {
      from: new Date(fromMs + shiftMs).toISOString(),
      to: new Date(boundedToMs + shiftMs).toISOString(),
    },
  };
}

async function fetchWithRangeFallback(endpoint: string, params: Record<string, string | number | undefined>) {
  try {
    return await fetchExternal(endpoint, params);
  } catch {
    return fetchExternal(endpoint);
  }
}

function shiftIsoTimestamp(iso: string, shiftMs: number) {
  const epoch = new Date(iso).getTime();
  if (Number.isNaN(epoch)) {
    return iso;
  }

  return new Date(epoch + shiftMs).toISOString();
}

function shiftSeriesTimestamps(payload: { series: Array<{ t: string } & Record<string, number | string | null>> }) {
  return {
    series: payload.series.map((point) => ({
      ...point,
      t: shiftIsoTimestamp(point.t, EXTERNAL_SERIES_TIME_SHIFT_MS),
    })),
  };
}

router.get('/snapshot', async (_req, res, next) => {
  try {
    const [clockmeter, drivgain, temp, possvalve, rholiq, total, densidadapi] = await Promise.all([
      fetchExternal('/clockmeter'),
      fetchExternal('/drivgain'),
      fetchExternal('/temp'),
      fetchExternal('/possvalve'),
      fetchExternal('/rholiq'),
      fetchExternal('/total'),
      fetchExternal('/densidadapi'),
    ]);

    res.json(
      normalizeSnapshot({
        clockmeter,
        drivgain,
        temp,
        possvalve,
        rholiq,
        total,
        densidadapi,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get('/series/flow', async (req, res, next) => {
  try {
    const parsed = flowQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data, { capToNow: false });
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const range = normalizedRange.data;
    const payload = await fetchExternal('/qm', {
      from: range.from,
      to: range.to,
      smooth: parsed.data.smooth ?? '1',
      alpha: parsed.data.alpha,
    });

    const normalized = normalizeSeries(payload, ['qm_liq', 'qm_gas']);
    res.json(shiftSeriesTimestamps(normalized));
  } catch (error) {
    next(error);
  }
});

router.get('/series/vp', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data, { capToNow: false });
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const range = normalizedRange.data;
    const payload = await fetchExternal('/vp', { from: range.from, to: range.to });

    const normalized = normalizeSeries(payload, ['temp_liq', 'temperatura_gas_f', 'psi_gas', 'psi_liq']);
    res.json(shiftSeriesTimestamps(normalized));
  } catch (error) {
    next(error);
  }
});

router.get('/series/rho', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data, { capToNow: false });
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const range = normalizedRange.data;
    const payload = await fetchExternal('/rho', { from: range.from, to: range.to });

    const normalized = normalizeSeries(payload, ['rho_liq', 'rho_gas']);
    res.json(shiftSeriesTimestamps(normalized));
  } catch (error) {
    next(error);
  }
});

router.get('/series/ivo-liq', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parametros invalidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data);
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const range = normalizedRange.data;
    try {
      const produccionPayload = await fetchExternal('/produccion', {
        from: range.from,
        to: range.to,
        stepMin: 1,
      });

      const produccionSeries = normalizeSeries(produccionPayload, ['liq_acum', 'vliq', 'totalliq']);
      if (produccionSeries.series.length > 0) {
        return res.json(produccionSeries);
      }
    } catch {
      // Fallback handled below with /total
    }

    const totalPayload = await fetchWithRangeFallback('/total', {
      from: range.from,
      to: range.to,
    });

    res.json(normalizeSeries(totalPayload, ['liq_acum', 'vliq', 'totalliq']));
  } catch (error) {
    next(error);
  }
});

router.get('/series/produccion', async (req, res, next) => {
  try {
    const parsed = produccionSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data);
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const range = normalizedRange.data;
    const payload = await fetchExternal('/produccion', {
      from: range.from,
      to: range.to,
      stepMin: parsed.data.stepMin ?? 1,
    });

    res.json(normalizeSeries(payload, ['liq_acum', 'gas_acum']));
  } catch (error) {
    next(error);
  }
});

router.get('/table/pressures', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data);
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const payload = await fetchWithRangeFallback('/pressures', normalizedRange.data);

    const normalizedTable = normalizeTable(payload, [
      'presion_cabezal',
      'presion_casing',
      'presion_linea',
      'presion_macolla',
    ]);

    const limit = parsed.data.limit ?? 100;
    res.json({ table: normalizedTable.table.slice(0, limit) });
  } catch (error) {
    next(error);
  }
});

router.get('/table/bsw-lab', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data);
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const payload = await fetchWithRangeFallback('/bsw_lab_changes', normalizedRange.data);

    const normalizedTable = normalizeTable(payload, ['bsw_lab']);
    res.json({ table: normalizedTable.table.slice(0, parsed.data.limit ?? 100) });
  } catch (error) {
    next(error);
  }
});

router.get('/table/densidad-lab', async (req, res, next) => {
  try {
    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.flatten() });
    }

    const normalizedRange = normalizeRange(parsed.data);
    if (!normalizedRange.ok) {
      return res.status(400).json({ message: normalizedRange.message });
    }

    const payload = await fetchWithRangeFallback('/densidad_lab_changes', normalizedRange.data);

    const normalizedTable = normalizeTable(payload, ['densidad_lab']);
    res.json({ table: normalizedTable.table.slice(0, parsed.data.limit ?? 100) });
  } catch (error) {
    next(error);
  }
});

export { router as apiRouter };


