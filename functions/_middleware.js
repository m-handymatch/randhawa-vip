// Cloudflare Pages gatekeeper: only listed IP addresses can open the site.
// It runs on every address the site has (randhawa.vip and *.pages.dev).
//
// Set the variable ALLOWED_IPS in Cloudflare:
//   Workers & Pages -> randhawa-vip -> Settings -> Variables and Secrets
//   e.g. "98.97.27.131" or "98.97.27.131, 203.0.113.5"
// While ALLOWED_IPS is empty, everyone is blocked (the site stays private).
export async function onRequest(context) {
  const allowed = String(context.env.ALLOWED_IPS || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const visitor = context.request.headers.get('CF-Connecting-IP') || '';

  if (!allowed.includes(visitor)) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Private</title><body style="font:18px/1.5 system-ui,sans-serif;background:#E6F3FF;color:#1D2B4F;display:grid;place-items:center;min-height:100vh;margin:0">' +
      '<p>randhawa.vip is private for now.</p></body>',
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }
  return context.next();
}
