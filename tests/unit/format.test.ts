import { describe, expect, it } from 'vitest';
import { errKey, formatListingCount, formatNeighborhood, formatPay } from '../../src/lib/format';
import { STRINGS, tpl } from '../../src/lib/strings';

describe('formatPay', () => {
  it('formats single value and ranges with localized currency', () => {
    expect(formatPay(2000, 2000)).toContain('2');
    expect(formatPay(2000, 2000)).toContain('DZD');
    expect(formatPay(2000, 3500)).toContain('–');
    expect(formatPay(2500, 2500, 'دج')).toContain('دج');
    expect(formatPay(2500, 3500, 'دج')).toContain('دج');
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

describe('formatListingCount', () => {
  const makeT = (lang: 'fr' | 'ar') => (k: string, vars?: Record<string, string | number>) =>
    tpl(STRINGS[lang][k] ?? k, vars);

  it('pluralizes French listing counts accurately (0, 1, 2, 10)', () => {
    const frT = makeT('fr');
    expect(formatListingCount(0, 'fr', frT)).toBe('0 annonce');
    expect(formatListingCount(1, 'fr', frT)).toBe('1 annonce');
    expect(formatListingCount(2, 'fr', frT)).toBe('2 annonces');
    expect(formatListingCount(10, 'fr', frT)).toBe('10 annonces');
  });

  it('pluralizes Arabic listing counts accurately across plural categories', () => {
    const arT = makeT('ar');
    expect(formatListingCount(0, 'ar', arT)).toBe('0 إعلان');
    expect(formatListingCount(1, 'ar', arT)).toBe('إعلان واحد');
    expect(formatListingCount(2, 'ar', arT)).toBe('إعلانان');
    expect(formatListingCount(3, 'ar', arT)).toBe('3 إعلانات');
    expect(formatListingCount(11, 'ar', arT)).toBe('11 إعلاناً');
    expect(formatListingCount(100, 'ar', arT)).toBe('100 إعلان');
  });
});
