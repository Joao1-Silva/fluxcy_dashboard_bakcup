import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  ASSISTANT_FOCUS_VALUES,
  buildAssistantAnalysis,
  type AssistantAnalyzeInput,
  type AssistantSourceMeta,
} from '@/lib/bff/assistant';
import { fetchExternal } from '@/lib/bff/external-api';
import { toRows } from '@/lib/bff/normalizers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FOCUS_VALUES = new Set(ASSISTANT_FOCUS_VALUES);

type AnalyzeBody = {
  from: string;
  to: string;
  timezone: string;
  pozo?: string;
  focus?: (typeof ASSISTANT_FOCUS_VALUES)[number][];
};

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

function parseBody(body: unknown): AnalyzeBody | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const value = body as Record<string, unknown>;
  const from = typeof value.from === 'string' ? value.from : '';
  const to = typeof value.to === 'string' ? value.to : '';
  const timezone = typeof value.timezone === 'string' ? value.timezone : '';
  const pozo = typeof value.pozo === 'string' && value.pozo.trim().length > 0 ? value.pozo.trim() : undefined;

  if (!from || !to || !timezone) {
    return null;
  }

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return null;
  }

  const focusArray = Array.isArray(value.focus)
    ? value.focus.filter(
        (item): item is (typeof ASSISTANT_FOCUS_VALUES)[number] =>
          typeof item === 'string' && FOCUS_VALUES.has(item as (typeof ASSISTANT_FOCUS_VALUES)[number]),
      )
    : undefined;

  return {
    from,
    to,
    timezone,
    pozo,
    focus: focusArray && focusArray.length > 0 ? focusArray : undefined,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected source error';
}

async function fetchWithFallback(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  fallbackWithoutRange: boolean,
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

export async function POST(request: NextRequest) {
  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json(
      { message: 'Invalid body. Required: from, to, timezone (ISO range with from < to).' },
      { status: 400 },
    );
  }

  const executed = await runAnalyze(body);
  if ('error' in executed) {
    const runError = executed.error;
    return NextResponse.json(runError.payload, { status: runError.status });
  }

  return NextResponse.json(executed.analysis);
}

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get('from') ?? '';
  const to = request.nextUrl.searchParams.get('to') ?? '';
  const timezone = request.nextUrl.searchParams.get('timezone') ?? '';
  const pozo = request.nextUrl.searchParams.get('pozo') ?? undefined;
  const focusParam = request.nextUrl.searchParams.get('focus') ?? '';
  const focus = focusParam
    ? focusParam
        .split(',')
        .map((value) => value.trim())
        .filter(
          (value): value is (typeof ASSISTANT_FOCUS_VALUES)[number] =>
            FOCUS_VALUES.has(value as (typeof ASSISTANT_FOCUS_VALUES)[number]),
        )
    : undefined;

  const body = parseBody({ from, to, timezone, pozo, focus });
  if (!body) {
    return NextResponse.json(
      { message: 'Invalid query. Required: from, to, timezone (ISO range with from < to).' },
      { status: 400 },
    );
  }

  const executed = await runAnalyze(body);
  if ('error' in executed) {
    const runError = executed.error;
    return NextResponse.json(runError.payload, { status: runError.status });
  }

  return NextResponse.json(executed.analysis);
}
