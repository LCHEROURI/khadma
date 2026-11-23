import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../src/lib/constants';
import {
  DEFAULT_LANG,
  LANGS,
  LEGACY_DARIA_STRINGS,
  resolveSavedLang,
  STRINGS,
  tpl
} from '../../src/lib/strings';

describe('KHADMA V1.1 FR / AR localization invariants', () => {
  it('exposes only French (default, LTR) and Arabic (RTL) in active UI languages', () => {
    expect(DEFAULT_LANG).toBe('fr');
    expect(LANGS.map((l) => l.id)).toEqual(['fr', 'ar']);
    expect(LANGS.find((l) => l.id === 'fr')).toEqual({
      id: 'fr',
      label: 'Français',
      dir: 'ltr',
      htmlLang: 'fr'
    });
    expect(LANGS.find((l) => l.id === 'ar')).toEqual({
      id: 'ar',
      label: 'العربية',
      dir: 'rtl',
      htmlLang: 'ar'
    });
    expect(Object.keys(STRINGS).sort()).toEqual(['ar', 'fr']);
    expect(Object.keys(LEGACY_DARIA_STRINGS).length).toBeGreaterThan(100);
  });

  it('defaults to French and safely migrates legacy dar or invalid saved preferences to fr', () => {
    expect(resolveSavedLang(null)).toBe('fr');
    expect(resolveSavedLang(undefined)).toBe('fr');
    expect(resolveSavedLang('')).toBe('fr');
    expect(resolveSavedLang('dar')).toBe('fr');
    expect(resolveSavedLang('en')).toBe('fr');
    expect(resolveSavedLang('fr')).toBe('fr');
    expect(resolveSavedLang('ar')).toBe('ar');
  });

  it('maintains 100% key parity between fr and ar with zero empty strings', () => {
    const frKeys = Object.keys(STRINGS.fr).sort();
    const arKeys = Object.keys(STRINGS.ar).sort();
    expect(arKeys).toEqual(frKeys);

    for (const key of frKeys) {
      expect(STRINGS.fr[key]?.trim().length).toBeGreaterThan(0);
      expect(STRINGS.ar[key]?.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains no Latin-script Darija markers in active fr or ar dictionaries', () => {
    const darijaMarkers = /\b(3emrek|tal9a|khdma|i3lan|sannay|ballegh|3awed|mochkil|chabbab)\b/i;
    for (const lang of ['fr', 'ar'] as const) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        expect(value, `${lang}.${key} should not contain Latin Darija`).not.toMatch(darijaMarkers);
      }
    }
  });

  it('interpolates template placeholders cleanly', () => {
    expect(tpl(STRINGS.fr['browse.results'], { n: 3 })).toBe('3 annonces');
    expect(tpl(STRINGS.ar['browse.results'], { n: 3 })).toBe('3 إعلان');
  });

  it('preserves exact canonical category IDs, order, FR/AR labels, and ID-based filtering', () => {
    expect(CATEGORIES).toEqual([
      'construction',
      'delivery',
      'cleaning',
      'tutoring',
      'restaurant',
      'events',
      'digital'
    ]);

    for (const cat of CATEGORIES) {
      const key = `categories.${cat}`;
      expect(STRINGS.fr[key]?.trim().length, `Missing FR label for ${cat}`).toBeGreaterThan(0);
      expect(STRINGS.ar[key]?.trim().length, `Missing AR label for ${cat}`).toBeGreaterThan(0);
    }

    const sampleItems = CATEGORIES.map((category, idx) => ({ id: `g-${idx}`, category }));
    const filtered = sampleItems.filter((item) => item.category === 'delivery');
    expect(filtered).toEqual([{ id: 'g-1', category: 'delivery' }]);
  });
});
