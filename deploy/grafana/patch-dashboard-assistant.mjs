#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    input: '',
    outPatched: '',
    outAssistant: '',
    infinityUid: '__INFINITY_DS_UID__',
    assistantBase: 'http://localhost:4000',
    timezone: 'America/New_York',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--in' && next) {
      args.input = next;
      index += 1;
      continue;
    }
    if (token === '--out-patched' && next) {
      args.outPatched = next;
      index += 1;
      continue;
    }
    if (token === '--out-assistant' && next) {
      args.outAssistant = next;
      index += 1;
      continue;
    }
    if (token === '--infinity-uid' && next) {
      args.infinityUid = next;
      index += 1;
      continue;
    }
    if (token === '--assistant-base' && next) {
      args.assistantBase = next;
      index += 1;
      continue;
    }
    if (token === '--timezone' && next) {
      args.timezone = next;
      index += 1;
      continue;
    }
  }

  if (!args.input) {
    throw new Error('Missing --in <dashboard.json>');
  }

  if (!args.outPatched) {
    const parsed = path.parse(args.input);
    args.outPatched = path.join(parsed.dir, `${parsed.name}.flow-axis${parsed.ext || '.json'}`);
  }

  if (!args.outAssistant) {
    const parsed = path.parse(args.input);
    args.outAssistant = path.join(parsed.dir, `${parsed.name}.assistant${parsed.ext || '.json'}`);
  }

  return args;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function visitPanels(panels, callback) {
  if (!Array.isArray(panels)) {
    return;
  }
  for (const panel of panels) {
    callback(panel);
    if (Array.isArray(panel.panels)) {
      visitPanels(panel.panels, callback);
    }
  }
}

function findPanelById(dashboard, id) {
  let found = null;
  visitPanels(dashboard.panels, (panel) => {
    if (panel.id === id) {
      found = panel;
    }
  });
  return found;
}

function maxPanelId(dashboard) {
  let maxId = 0;
  visitPanels(dashboard.panels, (panel) => {
    if (typeof panel.id === 'number') {
      maxId = Math.max(maxId, panel.id);
    }
  });
  return maxId;
}

function dashboardBottomY(dashboard) {
  let maxY = 0;
  visitPanels(dashboard.panels, (panel) => {
    if (!panel.gridPos) {
      return;
    }
    const y = Number(panel.gridPos.y ?? 0);
    const h = Number(panel.gridPos.h ?? 0);
    maxY = Math.max(maxY, y + h);
  });
  return maxY;
}

function ensureFieldConfig(panel) {
  panel.fieldConfig = panel.fieldConfig ?? {};
  panel.fieldConfig.defaults = panel.fieldConfig.defaults ?? {};
  panel.fieldConfig.overrides = panel.fieldConfig.overrides ?? [];
  panel.fieldConfig.defaults.custom = panel.fieldConfig.defaults.custom ?? {};
}

function patchFlowAxis(panel) {
  ensureFieldConfig(panel);
  panel.fieldConfig.defaults.min = 0;
  if ('max' in panel.fieldConfig.defaults) {
    delete panel.fieldConfig.defaults.max;
  }
  panel.fieldConfig.defaults.custom.axisSoftMin = 0;
  panel.fieldConfig.defaults.custom.axisPlacement = panel.fieldConfig.defaults.custom.axisPlacement ?? 'auto';
  panel.fieldConfig.defaults.custom.scaleDistribution =
    panel.fieldConfig.defaults.custom.scaleDistribution ?? { type: 'linear' };
}

function asWrapper(inputJson) {
  if (inputJson && typeof inputJson === 'object' && inputJson.dashboard && inputJson.meta) {
    return {
      kind: 'api',
      dashboard: inputJson.dashboard,
      meta: inputJson.meta,
      root: inputJson,
    };
  }
  return {
    kind: 'dashboard',
    dashboard: inputJson,
    meta: null,
    root: inputJson,
  };
}

function wrapOutput(kind, dashboard, meta) {
  if (kind === 'api') {
    return {
      dashboard,
      meta: meta ?? {},
    };
  }
  return dashboard;
}

function makeInfinityDatasource(uid) {
  return {
    type: 'yesoreyeram-infinity-datasource',
    uid,
  };
}

function buildAssistantPanels(params) {
  const fromMacro = '${__from:date:iso}';
  const toMacro = '${__to:date:iso}';
  const baseUrl = params.assistantBase.replace(/\/$/, '');
  const ds = makeInfinityDatasource(params.infinityUid);

  const analyzeUrl =
    `${baseUrl}/assistant/analyze` +
    `?from=${encodeURIComponent(fromMacro)}` +
    `&to=${encodeURIComponent(toMacro)}` +
    `&timezone=${encodeURIComponent(params.timezone)}`;

  const tablePanel = {
    id: params.basePanelId + 1,
    type: 'table',
    title: 'Assistant Findings (Recommendations)',
    datasource: ds,
    gridPos: { x: 0, y: params.baseY, w: 24, h: 10 },
    targets: [
      {
        refId: 'A',
        datasource: ds,
        source: 'url',
        type: 'json',
        format: 'table',
        parser: 'backend',
        url: analyzeUrl,
        uql:
          'parse-json | scope "recommendations" | project id, title, checklist=tostring(checklist), evidence=tostring(evidence)',
      },
    ],
    options: {
      showHeader: true,
      footer: { show: false, reducer: [], countRows: false },
      sortBy: [{ displayName: 'id', desc: false }],
    },
    fieldConfig: {
      defaults: {
        custom: {},
      },
      overrides: [],
    },
  };

  const timelinePanel = {
    id: params.basePanelId + 2,
    type: 'state-timeline',
    title: 'Assistant Timeline (Regimes & Anomalies)',
    datasource: ds,
    gridPos: { x: 0, y: params.baseY + 10, w: 24, h: 8 },
    targets: [
      {
        refId: 'A',
        datasource: ds,
        source: 'url',
        type: 'json',
        format: 'table',
        parser: 'backend',
        url: analyzeUrl,
        uql:
          'parse-json | scope "events" | project start=todatetime(start), end=todatetime(end), segment=id, state=iif(array_length(variablesChanged)>0,"Cambio de regimen","Estable"), score=todouble(score)',
      },
      {
        refId: 'B',
        datasource: ds,
        source: 'url',
        type: 'json',
        format: 'table',
        parser: 'backend',
        hide: true,
        url: analyzeUrl,
        uql:
          'parse-json | scope "anomalies" | project start=todatetime(start), end=todatetime(end), segment=id, state="Anomalia", score=todouble(score)',
      },
    ],
    options: {
      mergeValues: true,
      showValue: 'never',
      rowHeight: 0.9,
      legend: {
        displayMode: 'list',
        placement: 'bottom',
      },
      tooltip: {
        mode: 'single',
      },
    },
    fieldConfig: {
      defaults: {
        custom: {
          lineWidth: 1,
          fillOpacity: 90,
        },
      },
      overrides: [],
    },
  };

  return [tablePanel, timelinePanel];
}

function ensureAssistantTitle(dashboard) {
  const original = String(dashboard.title ?? 'FLUXCY');
  if (original.includes('Assistant')) {
    return original;
  }
  return `${original} Assistant`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = fs.readFileSync(args.input, 'utf8').replace(/^\uFEFF/, '');
  const json = JSON.parse(raw);
  const wrapped = asWrapper(json);

  const patchedDashboard = deepClone(wrapped.dashboard);
  const flowPanel = findPanelById(patchedDashboard, 1);
  if (!flowPanel) {
    throw new Error('Panel id=1 was not found in the input dashboard');
  }

  patchFlowAxis(flowPanel);

  const assistantDashboard = deepClone(patchedDashboard);
  assistantDashboard.title = 'FLUXCY Assistant';
  assistantDashboard.uid = undefined;
  assistantDashboard.id = null;
  assistantDashboard.version = 1;
  assistantDashboard.tags = Array.from(new Set([...(assistantDashboard.tags ?? []), 'assistant', 'fluxcy']));
  assistantDashboard.description =
    'Additive dashboard that keeps original panels and appends assistant findings (stateless local service).';

  const basePanelId = maxPanelId(assistantDashboard);
  const baseY = dashboardBottomY(assistantDashboard);
  const panelsToAppend = buildAssistantPanels({
    basePanelId,
    baseY,
    assistantBase: args.assistantBase,
    infinityUid: args.infinityUid,
    timezone: args.timezone,
  });

  assistantDashboard.panels = [...(assistantDashboard.panels ?? []), ...panelsToAppend];

  const patchedOutput = wrapOutput(wrapped.kind, patchedDashboard, wrapped.meta);
  const assistantOutput = wrapOutput(wrapped.kind, assistantDashboard, wrapped.meta);

  fs.writeFileSync(args.outPatched, `${JSON.stringify(patchedOutput, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.outAssistant, `${JSON.stringify(assistantOutput, null, 2)}\n`, 'utf8');

  const report = {
    input: path.resolve(args.input),
    patched: path.resolve(args.outPatched),
    assistant: path.resolve(args.outAssistant),
    notes: [
      'Flow panel id=1 patched: min=0, max removed, soft axis enabled.',
      'Assistant dashboard cloned additively with two new panels at the end.',
      'Targets and query logic of existing panels were preserved.',
    ],
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
