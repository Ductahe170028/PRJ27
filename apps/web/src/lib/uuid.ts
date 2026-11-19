/** UUID v4 that works outside a secure context. `crypto.randomUUID` is missing
 * on plain HTTP, which is how the app is currently reached by public IP. */
export function randomUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('Trình duyệt không cung cấp crypto.getRandomValues.');
  }
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  // RFC 4122: version 4 in the high nibble of byte 6, variant 10xxxxxx in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
