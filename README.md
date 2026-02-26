# FLUXCY DEV V1 - Dashboard Web

Dashboard responsive con Next.js + Express BFF, login por roles y calculadora de produccion por IVO.

## Stack

- Frontend: Next.js App Router + React + TypeScript
- UI: TailwindCSS + componentes base estilo shadcn/ui + lucide-react
- Charts: Recharts + KPIs/Gauges custom
- Data layer: TanStack Query + Zustand
- Backend: Route Handlers de Next.js (modo integrado) + opcion Express BFF en `apps/server`
- Realtime: Socket.IO server/client

## Instalacion

```bash
npm install
```

## Ejecucion local

Modo integrado (sin backend separado):

```bash
npm run dev -w @fluxcy/web
```

- Web + API interna: `http://localhost:3001`

Modo monorepo (web + Express BFF en paralelo):

```bash
npm run dev
```

- Web: `http://localhost:3001`
- BFF: `http://localhost:4000`

## Build y produccion

```bash
npm run build
npm run start
```

## Deploy en Vercel (por Git)

El proyecto puede desplegarse en **un solo proyecto de Vercel** (solo `apps/web`) sin backend separado.

1. Importa el repo en Vercel.
2. En el proyecto de Vercel, usa **Root Directory**: `apps/web`.
3. Deploy directo: no necesitas `BFF_URL` para el modo integrado.

Opcionales:

- `EXTERNAL_API_BASE_URL=http://api-sermaca.lat/api_aguilera/api` (si quieres sobrescribir la API externa de origen)
- `NEXT_PUBLIC_ENABLE_TASKS_BACKEND=false`
- `NEXT_PUBLIC_SOCKET_URL=https://tu-bff-publico.example.com` (solo si luego habilitas sockets desde un backend aparte)
- `BFF_URL=https://tu-bff-publico.example.com` (solo si quieres usar un BFF externo por rewrites)

Referencia de variables: [apps/web/.env.example](./apps/web/.env.example)

## Login y roles

Usuarios base en archivo [usuarios_base.txt](./usuarios_base.txt).

- `superadmin`: acceso completo (dashboard + tasks + calculadora IVO)
- `supervisor`: acceso dashboard + calculadora IVO

## Calculadora IVO

Modulo incluido en `/dashboard` para estimar produccion:

- Entradas: hora inicio, hora fin, diluente (Bls), agua (%)
- IVO Liq inicio/fin: se toma automaticamente desde la data del rango seleccionado
- Formula de proyeccion: `((ivo_fin - ivo_inicio) / horas) * 24`
- Neto: `proyeccion_24h - diluente - (proyeccion_24h * agua%)`

## Endpoints API

- `GET /api/snapshot`
- `GET /api/series/flow?from&to&smooth&alpha`
- `GET /api/series/vp?from&to`
- `GET /api/series/rho?from&to`
- `GET /api/series/ivo-liq?from&to`
- `GET /api/series/produccion?from&to&stepMin`
- `GET /api/table/pressures?from&to&limit`
- `GET /api/table/bsw-lab?from&to&limit`
- `GET /api/table/densidad-lab?from&to&limit`
- `GET /api/tasks` (deshabilitado por defecto en codigo)

## Asistente Virtual Local (Stateless, additive)

Se agrego un modulo local sin persistencia, en RAM por request:

- `POST /assistant/analyze`
- `GET /assistant/analyze` (helper para Grafana/Infinity)
- `GET /assistant/axis`

No usa DB, cache persistente ni colas.

### Correr local

```bash
npm run dev -w @fluxcy/server
```

Base local: `http://localhost:4000`

### Ejemplo `POST /assistant/analyze`

```bash
curl -X POST "http://localhost:4000/assistant/analyze" ^
  -H "Content-Type: application/json" ^
  -d "{\n    \"from\":\"2026-02-25T00:00:00Z\",\n    \"to\":\"2026-02-25T06:00:00Z\",\n    \"timezone\":\"America/New_York\",\n    \"focus\":[\"flow\",\"pressure\",\"power\"]\n  }"
```

Respuesta (shape):

```json
{
  "summary": "Rango ...",
  "confidence": 0.83,
  "events": [
    {
      "id": "event-1",
      "type": "regime_segment",
      "start": "2026-02-25T00:00:00.000Z",
      "end": "2026-02-25T01:20:00.000Z",
      "changePointAt": "2026-02-25T00:40:00.000Z",
      "variablesChanged": [{ "metric": "qm_liq", "delta": 12.1, "score": 3.8 }],
      "triggeredBy": [{ "algorithm": "rolling_window_median_shift", "rule": "regime_change_median_shift" }]
    }
  ],
  "anomalies": [
    {
      "id": "anomaly-1",
      "start": "2026-02-25T02:10:00.000Z",
      "end": "2026-02-25T02:14:00.000Z",
      "score": 3.4,
      "drivers": [{ "metric": "qm_liq", "maxAbsZ": 6.1 }]
    }
  ],
  "correlations": [
    {
      "id": "corr-1",
      "pair": "rpm~torque",
      "lagMinutes": 2,
      "strength": 0.78
    }
  ],
  "recommendations": [
    {
      "id": "rec-1",
      "title": "Verificar calidad de senal antes de decisiones operativas",
      "evidence": [{ "type": "data_quality", "id": "dq-qm_liq-gap-1" }]
    }
  ],
  "dataQuality": {
    "confidencePerSeries": [],
    "issues": []
  },
  "features": {
    "metrics": [],
    "ratios": []
  },
  "meta": {
    "interpolationApplied": false,
    "algorithms": [
      "expected_step_gap_detector",
      "rolling_mad_detector",
      "median_mad_outlier",
      "rolling_window_median_shift",
      "combined_robust_zscore",
      "pearson_lag_scan"
    ]
  }
}
```

### Ejemplo `GET /assistant/axis`

```bash
curl "http://localhost:4000/assistant/axis?from=2026-02-25T00:00:00Z&to=2026-02-25T06:00:00Z&timezone=America/New_York&mode=auto"
```

Respuesta:

```json
{
  "maxObserved": 93.4,
  "maxAxis": 128,
  "tickStep": 32,
  "algorithm": "pow2"
}
```

## Grafana JSON (copy/paste reproducible)

Script additive para parchear un dashboard existente y generar uno nuevo `FLUXCY Assistant`:

```bash
node deploy/grafana/patch-dashboard-assistant.mjs ^
  --in C:\\ruta\\tu-dashboard.json ^
  --out-patched C:\\ruta\\tu-dashboard.flow-axis.json ^
  --out-assistant C:\\ruta\\tu-dashboard.assistant.json ^
  --infinity-uid TU_INFINITY_UID ^
  --assistant-base http://localhost:4000 ^
  --timezone America/New_York
```

Snippet JSON directo (copy/paste): `deploy/grafana/assistant-json-snippets.json`

El script hace exactamente:

1. Panel `id=1` (Flow Rate):
- `fieldConfig.defaults.min = 0`
- elimina `fieldConfig.defaults.max` (auto max)
- `fieldConfig.defaults.custom.axisSoftMin = 0`
- no toca `targets` ni queries.

2. Crea dashboard nuevo `FLUXCY Assistant`:
- clona el dashboard base (sin borrar paneles existentes).
- agrega al final:
  - `Assistant Findings (Recommendations)` (tabla sobre `/assistant/analyze`)
  - `Assistant Timeline (Regimes & Anomalies)` (state timeline sobre `/assistant/analyze`)

## Tema iOS26 y modulo Health (additive)

Se agrego soporte de tema visual seleccionable por usuario y un segundo modulo de dashboard, sin alterar endpoints ni queries existentes.

- Dashboard principal (baseline): `/dashboard`
- Dashboard ejecutivo/health: `/dashboard/health`
- Selector de tema: en el header (`Default` / `iOS26`), persistido en `localStorage` via Zustand.

Archivos de tema:

- `apps/web/app/theme/default.css`
- `apps/web/app/theme/ios26.css`

Notas:

- El tema se aplica mediante clase en `<body>` (`theme-default` o `theme-ios26`).
- El modulo Health reutiliza las mismas fuentes de datos del hook `useDashboardData`.
- No se modificaron rutas API (`/api/snapshot`, `/api/series/*`, `/api/table/*`).
- Los paneles de series (`TimeSeriesPanel`) incluyen boton `Expandir` para pantalla completa.
  Puedes salir con el mismo boton o con la tecla `Esc`.
- Se ajusto responsive para movil vertical en header, KPIs, gauges y tablas.

### Embebido / A-B por viewport

Si necesitas comportamiento A/B por ancho de pantalla:

1. Desktop/tablet: usar `/dashboard`
2. Mobile: usar `/dashboard/health`

Puedes resolverlo en tu shell/app host con media query o deteccion del viewport y redireccion condicional.

## Calidad

```bash
npm run lint
npm run test
```

E2E smoke (opcional):

```bash
npm run test:e2e -w @fluxcy/web
```
