'use client';

import { AlertTriangle, CheckCircle2, Siren } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type HealthStatus = 'OK' | 'WARN' | 'CRITICAL';

export type HealthCheck = {
  check: string;
  status: HealthStatus;
  detail: string;
};

type HealthDiagnosticsPanelProps = {
  overall: HealthStatus;
  checks: HealthCheck[];
};

function statusIcon(status: HealthStatus) {
  if (status === 'CRITICAL') {
    return <Siren className="h-4 w-4 text-rose-300" />;
  }
  if (status === 'WARN') {
    return <AlertTriangle className="h-4 w-4 text-amber-300" />;
  }
  return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
}

function statusVariant(status: HealthStatus): 'success' | 'warning' | 'danger' {
  if (status === 'CRITICAL') {
    return 'danger';
  }
  if (status === 'WARN') {
    return 'warning';
  }
  return 'success';
}

export function HealthDiagnosticsPanel({ overall, checks }: HealthDiagnosticsPanelProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-2">
          {statusIcon(overall)}
          <CardTitle>Diagnostico rapido</CardTitle>
        </div>
        <Badge variant={statusVariant(overall)} className="px-3 py-1">
          Estado general: {overall}
        </Badge>
      </CardHeader>

      <CardContent>
        <div className="max-h-[320px] overflow-auto rounded-xl border border-slate-700/60">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900/95 text-xs uppercase tracking-wide text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left">Check</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((row) => (
                <tr key={row.check} className="border-t border-slate-800/80 text-slate-200">
                  <td className="px-3 py-2 font-medium">{row.check}</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(row.status)} className="px-2.5 py-0.5">
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
