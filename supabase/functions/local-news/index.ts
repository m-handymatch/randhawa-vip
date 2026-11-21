// randhawa.vip: local news for the signed-in user's area.
//
// 1. Checks the user's login (Supabase Auth token in the Authorization header).
// 2. Reads the ZIP on their profile (or ?zip= for any valid US ZIP).
// 3. Looks the ZIP up in zip_zcta to get city, state and ZCTA.
// 4. Gathers news for the city (NewsData.io + Google News) and for the
//    nearby places on the profile (Google News), caching each place.
//
// Needs the secret NEWSDATA_API_KEY (Supabase dashboard -> Edge Functions -> Secrets).
// Only headlines, short summaries and links are returned, never full articles.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CACHE_HOURS = Number(Deno.env.get("NEWS_CACHE_HOURS") ?? "3");

const ALLOWED_ORIGINS = new Set([
  "https://randhawa.vip",
  "https://www.randhawa.vip",
  "https://m-handymatch.github.io",   // GitHub Pages, until randhawa.vip points at the site
]);

const STATE_NAMES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky",
  LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota",
  MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire",
  NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota",
  OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island",
  SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont",
  VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  PR: "puerto rico",
};

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (ALLOWED_ORIGINS.has(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://randhawa.vip",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}

function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

type Article = {
  title: string; link: string; source: string | null; published: string | null;
  image: string | null; summary: string | null; place?: string;
};

const MAX_RESULTS = 30;

// Dates come as "2026-11-20 16:20:25" (NewsData, UTC) or RFC 822 (Google). Return ISO.
function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  const t = Date.parse(v);
  return isNaN(t) ? null : new Date(t).toISOString();
}

function tidy(raw: any): Article | null {
  if (!raw?.title || !raw?.link) return null;
  const summary = typeof raw.description === "string" ? raw.description.replace(/\s+/g, " ").trim().slice(0, 280) : null;
  return {
    title: String(raw.title).slice(0, 300),
    link: String(raw.link),
    source: raw.source_name ?? raw.source_id ?? null,
    published: isoDate(raw.pubDate),
    image: raw.image_url ?? null,
    summary: summary || null,
  };
}

// ---- NewsData.io (uses credits; only for the home city) ----
async function newsDataNews(apiKey: string, city: string, state: string): Promise<Article[]> {
  const stateName = STATE_NAMES[state] ?? state.toLowerCase();
  const base = "https://newsdata.io/api/1/latest";
  const common = { apikey: apiKey, country: "us", language: "en", removeduplicate: "1" };
  // The region filter isn't honored on every plan, so keep only results that mention the city.
  const attempts = [
    { ...common, qInTitle: `"${city}"` },
    { ...common, region: `${city.toLowerCase()}-${stateName}-united states of america` },
    { ...common, q: `"${city}"` },
  ];
  const cityLower = city.toLowerCase();
  const mentionsCity = (a: Article) =>
    a.title.toLowerCase().includes(cityLower) || (a.summary ?? "").toLowerCase().includes(cityLower);

  const found: Article[] = [];
  for (const params of attempts) {
    const res = await fetch(`${base}?${new URLSearchParams(params)}`).catch(() => null);
    if (!res?.ok) continue;
    const body = await res.json().catch(() => null);
    if (body?.status !== "success" || !Array.isArray(body.results)) continue;
    for (const a of body.results.map(tidy).filter(Boolean) as Article[]) if (mentionsCity(a)) found.push(a);
    if (found.length >= 10) break;
  }
  return found;
}

// ---- Google News search feed (free, no key) ----
function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(item: string, name: string): string | null {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]) : null;
}

async function googleNews(place: string, state: string): Promise<Article[]> {
  const stateName = STATE_NAMES[state] ?? state;
  // Both the place and the state name must appear, so "Oakland" doesn't match Oakland, Michigan.
  const q = `"${place}" "${stateName}" when:3d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": "randhawa.vip local news" } }).catch(() => null);
  if (!res?.ok) return [];
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: Article[] = [];
  for (const item of items.slice(0, 40)) {
    let title = tag(item, "title");
    const link = tag(item, "link");
    if (!title || !link || !/^https:\/\//.test(link)) continue;
    const source = tag(item, "source");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    // Keep only headlines that name the place; the rest are usually statewide or national.
    if (!title.toLowerCase().includes(place.toLowerCase())) continue;
    out.push({ title: title.slice(0, 300), link, source, published: isoDate(tag(item, "pubDate")), image: null, summary: null });
  }
  return out;
}

// One place's articles, cached per place for CACHE_HOURS.
async function placeNews(
  db: any, place: string, state: string, withNewsData: boolean, apiKey: string | undefined,
): Promise<Article[]> {
  const areaKey = `${place.toLowerCase()}|${state}${withNewsData ? "" : "|google"}`;
  const { data: cached } = await db.from("local_news_cache").select("articles, fetched_at").eq("area_key", areaKey).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_HOURS * 3600 * 1000) {
    return cached.articles as Article[];
  }

  const [nd, gn] = await Promise.all([
    withNewsData && apiKey ? newsDataNews(apiKey, place, state).catch(() => []) : Promise.resolve([]),
    googleNews(place, state).catch(() => []),
  ]);
  const articles = [...nd, ...gn].map((a) => ({ ...a, place }));
  if (!articles.length) return (cached?.articles as Article[]) ?? [];

  await db.from("local_news_cache").upsert({
    area_key: areaKey, city: place, state, articles, fetched_at: new Date().toISOString(),
  });
  return articles;
}

function normalizedTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

const newestFirst = (x: Article, y: Article) => (y.published ?? "").localeCompare(x.published ?? "");

// Merge places fairly: each place gets an equal share of the list first,
// then any spare room goes to the newest leftovers. Duplicates are dropped.
function mergeArticles(lists: Article[][]): Article[] {
  const seen = new Set<string>();
  const perPlace = lists.map((list) => {
    const unique: Article[] = [];
    for (const a of [...list].sort(newestFirst)) {
      const key = normalizedTitle(a.title);
      if (!key || seen.has(key) || seen.has(a.link)) continue;
      seen.add(key); seen.add(a.link);
      unique.push(a);
    }
    return unique;
  });
  const share = Math.ceil(MAX_RESULTS / Math.max(1, perPlace.length));
  const picked = perPlace.flatMap((list) => list.slice(0, share));
  const spare = perPlace.flatMap((list) => list.slice(share)).sort(newestFirst);
  return [...picked, ...spare].slice(0, MAX_RESULTS).sort(newestFirst);
}

// Optional IP allowlist: set the secret ALLOWED_IPS to comma-separated addresses
// and/or ranges, e.g. "98.97.27.131" or "98.97.0.0/16". Leave it unset to allow everyone.
const ALLOWED_IPS = Deno.env.get("ALLOWED_IPS") ?? "";

function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-real-ip")
    ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0]).trim();
}

function parseIp(ip: string): { v: 4 | 6; n: bigint } | null {
  ip = ip.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { v: 4, n: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
  }
  if (ip.includes(":")) {
    const mapped = ip.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i);
    if (mapped) return parseIp(mapped[1]);
    const halves = ip.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
    if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
    return { v: 6, n: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n) };
  }
  return null;
}

function isAllowed(visitorIp: string, list: string): boolean {
  const visitor = parseIp(visitorIp);
  if (!visitor) return false;
  return list.split(",").map((r) => r.trim()).filter(Boolean).some((rule) => {
    const [addr, bitsText] = rule.split("/");
    const ip = parseIp(addr);
    if (!ip || ip.v !== visitor.v) return false;
    const width = ip.v === 4 ? 32 : 128;
    const bits = bitsText === undefined ? width : Number(bitsText);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) return false;
    const shift = BigInt(width - bits);
    return (visitor.n >> shift) === (ip.n >> shift);
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (ALLOWED_IPS.trim() && !isAllowed(clientIp(req), ALLOWED_IPS)) {
    return reply(403, { error: "This site is private" }, origin);
  }
  if (req.method !== "GET") return reply(405, { error: "Use GET" }, origin);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Please sign in" }, origin);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth?.user) return reply(401, { error: "Please sign in" }, origin);

  const requested = new URL(req.url).searchParams.get("zip");
  let zip = requested;
  if (!zip) {
    const { data: profile } = await db.from("profiles").select("zip").eq("id", auth.user.id).maybeSingle();
    zip = profile?.zip ?? null;
  }
  if (!zip) return reply(404, { error: "Add a ZIP code to your profile to see local news" }, origin);
  if (!/^[0-9]{5}$/.test(zip)) return reply(400, { error: "ZIP must be 5 digits" }, origin);

  // ZIP -> city, state, ZCTA.
  const { data: place } = await db.from("zip_zcta").select("zip, zcta, city, state").eq("zip", zip).maybeSingle();
  if (!place) return reply(404, { error: `We don't have location details for ZIP ${zip}` }, origin);

  const location = { zip: place.zip, zcta: place.zcta, city: place.city, state: place.state };

  // Nearby places from the profile (only when using the profile's own ZIP).
  // Saved as "City, ST" (from the nearby-cities picker); a bare name means the home state.
  type Nearby = { name: string; state: string; label: string };
  let nearby: Nearby[] = [];
  if (!requested) {
    const { data: prof } = await db.from("profiles").select("nearby_places").eq("id", auth.user.id).maybeSingle();
    nearby = (prof?.nearby_places ?? [])
      .map((raw: string): Nearby | null => {
        const p = raw.trim();
        const m = p.match(/^(.*\S),\s*([A-Z]{2})$/);
        const name = (m ? m[1] : p).trim();
        const st = m ? m[2] : place.state;
        if (!name || !STATE_NAMES[st]) return null;
        return { name, state: st, label: st === place.state ? name : `${name}, ${st}` };
      })
      .filter((n: Nearby | null): n is Nearby =>
        !!n && !(n.name.toLowerCase() === place.city.toLowerCase() && n.state === place.state))
      .slice(0, 5);
  }

  const apiKey = Deno.env.get("NEWSDATA_API_KEY");
  const labels = [place.city, ...nearby.map((n) => n.label)];
  const lists = await Promise.all([
    placeNews(db, place.city, place.state, true, apiKey),
    ...nearby.map((n) => placeNews(db, n.name, n.state, false, apiKey)),
  ]);
  const articles = mergeArticles(lists.map((list, i) => list.map((a) => ({ ...a, place: labels[i] }))));

  return reply(200, { location, places: labels, articles }, origin);
});
