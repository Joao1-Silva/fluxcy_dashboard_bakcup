export type DataMode = 'realtime' | 'api';

export type SocketStatus = 'connected' | 'disconnected' | 'error';

export type DashboardThemeMode = 'Default' | 'iOS26';

export type Snapshot = {
  t: string;
  psi_liq: number | null;
  psi_gas: number | null;
  drive_gain_gas: number | null;
  drive_gain_liquido: number | null;
  temp_liquido: number | null;
  temp_gas: number | null;
  posicion_valvula: number | null;
  densidad: number | null;
  totalgas: number | null;
  totalliq: number | null;
  api: number | null;
  vliq: number | null;
  vgas: number | null;
  delta_p: number | null;
};

export type SnapshotResponse = {
  snapshot: Snapshot;
};

export type SeriesPoint = {
  t: string;
  [key: string]: number | string | null;
};

export type SeriesResponse = {
  series: SeriesPoint[];
};

export type TableRow = {
  time: string;
  [key: string]: number | string | null;
};

export type TableResponse = {
  table: TableRow[];
};

export type TimeRange = {
  from: string;
  to: string;
};


