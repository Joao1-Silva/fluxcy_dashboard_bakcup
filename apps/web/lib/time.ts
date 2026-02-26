import { format, subDays, subHours, subMinutes } from 'date-fns';

import type { TimeRange } from '@/types/dashboard';

export const REFRESH_OPTIONS = [
  { label: '5s', value: 5_000 },
  { label: '30s', value: 30_000 },
  { label: '5m', value: 300_000 },
  { label: '15m', value: 900_000 },
  { label: '30m', value: 1_800_000 },
  { label: '1h', value: 3_600_000 },
  { label: '2h', value: 7_200_000 },
  { label: '1d', value: 86_400_000 },
] as const;

export const RANGE_PRESETS = [
  { key: '15m', label: 'Last 15m', getRange: () => buildRange(subMinutes(new Date(), 15), new Date()) },
  { key: '1h', label: 'Last 1h', getRange: () => buildRange(subHours(new Date(), 1), new Date()) },
  { key: '6h', label: 'Last 6h', getRange: () => buildRange(subHours(new Date(), 6), new Date()) },
  { key: '12h', label: 'Last 12h', getRange: () => buildRange(subHours(new Date(), 12), new Date()) },
  { key: '24h', label: 'Last 24h', getRange: () => buildRange(subHours(new Date(), 24), new Date()) },
  { key: '7d', label: 'Last 7d', getRange: () => buildRange(subDays(new Date(), 7), new Date()) },
  { key: '30d', label: 'Last 30d', getRange: () => buildRange(subDays(new Date(), 30), new Date()) },
] as const;

export function buildRange(fromDate: Date, toDate: Date): TimeRange {
  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

export function toDateTimeLocalInput(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

export function fromDateTimeLocalInput(localValue: string): string {
  const date = new Date(localValue);
  return date.toISOString();
}

const EXTERNAL_API_RANGE_SHIFT_MS = 60 * 60 * 1000;

export function shiftIsoForExternalApi(iso: string): string {
  const epoch = new Date(iso).getTime();
  if (Number.isNaN(epoch)) {
    return iso;
  }

  return new Date(epoch + EXTERNAL_API_RANGE_SHIFT_MS).toISOString();
}

export function formatTimeLabel(value: string): string {
  return format(new Date(value), 'MM/dd HH:mm');
}

export function formatNumeric(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '--';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}


