// Admin page (mandeepsr.us): create + send PayPal invoices, and check which are paid.
//
// Needs Supabase secrets PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (a PayPal REST app,
// developer.paypal.com > Apps & Credentials > Live). PAYPAL_ENV=sandbox switches to testing.
// Only site admins can call it (their sign-in token is checked against public.admins).
//
//   POST { action: "status" }                       -> { configured }
//   POST { action: "send", customer, email, items, due_on, note, recurring }
//                                                   -> creates, sends, records in admin_invoices
//   POST { action: "sync" }                         -> marks paid invoices, adds money entries
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED = new Set(["https://mandeepsr.us", "https://www.mandeepsr.us"]);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && (ALLOWED.has(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) ? origin : "https://mandeepsr.us",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Vary": "Origin",
});
const reply = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

const ENV = (Deno.env.get("PAYPAL_ENV") ?? "live").toLowerCase();
const API = ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
const CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID") ?? "";
const SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET") ?? "";

// What every invoice says (same wording as the PayPal template).
const NOTE = "Thank you for supporting your neighbors on localconnect.site. Questions? Email support@localconnect.site.";
const TERMS = "Payment is due by the date shown. Sponsorships run for the period listed on this invoice and renew only if invoiced again. You can pay by PayPal, card, or bank transfer (Pay by Bank). Connecting Neighbors, Novato, CA.";
const LOGO = "https://randhawa.vip/assets/invoice-logo.png";
const WEBSITE = "https://localconnect.site";

async function token(): Promise<string> {
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${CLIENT_ID}:${SECRET}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`PayPal sign-in failed: ${j.error_description ?? res.status}`);
  return j.access_token;
}

async function pp(tok: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const j = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const why = j.details?.map((d: { issue?: string; description?: string; field?: string }) => `${d.field ?? ""} ${d.description ?? d.issue ?? ""}`.trim()).join("; ");
    throw new Error(`PayPal: ${j.message ?? res.status}${why ? ` (${why})` : ""}`);
  }
  return j;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "Use POST" }, origin);

  // Admin check with the caller's own sign-in.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return reply(401, { error: "Please sign in" }, origin);
  const { data: adminRow } = await db.from("admins").select("user_id").eq("user_id", who.user.id).maybeSingle();
  if (!adminRow) return reply(403, { error: "Admins only" }, origin);
  const input = await req.json().catch(() => ({}));
  const configured = !!(CLIENT_ID && SECRET);
  if (input.action === "status") return reply(200, { configured, env: ENV }, origin);
  if (!configured) return reply(400, { error: "PayPal isn't connected yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Supabase." }, origin);

  try {
    const tok = await token();

    if (input.action === "send") {
      const customer = String(input.customer ?? "").trim().slice(0, 120);
      const email = String(input.email ?? "").trim().toLowerCase();
      if (!customer || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: "Add the customer's name and a valid email." }, origin);
      const items = (Array.isArray(input.items) ? input.items : []).map((it: Record<string, unknown>) => ({
        name: String(it.name ?? "").trim().slice(0, 200),
        description: String(it.description ?? "").trim().slice(0, 1000) || undefined,
        quantity: String(Math.max(1, Math.round(Number(it.quantity) || 1))),
        unit_amount: { currency_code: "USD", value: money(Number(it.amount) || 0) },
        unit_of_measure: "QUANTITY",
      })).filter((it: { name: string; unit_amount: { value: string } }) => it.name && Number(it.unit_amount.value) > 0);
      if (!items.length) return reply(400, { error: "Add at least one item with a price." }, origin);
      const total = items.reduce((s: number, it: { quantity: string; unit_amount: { value: string } }) => s + Number(it.quantity) * Number(it.unit_amount.value), 0);
      const due = /^\d{4}-\d\d-\d\d$/.test(input.due_on ?? "") ? input.due_on : new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

      const { invoice_number } = await pp(tok, "POST", "/v2/invoicing/generate-next-invoice-number");
      const draft = await pp(tok, "POST", "/v2/invoicing/invoices", {
        detail: {
          invoice_number, currency_code: "USD",
          invoice_date: new Date().toISOString().slice(0, 10),
          payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: due },
          note: String(input.note ?? "").trim().slice(0, 4000) || NOTE,
          terms_and_conditions: TERMS,
        },
        invoicer: { website: WEBSITE, logo_url: LOGO },
        primary_recipients: [{ billing_info: { business_name: customer, email_address: email } }],
        items,
        configuration: { allow_tip: false, tax_calculated_after_discount: true, tax_inclusive: false },
      });
      const id = draft.id ?? String(draft.href ?? "").split("/").pop();
      await pp(tok, "POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, send_to_invoicer: true });
      const sent = await pp(tok, "GET", `/v2/invoicing/invoices/${id}`);
      const view = sent.detail?.metadata?.recipient_view_url ?? null;

      const description = items.map((it: { name: string; quantity: string }) => (Number(it.quantity) > 1 ? `${it.quantity} × ` : "") + it.name).join(", ").slice(0, 200);
      const { error } = await db.from("admin_invoices").insert({
        customer, customer_email: email, description, amount: money(total), sent_on: new Date().toISOString().slice(0, 10),
        due_on: due, status: "sent", recurring: !!input.recurring, paypal_url: view, paypal_id: id,
        paypal_status: sent.status ?? "SENT", invoice_number,
      });
      if (error) return reply(200, { ok: true, id, invoice_number, warning: `Sent, but not saved here: ${error.message}` }, origin);
      return reply(200, { ok: true, id, invoice_number, total: money(total), view }, origin);
    }

    if (input.action === "sync") {
      const { data: open } = await db.from("admin_invoices").select("*").not("paypal_id", "is", null).in("status", ["sent", "draft"]);
      let paid = 0, cancelled = 0;
      for (const v of open ?? []) {
        const inv = await pp(tok, "GET", `/v2/invoicing/invoices/${v.paypal_id}`).catch(() => null);
        if (!inv) continue;
        const st = String(inv.status ?? "");
        if (st === "PAID" || st === "MARKED_AS_PAID") {
          const tx = inv.payments?.transactions ?? [];
          const last = tx[tx.length - 1];
          const paidOn = String(last?.payment_date ?? new Date().toISOString()).slice(0, 10);
          const amount = Number(v.amount);
          // PayPal's invoice record doesn't include its fee; estimate the card rate (2.99% + $0.49) unless paid outside PayPal.
          const outside = st === "MARKED_AS_PAID" || /^(CASH|CHECK|BANK_TRANSFER|OTHER)$/.test(String(last?.method ?? ""));
          const fee = outside ? 0 : Number(money(amount * 0.0299 + 0.49));
          await db.from("admin_invoices").update({ status: "paid", paid_on: paidOn, fee, fee_estimated: !outside, paypal_status: st }).eq("id", v.id);
          const entries = [{ description: `Invoice paid: ${v.customer}${v.invoice_number ? ` (#${v.invoice_number})` : ""}`, amount, happened_on: paidOn }];
          if (fee) entries.push({ description: `PayPal fee (estimate): ${v.customer}`, amount: -fee, happened_on: paidOn });
          await db.from("admin_money").insert(entries);
          paid++;
        } else if (st === "CANCELLED") {
          await db.from("admin_invoices").update({ status: "void", paypal_status: st }).eq("id", v.id);
          cancelled++;
        } else if (st && st !== v.paypal_status) {
          await db.from("admin_invoices").update({ paypal_status: st }).eq("id", v.id);
        }
      }
      return reply(200, { ok: true, checked: (open ?? []).length, paid, cancelled }, origin);
    }

    return reply(400, { error: "Unknown action" }, origin);
  } catch (e) {
    return reply(502, { error: String((e as Error).message ?? e).slice(0, 500) }, origin);
  }
});
