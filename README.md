# randhawa.vip

Connecting neighbors. The first feature: local news for signed-in users, matched to the ZIP code on their profile.

Runs on the Supabase project **zip-zcta** (`pipzvzxcfvsxyiwmqpyv`, region us-west-1).

## How it works

1. A user signs up with Supabase Auth. A profile is created automatically; pass `zip` (and optionally `display_name`) as user metadata at sign-up, or let them set it later.
2. The app calls the `local-news` Edge Function with the user's session token.
3. The function reads the profile ZIP (or `?zip=12345`), looks it up in `zip_zcta` to get city, state and ZCTA, and returns up to 30 headlines for that city plus up to 5 **nearby places** saved on the profile. People pick those from a dropdown of the 15 cities closest to their ZIP (the `nearby_cities` database function, which measures miles between Census 2020 ZCTA centroids in `zcta_centroids`). Places are saved as "City, ST".
4. The home city uses NewsData.io and the Google News search feed; nearby places use Google News only (no credits). Each place gets a fair share of the list, Google headlines must name the place and the search requires the state name. Results are cached per place for 3 hours in `local_news_cache`. Only headlines, short summaries and links are returned.

## Setup

- Add the secret `NEWSDATA_API_KEY` in Supabase: **Edge Functions → Secrets**. Optional: `NEWS_CACHE_HOURS`.
- The function only answers browsers on `https://randhawa.vip`, `https://www.randhawa.vip` and `http://localhost`. Change `ALLOWED_ORIGINS` in the function if the site lives elsewhere, then redeploy.

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
4. **Settings → Domains & Routes → Add → Custom domain** → `randhawa.vip`.
5. Supabase (zip-zcta) → **Authentication → URL Configuration**: Site URL `https://randhawa.vip`, Redirect URL `https://randhawa.vip/**`.

### Private: only your IP (Cloudflare)

- Website: `src/worker.js` lets in only the IPs in the Worker variable `ALLOWED_IPS`. Covers randhawa.vip and the *.workers.dev address.
- Optional extra layer: Cloudflare **Security → Security rules → Create rule → Custom rules**, block when `not ip.src in {YOUR.IP}`.
- News function: Supabase secret `ALLOWED_IPS` (same format, addresses or ranges). Unset = open to everyone.

To use the randhawa.vip domain later: add it under Settings → Pages → Custom domain, point the DNS records GitHub shows, then update the Site URL in Supabase.

## Files

- `public/`: the website (`index.html`, `assets/`)
- `src/worker.js`, `wrangler.jsonc`: Cloudflare Worker that serves the site behind the IP gate
- `supabase/schema.sql`: tables, security rules and sign-up trigger (already applied)
- `supabase/functions/local-news/index.ts`: the Edge Function (already deployed)

ZIP data: UDS Mapper ZIP Code to ZCTA Crosswalk 2022 (HRSA), 2020 Census ZCTAs.
