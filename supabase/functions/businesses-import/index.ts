// Loads local businesses (Overture Maps Places, CDLA-Permissive-2.0) into
// public.businesses. Callers are the repo's GitHub Actions, proven with a
// GitHub OIDC token (no stored secrets), or a person holding a one-time import
// token from private.import_tokens.
//
//   POST ?action=claim          -> up to 3 pending areas from business_areas (OIDC only)
//   POST ?tile=38.00_-122.75    -> body: gzip CSV part from scripts/businesses.py (&final=1 on the last part marks it done)
//   POST ?tile=...&failed=why   -> marks the area failed
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { parse } from "jsr:@std/csv@1";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const REPO = "m-handymatch/randhawa-vip";
const AUDIENCE = "localconnect-businesses";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fromOurWorkflow(req: Request): Promise<boolean> {
  const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!auth) return false;
  try {
    const { payload } = await jwtVerify(auth, JWKS, {
      issuer: "https://token.actions.githubusercontent.com", audience: AUDIENCE,
    });
    return payload.repository === REPO && payload.ref === "refs/heads/main" &&
      String(payload.workflow_ref ?? "").startsWith(`${REPO}/.github/workflows/businesses.yml@`);
  } catch {
    return false;
  }
}

const clean = (v: unknown, max = 300) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const email = (v: unknown) => {
  const s = clean(v, 200);
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null;
};
const url = (v: unknown) => {
  const s = clean(v, 400);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const q = new URL(req.url).searchParams;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const workflow = await fromOurWorkflow(req);
  if (!workflow) {
    const token = req.headers.get("x-import-token") ?? "";
    if (q.get("action") === "claim" || !/^[A-Za-z0-9_-]{24,}$/.test(token)) return json(401, { error: "Not allowed" });
    const { data: ok } = await db.rpc("use_import_token", { p_token: token, p_purpose: "businesses" });
    if (ok !== true) return json(401, { error: "Token is invalid, used or expired" });
  }

  if (q.get("action") === "claim") {
    const { data, error } = await db.rpc("claim_business_areas", { p_limit: Number(q.get("limit") ?? 3) });
    if (error) return json(500, { error: error.message });
    return json(200, { areas: data ?? [] });
  }

  const tile = q.get("tile");
  if (tile && !/^-?\d+\.\d\d_-?\d+\.\d\d$/.test(tile)) return json(400, { error: "Bad tile" });
  if (tile && q.get("failed")) {
    await db.from("business_areas").update({ status: "failed", note: clean(q.get("failed"), 300) }).eq("tile", tile);
    return json(200, { ok: true });
  }

  const body = req.body!.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(body).text();
  const rows = parse(text, { skipFirstRow: true }) as Record<string, string>[];
  const now = new Date().toISOString();
  const items = rows.map((r) => {
    let socials: unknown = [];
    try { socials = JSON.parse(r.socials || "[]"); } catch { socials = []; }
    return {
      id: clean(r.id, 80), name: clean(r.name, 200), category: clean(r.category, 80),
      street: clean(r.street, 200), city: clean(r.city, 80), state: clean(r.state, 10),
      zip: /^\d{5}$/.test(r.zip ?? "") ? r.zip : null,
      lat: Number(r.lat) || null, lon: Number(r.lon) || null,
      website: url(r.website), phone: clean(r.phone, 40), email: email(r.email),
      socials: Array.isArray(socials) ? socials.slice(0, 5) : [],
      confidence: Number(r.confidence) || null, status: clean(r.status, 30), loaded_at: now,
    };
  }).filter((x) => x.id && x.name);

  let saved = 0;
  for (let i = 0; i < items.length; i += 1000) {
    const { error } = await db.from("businesses").upsert(items.slice(i, i + 1000), { onConflict: "id" });
    if (error) {
      if (tile) await db.from("business_areas").update({ status: "failed", note: error.message.slice(0, 300) }).eq("tile", tile);
      return json(500, { error: error.message, saved });
    }
    saved += Math.min(1000, items.length - i);
  }
  // The workflow sends an area in parts of a few thousand rows; the last part says final=1.
  if (tile && q.get("final") === "1") {
    const [south, west] = tile.split("_").map(Number);
    const { count } = await db.from("businesses").select("id", { count: "exact", head: true })
      .gte("lat", south).lt("lat", south + 0.25).gte("lon", west).lt("lon", west + 0.25);
    await db.from("business_areas").update({ status: "done", loaded_at: now, businesses: count ?? saved, note: null }).eq("tile", tile);
  }
  return json(200, { received: rows.length, saved });
});
