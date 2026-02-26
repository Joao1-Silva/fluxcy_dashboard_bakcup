import { Router } from 'express';
import { z } from 'zod';

import {
  ASSISTANT_FOCUS_VALUES,
  buildAssistantAnalysis,
  buildAxisScale,
  type AssistantAnalyzeInput,
  type AssistantSourceMeta,
} from '../lib/assistant.js';
import { fetchExternal } from '../lib/externalApi.js';
import { toRows } from '../lib/normalizers.js';

const focusEnum = z.enum(ASSISTANT_FOCUS_VALUES);

const analyzeBodySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  timezone: z.string().min(1),
  pozo: z.string().trim().min(1).optional(),
  focus: z.array(focusEnum).optional(),
});

const analyzeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  timezone: z.string().min(1).default('America/New_York'),
  pozo: z.string().trim().min(1).optional(),
  focus: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return undefined;
      }
      return value
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is (typeof ASSISTANT_FOCUS_VALUES)[number] =>
          ASSISTANT_FOCUS_VALUES.includes(item as (typeof ASSISTANT_FOCUS_VALUES)[number]),
        );
    }),
});

const axisQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  timezone: z.string().min(1).optional(),
  mode: z.enum(['auto', 'pow2', 'nice125']).optional(),
  pozo: z.string().trim().min(1).optional(),
});

const router = Router();

type FetchResult = {
  payload: unknown;
  meta: AssistantSourceMeta;
};

type AnalyzeRunError = {
  status: number;
  payload: {
    message: string;
    sources: AssistantSourceMeta[];
  };
};

type AnalyzeRunResult =
  | {
      analysis: ReturnType<typeof buildAssistantAnalysis>;
    }
  | {
      error: AnalyzeRunError;
    };

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected source error';
}

async function fetchWithFallback(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  fallbackWithoutRange = true,
): Promise<FetchResult> {
  const start = Date.now();
  try {
    const payload = await fetchExternal(endpoint, params);
    return {
      payload,
      meta: {
        endpoint,
        ok: true,
        fallback: false,
        latencyMs: Date.now() - start,
        rowCount: toRows(payload).length,
      },
    };
  } catch (firstError) {
    if (!fallbackWithoutRange) {
      return {
        payload: [],
        meta: {
          endpoint,
          ok: false,
          fallback: false,
          latencyMs: Date.now() - start,
          rowCount: 0,
          error: toErrorMessage(firstError),
        },
      };
    }

    const fallbackParams: Record<string, string | number | undefined> = { ...params };
    delete fallbackParams.from;
    delete fallbackParams.to;

    try {
      const payload = await fetchExternal(endpoint, fallbackParams);
      return {
        payload,
        meta: {
          endpoint,
          ok: true,
          fallback: true,
          latencyMs: Date.now() - start,
          rowCount: toRows(payload).length,
        },
      };
    } catch (secondError) {
      return {
        payload: [],
        meta: {
          endpoint,
          ok: false,
          fallback: true,
          latencyMs: Date.now() - start,
          rowCount: 0,
          error: `${toErrorMessage(firstError)} | fallback: ${toErrorMessage(secondError)}`,
        },
      };
    }
  }
}

function validateRange(input: { from: string; to: string }) {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return false;
  }
  return true;
}

async function runAnalyze(input: AssistantAnalyzeInput): Promise<AnalyzeRunResult> {
  const rangeParams = {
    from: input.from,
    to: input.to,
    pozo: input.pozo,
  };

  const [qm, produccion, databasefluxcy, clockmeter, clockmeterQm] = await Promise.all([
    fetchWithFallback('/qm', rangeParams, true),
    fetchWithFallback('/produccion', rangeParams, true),
    fetchWithFallback('/databasefluxcy', rangeParams, true),
    fetchWithFallback('/clockmeter', { pozo: input.pozo }, false),
    fetchWithFallback('/clockmeter_qm', { pozo: input.pozo }, false),
  ]);

  const mandatoryOk = [qm.meta.ok, produccion.meta.ok, databasefluxcy.meta.ok].some(Boolean);
  if (!mandatoryOk) {
    return {
      error: {
        status: 502,
        payload: {
          message: 'Unable to fetch mandatory sources (/qm, /produccion, /databasefluxcy)',
          sources: [qm.meta, produccion.meta, databasefluxcy.meta],
        },
      },
    };
  }

  const analysis = buildAssistantAnalysis({
    input,
    payloads: {
      qm: qm.payload,
      produccion: produccion.payload,
      databasefluxcy: databasefluxcy.payload,
      clockmeter: clockmeter.payload,
      clockmeterQm: clockmeterQm.payload,
    },
    sources: [qm.meta, produccion.meta, databasefluxcy.meta, clockmeter.meta, clockmeterQm.meta],
  });

  return { analysis };
}

router.post('/analyze', async (req, res, next) => {
  try {
    const parsed = analyzeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid body', errors: parsed.error.flatten() });
    }

    if (!validateRange(parsed.data)) {
      return res.status(400).json({ message: '`from` must be earlier than `to`' });
    }

    const executed = await runAnalyze(parsed.data);
    if ('error' in executed) {
      const runError = executed.error;
      return res.status(runError.status).json(runError.payload);
    }

    return res.json(executed.analysis);
  } catch (error) {
    next(error);
  }
});

router.get('/analyze', async (req, res, next) => {
  try {
    const parsed = analyzeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid query', errors: parsed.error.flatten() });
    }

    const input: AssistantAnalyzeInput = {
      from: parsed.data.from,
      to: parsed.data.to,
      timezone: parsed.data.timezone,
      pozo: parsed.data.pozo,
      focus: parsed.data.focus,
    };

    if (!validateRange(input)) {
      return res.status(400).json({ message: '`from` must be earlier than `to`' });
    }

    const executed = await runAnalyze(input);
    if ('error' in executed) {
      const runError = executed.error;
      return res.status(runError.status).json(runError.payload);
    }

    return res.json(executed.analysis);
  } catch (error) {
    next(error);
  }
});

router.get('/axis', async (req, res, next) => {
  try {
    const parsed = axisQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid query', errors: parsed.error.flatten() });
    }

    if (!validateRange(parsed.data)) {
      return res.status(400).json({ message: '`from` must be earlier than `to`' });
    }

    const [qm, databasefluxcy] = await Promise.all([
      fetchWithFallback(
        '/qm',
        {
          from: parsed.data.from,
          to: parsed.data.to,
          pozo: parsed.data.pozo,
        },
        true,
      ),
      fetchWithFallback(
        '/databasefluxcy',
        {
          from: parsed.data.from,
          to: parsed.data.to,
          pozo: parsed.data.pozo,
        },
        true,
      ),
    ]);

    if (!qm.meta.ok && !databasefluxcy.meta.ok) {
      return res.status(502).json({
        message: 'Unable to calculate axis: both /qm and /databasefluxcy failed',
        sources: [qm.meta, databasefluxcy.meta],
      });
    }

    const axis = buildAxisScale(
      {
        from: parsed.data.from,
        to: parsed.data.to,
        timezone: parsed.data.timezone,
        mode: parsed.data.mode,
      },
      {
        qm: qm.payload,
        databasefluxcy: databasefluxcy.payload,
      },
    );

    return res.json({
      ...axis,
      sources: [qm.meta, databasefluxcy.meta],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export { router as assistantRouter };
