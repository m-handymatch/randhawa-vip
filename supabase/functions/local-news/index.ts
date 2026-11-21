// randhawa.vip: local news for the signed-in user's area.
//
// 1. Checks the user's login (Supabase Auth token in the Authorization header).
// 2. Reads the ZIP on their profile (or ?zip= for any valid US ZIP).
// 3. Looks the ZIP up in zip_zcta to get city, state and ZCTA.
// 4. Returns cached news for that city if it's fresh; otherwise asks
//    NewsData.io, saves the result, and returns it.
//
// Needs the secret NEWSDATA_API_KEY (Supabase dashboard -> Edge Functions -> Secrets).
// Only headlines, short summaries and links are returned, never full articles.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CACHE_HOURS = Number(Deno.env.get("NEWS_CACHE_HOURS") ?? "3");
const MAX_ARTICLES = 10;

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

type Article = { title: string; link: string; source: string | null; published: string | null; image: string | null; summary: string | null };

function tidy(raw: any): Article | null {
  if (!raw?.title || !raw?.link) return null;
  const summary = typeof raw.description === "string" ? raw.description.replace(/\s+/g, " ").trim().slice(0, 280) : null;
  return {
    title: String(raw.title).slice(0, 300),
    link: String(raw.link),
    source: raw.source_name ?? raw.source_id ?? null,
    published: raw.pubDate ?? null,
    image: raw.image_url ?? null,
    summary: summary || null,
  };
}

async function fetchNews(apiKey: string, city: string, state: string): Promise<Article[]> {
  const stateName = STATE_NAMES[state] ?? state.toLowerCase();
  const base = "https://newsdata.io/api/1/latest";
  const common = { apikey: apiKey, country: "us", language: "en", removeduplicate: "1" };

  // Several ways to ask; the region filter isn't honored on every plan, so every
  // result is kept only if it actually mentions the city.
  const attempts = [
    { ...common, qInTitle: `"${city}"` },
    { ...common, region: `${city.toLowerCase()}-${stateName}-united states of america` },
    { ...common, q: `"${city}"` },
  ];

  const cityLower = city.toLowerCase();
  const mentionsCity = (a: Article) =>
    a.title.toLowerCase().includes(cityLower) || (a.summary ?? "").toLowerCase().includes(cityLower);

  const found: Article[] = [];
  const seen = new Set<string>();
  for (const params of attempts) {
    const res = await fetch(`${base}?${new URLSearchParams(params)}`);
    if (!res.ok) continue;
    const body = await res.json().catch(() => null);
    if (body?.status !== "success" || !Array.isArray(body.results)) continue;
    for (const a of body.results.map(tidy).filter(Boolean) as Article[]) {
      if (!mentionsCity(a) || seen.has(a.link) || seen.has(a.title)) continue;
      seen.add(a.link); seen.add(a.title);
      found.push(a);
    }
    if (found.length >= MAX_ARTICLES) break;
  }
  found.sort((x, y) => (y.published ?? "").localeCompare(x.published ?? ""));
  return found.slice(0, MAX_ARTICLES);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
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
  const areaKey = `${place.city.toLowerCase()}|${place.state}`;

  // Fresh cache?
  const { data: cached } = await db.from("local_news_cache").select("articles, fetched_at").eq("area_key", areaKey).maybeSingle();
  const fresh = cached && (Date.now() - new Date(cached.fetched_at).getTime()) < CACHE_HOURS * 3600 * 1000;
  if (fresh) return reply(200, { location, articles: cached.articles, cached: true, fetched_at: cached.fetched_at }, origin);

  const apiKey = Deno.env.get("NEWSDATA_API_KEY");
  if (!apiKey) {
    if (cached) return reply(200, { location, articles: cached.articles, cached: true, stale: true, fetched_at: cached.fetched_at }, origin);
    return reply(503, { error: "Local news isn't set up yet" }, origin);
  }

  let articles: Article[] = [];
  try {
    articles = await fetchNews(apiKey, place.city, place.state);
  } catch {
    articles = [];
  }

  if (!articles.length && cached) {
    return reply(200, { location, articles: cached.articles, cached: true, stale: true, fetched_at: cached.fetched_at }, origin);
  }

  const fetchedAt = new Date().toISOString();
  await db.from("local_news_cache").upsert({
    area_key: areaKey, city: place.city, state: place.state, articles, fetched_at: fetchedAt,
  });

  return reply(200, { location, articles, cached: false, fetched_at: fetchedAt }, origin);
});
