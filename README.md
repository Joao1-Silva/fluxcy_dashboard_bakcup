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
