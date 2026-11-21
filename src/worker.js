// randhawa.vip Worker: only listed IP addresses can open the site.
// Runs before every request, on every address (randhawa.vip and *.workers.dev).
//
// Set the variable ALLOWED_IPS in Cloudflare:
//   Workers & Pages -> randhawa-vip -> Settings -> Variables and Secrets
// Comma-separated exact addresses and/or ranges (IPv4 or IPv6), e.g.
//   "98.97.27.131"   or   "98.97.0.0/16, 2001:db8::/32"
// While ALLOWED_IPS is empty, everyone is blocked (the site stays private).
const PRIVATE_PAGE =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Private</title><body style="font:18px/1.5 system-ui,sans-serif;background:#E6F3FF;color:#1D2B4F;display:grid;place-items:center;min-height:100vh;margin:0">' +
  '<p>randhawa.vip is private for now.</p></body>';

// IP address -> { v: 4|6, n: BigInt }, or null if not an IP.
function parseIp(ip) {
  ip = ip.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { v: 4, n: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
  }
  if (ip.includes(':')) {
    const mapped = ip.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i);
    if (mapped) return parseIp(mapped[1]);
    const halves = ip.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
    if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
    return { v: 6, n: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n) };
  }
  return null;
}

// "1.2.3.4" or "1.2.0.0/16" (or IPv6) -> matcher, or null if malformed.
function parseRule(rule) {
  const [addr, bitsText] = rule.split('/');
  const ip = parseIp(addr);
  if (!ip) return null;
  const width = ip.v === 4 ? 32 : 128;
  const bits = bitsText === undefined ? width : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const shift = BigInt(width - bits);
  return (visitor) => visitor && visitor.v === ip.v && (visitor.n >> shift) === (ip.n >> shift);
}

export function isAllowed(visitorIp, allowedList) {
  const rules = String(allowedList || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map(parseRule)
    .filter(Boolean);
  const visitor = parseIp(visitorIp || '');
  return rules.some((match) => match(visitor));
}

export default {
  async fetch(request, env) {
    if (!isAllowed(request.headers.get('CF-Connecting-IP'), env.ALLOWED_IPS)) {
      return new Response(PRIVATE_PAGE, {
        status: 403,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
