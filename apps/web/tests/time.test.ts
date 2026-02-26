import { describe, expect, it } from 'vitest';

import { fromDateTimeLocalInput, shiftIsoForExternalApi, toDateTimeLocalInput } from '@/lib/time';

describe('time mapping', () => {
  it('converts local datetime to ISO and back', () => {
    const localValue = '2026-02-26T10:30';
    const iso = fromDateTimeLocalInput(localValue);

    expect(iso).toContain('2026-02-26T');
    expect(toDateTimeLocalInput(iso)).toBe(localValue);
  });

  it('shifts ISO forward one hour for external API range compensation', () => {
    const input = '2026-02-26T15:00:00.000Z';
    expect(shiftIsoForExternalApi(input)).toBe('2026-02-26T16:00:00.000Z');
  });
});
