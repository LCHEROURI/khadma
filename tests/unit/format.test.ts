import { describe, expect, it } from 'vitest';
import { errKey, formatNeighborhood, formatPay } from '../../src/lib/format';
import { STRINGS, tpl } from '../../src/lib/strings';

describe('formatPay', () => {
  it('formats single value and ranges', () => {
    expect(formatPay(2000, 2000)).toContain('2');
    expect(formatPay(2000, 2000)).toContain('DZD');
    expect(formatPay(2000, 3500)).toContain('–');
  });
});

describe('formatNeighborhood', () => {
  it('maps canonical Oran neighborhood names to localized strings', () => {
    const arT = (k: string) => STRINGS.ar[k] ?? k;
    expect(formatNeighborhood('Bir El Djir', arT)).toBe('بئر الجير');
    expect(formatNeighborhood('Es Sénia', arT)).toBe('السانية');
    expect(formatNeighborhood('Unknown Place', arT)).toBe('Unknown Place');
  });
});

describe('errKey & tpl', () => {
  it('maps known Firebase Auth error codes', () => {
    expect(errKey('auth/invalid-phone-number')).toBe('post.phoneInvalid');
    expect(errKey('auth/code-expired')).toBe('post.codeExpired');
    expect(errKey('auth/unknown')).toBe('common.error');
  });

  it('interpolates template variables safely', () => {
    expect(tpl('{n} men 5', { n: 2 })).toBe('2 men 5');
  });
});
