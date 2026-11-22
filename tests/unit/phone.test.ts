import { describe, expect, it } from 'vitest';
import { normalizeDzPhone, waLink } from '../../src/lib/phone';

describe('normalizeDzPhone', () => {
  it('normalizes valid Algerian mobile formats to E.164', () => {
    expect(normalizeDzPhone('0550123456')).toBe('+213550123456');
    expect(normalizeDzPhone('550123456')).toBe('+213550123456');
    expect(normalizeDzPhone('661 23 45 67')).toBe('+213661234567');
    expect(normalizeDzPhone('0770-12-34-56')).toBe('+213770123456');
    expect(normalizeDzPhone('213550123456')).toBe('+213550123456');
    expect(normalizeDzPhone('+213 550 12 34 56')).toBe('+213550123456');
    expect(normalizeDzPhone('00213550123456')).toBe('+213550123456');
  });

  it('rejects non-Algerian, landline, or malformed numbers', () => {
    expect(normalizeDzPhone('')).toBeNull();
    expect(normalizeDzPhone('041123456')).toBeNull(); // Oran landline
    expect(normalizeDzPhone('+33612345678')).toBeNull();
    expect(normalizeDzPhone('05501234')).toBeNull();
    expect(normalizeDzPhone('05501234567')).toBeNull();
  });
});

describe('contact links', () => {
  it('builds wa.me URL without leading plus', () => {
    expect(waLink('+213550123456', 'Salam')).toBe('https://wa.me/213550123456?text=Salam');
  });
});
