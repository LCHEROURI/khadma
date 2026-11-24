import { describe, expect, it } from 'vitest';
import {
  buildGmailComposeUrl,
  isSafeContactUrl,
  parseMailtoUrl,
  resolveEnabledContactMethods
} from '../../src/lib/contactLink';

describe('KHADMA V1.4 Phase 3 — ContactButtons helpers', () => {
  it('resolves enabled contact methods with V1.3 legacy fallback to WhatsApp only', () => {
    expect(resolveEnabledContactMethods(undefined)).toEqual(['whatsapp']);
    expect(resolveEnabledContactMethods(null)).toEqual(['whatsapp']);
    expect(resolveEnabledContactMethods(['whatsapp'])).toEqual(['whatsapp']);
    expect(resolveEnabledContactMethods(['email'])).toEqual(['email']);
    expect(resolveEnabledContactMethods(['whatsapp', 'email', 'whatsapp'])).toEqual([
      'whatsapp',
      'email'
    ]);
    expect(resolveEnabledContactMethods([])).toEqual([]);
  });

  it('validates returned contact URLs strictly by scheme and blocks unsafe redirects', () => {
    expect(isSafeContactUrl('https://wa.me/213550123456?text=Bonjour', 'whatsapp')).toBe(true);
    expect(isSafeContactUrl('mailto:hr@oran.dz?subject=KHADMA', 'email')).toBe(true);

    // Unsafe schemes & cross-channel mismatches MUST be rejected
    expect(isSafeContactUrl('javascript:alert(1)', 'whatsapp')).toBe(false);
    expect(isSafeContactUrl('https://evil.example.com/phish', 'whatsapp')).toBe(false);
    expect(isSafeContactUrl('mailto:hr@oran.dz', 'whatsapp')).toBe(false);
    expect(isSafeContactUrl('https://wa.me/213550123456', 'email')).toBe(false);
    expect(isSafeContactUrl('mailto:hr@oran.dz\r\nBcc:evil@x.com', 'email')).toBe(false);
  });

  it('parses validated mailto URLs and builds properly encoded Gmail web compose URLs', () => {
    const mailto =
      'mailto:recrutement@oran-plomb.dz?subject=KHADMA%20%E2%80%94%20Plombier&body=Bonjour%20depuis%20Oran';
    expect(parseMailtoUrl(mailto)).toEqual({
      to: 'recrutement@oran-plomb.dz',
      subject: 'KHADMA — Plombier',
      body: 'Bonjour depuis Oran'
    });

    const gmail = buildGmailComposeUrl(mailto);
    expect(gmail).not.toBeNull();
    const parsedGmail = new URL(gmail!);
    expect(parsedGmail.origin).toBe('https://mail.google.com');
    expect(parsedGmail.pathname).toBe('/mail/');
    expect(parsedGmail.searchParams.get('view')).toBe('cm');
    expect(parsedGmail.searchParams.get('fs')).toBe('1');
    expect(parsedGmail.searchParams.get('to')).toBe('recrutement@oran-plomb.dz');
    expect(parsedGmail.searchParams.get('su')).toBe('KHADMA — Plombier');
    expect(parsedGmail.searchParams.get('body')).toBe('Bonjour depuis Oran');

    expect(parseMailtoUrl('https://wa.me/213550123456')).toBeNull();
    expect(buildGmailComposeUrl('javascript:alert(1)')).toBeNull();
  });
});
