import { isIP } from 'node:net';

/** Rate-limit key for a client address. Not an identity: many people can share
 * one address. IPv4-mapped IPv6 becomes IPv4. An IPv6 address is reduced to its
 * /64 because one host normally controls the whole /64 and could otherwise pick
 * a new address for every request. */
export function clientKey(address: string | undefined): string {
  if (!address) return 'local';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const value = (mapped?.[1] ?? address).replace(/%.*$/, '');
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6) {
    const groups = expandIPv6(value);
    if (groups) return `${groups.slice(0, 4).join(':')}::/64`;
  }
  return 'local';
}

function expandIPv6(address: string): string[] | undefined {
  let text = address.toLowerCase();
  // An embedded dotted tail (::1.2.3.4) is two groups.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = text.slice(0, tail.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return undefined;
  const groups = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill('0'), ...rest];
  return groups.map((group) => group.replace(/^0+(?=.)/, ''));
}
