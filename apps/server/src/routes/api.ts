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

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

async function fetchWithRangeFallback(endpoint: string, params: Record<string, string | number | undefined>) {
  try {
    return await fetchExternal(endpoint, params);
  } catch {
    return fetchExternal(endpoint);
  }
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

    const range = parsed.data.from && parsed.data.to ? parsed.data : { ...parsed.data, ...defaultRange() };
    const payload = await fetchExternal('/qm', {
      from: range.from,
      to: range.to,
      smooth: range.smooth ?? '1',
      alpha: range.alpha,
    });

    res.json(normalizeSeries(payload, ['qm_liq', 'qm_gas']));
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

    const range = parsed.data.from && parsed.data.to ? parsed.data : { ...parsed.data, ...defaultRange() };
    const payload = await fetchExternal('/vp', { from: range.from, to: range.to });

    res.json(normalizeSeries(payload, ['temp_liq', 'temperatura_gas_f', 'psi_gas', 'psi_liq']));
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

    const range = parsed.data.from && parsed.data.to ? parsed.data : { ...parsed.data, ...defaultRange() };
    const payload = await fetchExternal('/rho', { from: range.from, to: range.to });

    res.json(normalizeSeries(payload, ['rho_liq', 'rho_gas']));
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

    const range = parsed.data.from && parsed.data.to ? parsed.data : { ...parsed.data, ...defaultRange() };
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

    const range = parsed.data.from && parsed.data.to ? parsed.data : { ...parsed.data, ...defaultRange() };
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

    const payload = await fetchWithRangeFallback('/pressures', {
      from: parsed.data.from,
      to: parsed.data.to,
    });

    const normalized = normalizeTable(payload, [
      'presion_cabezal',
      'presion_casing',
      'presion_linea',
      'presion_macolla',
    ]);

    const limit = parsed.data.limit ?? 100;
    res.json({ table: normalized.table.slice(0, limit) });
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

    const payload = await fetchWithRangeFallback('/bsw_lab_changes', {
      from: parsed.data.from,
      to: parsed.data.to,
    });

    const normalized = normalizeTable(payload, ['bsw_lab']);
    res.json({ table: normalized.table.slice(0, parsed.data.limit ?? 100) });
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

    const payload = await fetchWithRangeFallback('/densidad_lab_changes', {
      from: parsed.data.from,
      to: parsed.data.to,
    });

    const normalized = normalizeTable(payload, ['densidad_lab']);
    res.json({ table: normalized.table.slice(0, parsed.data.limit ?? 100) });
  } catch (error) {
    next(error);
  }
});

export { router as apiRouter };


