# localconnect.site

Connecting neighbors. The first feature: local news for signed-in users, matched to the ZIP code on their profile.

Runs on the Supabase project **zip-zcta** (`pipzvzxcfvsxyiwmqpyv`, region us-west-1).

## How it works

1. A user signs up with Supabase Auth. A profile is created automatically; pass `zip` (and optionally `display_name`) as user metadata at sign-up, or let them set it later.
2. The app calls the `local-news` Edge Function with the user's session token.
3. The function reads the profile ZIP (or `?zip=12345`), looks it up in `zip_zcta` to get city, state and ZCTA, and returns up to 30 headlines for that city plus up to 5 **nearby places** saved on the profile. People pick those from a dropdown of the 15 cities closest to their ZIP (the `nearby_cities` database function, which measures miles between Census 2020 ZCTA centroids in `zcta_centroids`). Places are saved as "City, ST".
4. The home city uses NewsData.io and the Google News search feed; nearby places use Google News only (no credits). Each place gets a fair share of the list, Google headlines must name the place and the search requires the state name. Results are cached per place for 3 hours in `local_news_cache`. Only headlines, short summaries and links are returned.

## Setup

- Add the secret `NEWSDATA_API_KEY` in Supabase: **Edge Functions → Secrets**. Optional: `NEWS_CACHE_HOURS`.
- The function only answers browsers on `https://localconnect.site`, `https://www.localconnect.site` and `http://localhost`. Change `ALLOWED_ORIGINS` in the function if the site lives elsewhere, then redeploy.

## Calling it from the site

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
const supabase = createClient('https://pipzvzxcfvsxyiwmqpyv.supabase.co', 'sb_publishable_lt-qIsIQf8oXzk-P6b4mAQ_2BwK15ZN');

// Sign up with a ZIP
await supabase.auth.signUp({ email, password, options: { data: { zip: '94110', display_name: 'Mike' } } });

// Update ZIP later
await supabase.from('profiles').update({ zip: '94110' }).eq('id', (await supabase.auth.getUser()).data.user.id);

// Get local news
const { data: { session } } = await supabase.auth.getSession();
const res = await fetch('https://pipzvzxcfvsxyiwmqpyv.supabase.co/functions/v1/local-news', {
  headers: { Authorization: `Bearer ${session.access_token}` }
});
const { location, articles } = await res.json();
```

## The website

`index.html`, `assets/style.css`, `assets/app.js`: a plain static site, no build step.

- Signed out: sign up (first name, ZIP, email, password) or sign in. The ZIP is checked as you type and shows the city.
- Signed in: a street of houses with yours lit up and your ZIP on the mailbox, a greeting, your neighborhood, a box to change your ZIP, and local headlines that link to the original stories.

### Publish it (Cloudflare Workers)

The site lives in `public/`; `src/worker.js` runs first on every request and lets in only the IPs in the variable `ALLOWED_IPS`: comma-separated addresses or ranges such as `98.97.0.0/16` (IPv4 or IPv6). Empty = everyone blocked. `keep_vars` in `wrangler.jsonc` keeps dashboard variables across deploys; ignore Cloudflare's suggestion to copy them into the config (the repo is public). `wrangler.jsonc` ties them together.

1. Cloudflare → **Workers & Pages → Create application → Import a repository** → `m-handymatch/randhawa-vip`.
2. Build command: leave empty. Deploy command: `npx wrangler deploy`. Deploy.
3. **Settings → Variables and Secrets** → add `ALLOWED_IPS` (type Text) → Deploy.
4. **Settings → Domains & Routes → Add → Custom domain** → `localconnect.site`.
5. Supabase (zip-zcta) → **Authentication → URL Configuration**: Site URL `https://localconnect.site`, Redirect URL `https://localconnect.site/**`.

### Private: only your IP (Cloudflare)

- Website: `src/worker.js` lets in only the IPs in the Worker variable `ALLOWED_IPS`. Covers localconnect.site and the *.workers.dev address.
- Optional extra layer: Cloudflare **Security → Security rules → Create rule → Custom rules**, block when `not ip.src in {YOUR.IP}`.
- News function: Supabase secret `ALLOWED_IPS` (same format, addresses or ranges). Unset = open to everyone.

To use the localconnect.site domain later: add it under Settings → Pages → Custom domain, point the DNS records GitHub shows, then update the Site URL in Supabase.

## Files

- `public/`: the website (`index.html`, `assets/`)
- `src/worker.js`, `wrangler.jsonc`: Cloudflare Worker that serves the site behind the IP gate
- `supabase/schema.sql`: tables, security rules and sign-up trigger (already applied)
- `supabase/functions/local-news/index.ts`: the Edge Function (already deployed)

ZIP data: UDS Mapper ZIP Code to ZCTA Crosswalk 2022 (HRSA), 2020 Census ZCTAs.

## About your city card

The dashboard shows a card for the signed-in person's city, loaded in their browser:

- **Summary**: the first three sentences of the city's English Wikipedia article ("City, State" title first). Shown with credit and a link to CC BY-SA 4.0.
- **Photo**: the article's lead image, only if Wikimedia Commons lists a free license (CC BY, CC BY-SA, CC0, public domain or GFDL; no NC/ND). The photographer and license are shown under it.
- **City website**: the "official website" (P856) from Wikidata.
- **Map**: an OpenStreetMap embed centred on the ZIP's ZCTA centroid, credited to OpenStreetMap contributors. OSM's free tiles are for light use; switch to a paid tile provider if the site goes public with real traffic.

Photos from city websites aren't used: state and local government works can be copyrighted.

## Upcoming events

The left column under the city card lists upcoming events for the home city and the nearby cities on the profile, from the `local-events` edge function.

- **Source:** Google Events results through [SerpApi](https://serpapi.com) (`engine=google_events`, query "Events in City, State"). Each event links to its source.
- **Key:** the secret `SERPAPI_KEY` (Supabase dashboard → Edge Functions → Secrets).
- **Staying free:** SerpApi's free plan is 250 searches a month. Each city is searched at most once a day (`EVENTS_CACHE_HOURS`, default 24) and saved in `local_events_cache`. Every search also takes a slot from a monthly budget in `serpapi_usage` (`EVENTS_MONTHLY_LIMIT`, default 240). When the budget runs out, the saved results are shown until next month.
- Up to 20 events, the next ones first; past events are dropped.

## Around your city: weather, alerts, air, county, home values

All loaded in the visitor's browser from free public sources (no keys), except home values:

- **Weather and alerts:** National Weather Service (`api.weather.gov`), for the ZIP's centroid. Active alerts show in the third tile, colored by seriousness (most serious first).
- **Air quality:** US AQI from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).
- **County:** the city's county, county seat and county website from Wikidata.
- **Home values:** Zillow Home Value Index (typical home value and 12-month change) per city, shown in the Open houses list. The GitHub Action `.github/workflows/home-values.yml` downloads Zillow Research's public ZHVI CSVs on the 20th of each month and writes small per-state files to `public/data/home-values/` (run it by hand from the Actions tab anytime). Zillow requires clear attribution, which the page shows.

## Member pages (name.localconnect.site) and the neighborhood forum

- **Pages:** a signed-in member claims an address (3–30 letters, numbers or single dashes; words like www, admin, mail are reserved) in "Your page" on the main site. `<name>.localconnect.site` is served by the Worker from `public/member.html` + `assets/member.js`, which load the member's page and posts with the public key. Pages and posts are readable by anyone; writing happens only on localconnect.site.
- **Forum:** posts from all member pages, shown on the main site in "Neighborhood forum" (near you = your city + your nearby cities, or everywhere), with replies, Report, Delete (own posts) and admin Hide. Code: `public/assets/forum.js`.
- **Database (zip-zcta project):** `member_sites`, `posts`, `replies`, `reports`, `admins`, functions `forum_feed`, `open_reports`, `am_i_admin`, and guards in the `private` schema. Created by the migrations `member_pages_and_forum` and `forum_feed_and_autohide_fix` (Supabase dashboard → Database → Migrations).
- **Safety:** row-level security everywhere; triggers set author, city and page name (people can't fake them); limits of 10 posts and 60 replies a day (30 s / 10 s apart); 3 reports from different people hide a post or reply until an admin reviews it; admins (table `admins`) see reports in the forum sidebar.
- **Rules:** `public/rules.html`; agreeing is required at sign-up.

### Turning it on (Cloudflare dashboard)
1. DNS → Records → Add: type **AAAA**, name **\***, IPv6 **100::**, Proxied (orange cloud).
2. Workers & Pages → randhawa-vip → Settings → Domains & Routes → Add → **Route**: `*.localconnect.site/*`, zone localconnect.site.
3. When ready to open the site to everyone: Settings → Variables and Secrets → set **ALLOWED_IPS** to `*`. (Also delete any `ALLOWED_IPS` secret on the Supabase edge functions, if one was set.)


## Domain (Nov 2026)

- **localconnect.site is the only address.** Member pages are `<name>.localconnect.site`; `www.localconnect.site` redirects to the bare domain. The admin page stays on mandeepsr.us.
- **randhawa.vip is disconnected.** The Worker answers any other domain with a 404, and the Supabase functions no longer accept requests from it. The Worker and repo keep the name `randhawa-vip` (renaming the Worker would break the GitHub deploy link).
- **Still private:** `SITE_IS_PUBLIC` in `src/worker.js` is `false`, so only the IPs in `LOCK_TO_IPS` (or the older `ALLOWED_IPS`) can open the site. Set it to `true` to open it to everyone.
- Cloudflare for localconnect.site: Worker custom domains `localconnect.site` and `www.localconnect.site`, DNS `AAAA *` → `100::` proxied, Worker route `*.localconnect.site/*`. Leave the MX records alone (they carry the site's email).
- Supabase (zip-zcta) → Authentication → URL Configuration: Site URL `https://localconnect.site`, Redirect URL `https://localconnect.site/**`.

## Farmers markets

The top of the Local events box lists farmers markets within 6 miles of the home city and the picked nearby cities. The data is the USDA National Farmers Market Directory (USDA AMS Local Food Portal export), refreshed every Monday by `.github/workflows/farmers-markets.yml` (`scripts/farmers_markets.py`) into `public/data/farmers-markets/{lat}_{lon}.json`, one file per 1-degree square. Duplicate listings within about 250 m keep the most recently updated one. The directory has no reliable hours, so the box asks people to check before they go.

## Local businesses (admin only)

`public.businesses` holds local businesses from Overture Maps Places (CDLA-Permissive-2.0): name, category, address, ZIP, website, phone and email when listed. Only site admins can read it (RLS uses `private.is_admin()`).

**Loads as the site grows.** When a member saves a home ZIP or nearby cities, a database trigger queues the 0.25-degree squares (about 17 by 14 miles) around them in `public.business_areas`. Every 6 hours the **Extract local businesses** GitHub Action asks the `businesses-import` function for up to 3 queued squares, downloads those businesses from Overture and sends them back. The Action proves who it is with GitHub's built-in OIDC token, so no secret is stored anywhere, and nothing is committed to this public repo. Failed squares are retried after 12 hours.

The free Supabase plan allows 500 MB. Loading pauses when the database passes 420 MB (the queued squares get a note saying so); upgrade to Pro to keep going. A dense square like San Francisco is about 100,000 businesses / 40 MB.

Any other area, by hand: make a one-time token in Supabase SQL (20 minutes):
`insert into private.import_tokens (token, purpose, expires_at) values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'businesses', now() + interval '20 minutes') returning token;`
then run the Action with a bounding box (`west,south,east,north`) and that token.

Don't send cold email to this list through Resend (its policy forbids unsolicited email, and it also sends the site's sign-in mail).

## Admin page (mandeepsr.us)

`mandeepsr.us` shows `public/admin/` and nothing else. The Worker always locks it to `ADMIN_IPS` (or, if that isn't set, `LOCK_TO_IPS` / `ALLOWED_IPS`), even after the main site goes public, and the `/admin/` files return 404 on every other domain. The page also asks for your site sign-in, and the data (`admin_ledger`, `admin_next`, `admin_stats()`) is readable only by admins, so the IP lock is not the only lock.

To set it up: Cloudflare → Workers & Pages → randhawa-vip → Settings → Domains & Routes → Add → Custom domain → `mandeepsr.us` (and `www.mandeepsr.us`).
Costs can be edited on the page ("Edit costs"); "Next up" items can be ticked off there.
