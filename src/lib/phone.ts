// Normalize Algerian phone input to E.164 (+213xxxxxxxxx).
// Accepts: 0550123456, 550123456, 213550123456, +213 550 12 34 56, 00213550123456.
export function normalizeDzPhone(input: string): string | null {
  let d = input.replace(/[\s\-().]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (/^213/.test(d) && !d.startsWith('+')) d = '+' + d;
  if (d.startsWith('0')) d = '+213' + d.slice(1);
  if (!/^\+213[567]\d{8}$/.test(d)) return null;
  return d;
}

// wa.me link (number without '+').
export function waLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}
