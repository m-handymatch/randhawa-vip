// randhawa.vip: upcoming local events for the signed-in user's city and nearby cities.
//
// Source: Google Events results via SerpApi (engine=google_events).
// SerpApi's free plan has 250 searches a month, so:
//   - each city is looked up at most once every EVENTS_CACHE_HOURS (default 24) and saved in local_events_cache;
//   - every SerpApi call first takes a slot from a monthly budget (EVENTS_MONTHLY_LIMIT, default 240);
//     when the budget is used up, saved (older) results are shown instead.
//
// Needs the secret SERPAPI_KEY (Supabase dashboard -> Edge Functions -> Secrets).
// Only titles, dates, venues and links are returned; each event links to its source.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const CACHE_HOURS = Number(Deno.env.get("EVENTS_CACHE_HOURS") ?? "24");
const MONTHLY_LIMIT = Number(Deno.env.get("EVENTS_MONTHLY_LIMIT") ?? "240");
const MAX_RESULTS = 20;
const RETRY_HOURS = 3;

const ALLOWED_ORIGINS = new Set([
  "https://randhawa.vip",
  "https://www.randhawa.vip",
  "https://m-handymatch.github.io",
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

type LocalEvent = {
  title: string; link: string | null; when: string | null; start: string | null;
  venue: string | null; address: string | null; image: string | null; place?: string;
};

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "Nov 22" -> "2026-11-22" (rolls into next year when the date has already passed by a month or more).
export function startDate(text: unknown, now = new Date()): string | null {
  if (typeof text !== "string") return null;
  const m = text.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  let year = now.getUTCFullYear();
  const d = new Date(Date.UTC(year, month, Number(m[2])));
  if (d.getTime() < now.getTime() - 31 * 864e5) year += 1;
  return new Date(Date.UTC(year, month, Number(m[2]))).toISOString().slice(0, 10);
}

function tidy(s: unknown, max = 200): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}
function safeUrl(u: unknown): string | null {
  return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null;
}

export function parseEvents(json: any, city: string): LocalEvent[] {
  const rows: any[] = Array.isArray(json?.events_results) ? json.events_results : [];
  const events = rows.map((e): LocalEvent | null => {
    const title = tidy(e?.title, 160);
    if (!title) return null;
    const address = Array.isArray(e?.address) ? tidy(e.address.join(", "), 160) : tidy(e?.address, 160);
    return {
      title,
      link: safeUrl(e?.link),
      when: tidy(e?.date?.when, 80),
      start: startDate(e?.date?.start_date),
      venue: tidy(e?.venue?.name, 80),
      address,
      image: safeUrl(e?.thumbnail),
    };
  }).filter((e): e is LocalEvent => !!e);
  // Prefer events whose address names the city; fall back to all if that leaves too few.
  const inCity = events.filter((e) => (e.address ?? "").toLowerCase().includes(city.toLowerCase()));
  return inCity.length >= 3 ? inCity : events;
}

async function takeBudget(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc("take_serpapi_search", { p_limit: MONTHLY_LIMIT });
  return !error && data === true;
}

async function placeEvents(db: SupabaseClient, city: string, state: string, apiKey: string | undefined): Promise<LocalEvent[]> {
  const key = `${city.toLowerCase()}|${state}`;
  const { data: cached } = await db.from("local_events_cache").select("events, fetched_at").eq("area_key", key).maybeSingle();
  const fresh = cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_HOURS * 3600e3;
  if (fresh) return cached!.events as LocalEvent[];
  const stale = (cached?.events as LocalEvent[] | undefined) ?? [];
  if (!apiKey || !(await takeBudget(db))) return stale;

  const stateName = STATE_NAMES[state] ?? state;
  const url = "https://serpapi.com/search.json?" + new URLSearchParams({
    engine: "google_events", q: `Events in ${city}, ${stateName}`, hl: "en", gl: "us", api_key: apiKey,
  });
  // After a failure, wait RETRY_HOURS before searching this city again (keeps the budget safe).
  const holdOff = async () => {
    const at = new Date(Date.now() - Math.max(0, CACHE_HOURS - RETRY_HOURS) * 3600e3).toISOString();
    await db.from("local_events_cache").upsert({ area_key: key, city, state, events: stale, fetched_at: at });
    return stale;
  };
  try {
    // Google Events through SerpApi can take 15-30 seconds for some cities.
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) return await holdOff();
    const json = await res.json();
    // A key or quota problem comes back as { error }: don't save it as "no events".
    // ("No results" is also an { error }, but that one is saved so the city isn't searched again all day.)
    if (json?.error && !Array.isArray(json?.events_results) && !/hasn't returned any results/i.test(String(json.error))) {
      console.log(`local-events: ${city}, ${state}: ${String(json.error).slice(0, 200)}`);
      return await holdOff();
    }
    const events = parseEvents(json, city).slice(0, 15);
    await db.from("local_events_cache").upsert({ area_key: key, city, state, events, fetched_at: new Date().toISOString() });
    return events;
  } catch (err) {
    console.log(`local-events: ${city}, ${state}: ${String(err).slice(0, 200)}`);
    return await holdOff();
  }
}

// Round-robin across places so each gets a fair share, then sort by date (undated last).
export function mergeEvents(lists: LocalEvent[][], today = new Date().toISOString().slice(0, 10)): LocalEvent[] {
  const seen = new Set<string>();
  const out: LocalEvent[] = [];
  const queues = lists.map((l) => l.filter((e) => !e.start || e.start >= today));
  for (let i = 0; out.length < MAX_RESULTS && queues.some((q) => i < q.length); i++) {
    for (const q of queues) {
      const e = q[i];
      if (!e) continue;
      const k = `${e.title.toLowerCase()}|${e.start ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(e);
      if (out.length >= MAX_RESULTS) break;
    }
  }
  return out.sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999"));
}

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

  const { data: profile } = await db.from("profiles").select("zip, nearby_places").eq("id", auth.user.id).maybeSingle();
  if (!profile?.zip) return reply(404, { error: "Add a ZIP code to see local events" }, origin);
  const { data: place } = await db.from("zip_zcta").select("city, state").eq("zip", profile.zip).maybeSingle();
  if (!place) return reply(404, { error: `We don't have location details for ZIP ${profile.zip}` }, origin);

  type Nearby = { name: string; state: string; label: string };
  const nearby: Nearby[] = (profile.nearby_places ?? [])
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

  const apiKey = Deno.env.get("SERPAPI_KEY");
  const labels = [place.city, ...nearby.map((n) => n.label)];
  const lists = await Promise.all([
    placeEvents(db, place.city, place.state, apiKey),
    ...nearby.map((n) => placeEvents(db, n.name, n.state, apiKey)),
  ]);
  const events = mergeEvents(lists.map((list, i) => list.map((e) => ({ ...e, place: labels[i] }))));
  return reply(200, { places: labels, events, configured: !!apiKey }, origin);
});
