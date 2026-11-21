# randhawa.vip

Connecting neighbors. The first feature: local news for signed-in users, matched to the ZIP code on their profile.

Runs on the Supabase project **zip-zcta** (`pipzvzxcfvsxyiwmqpyv`, region us-west-1).

## How it works

1. A user signs up with Supabase Auth. A profile is created automatically; pass `zip` (and optionally `display_name`) as user metadata at sign-up, or let them set it later.
2. The app calls the `local-news` Edge Function with the user's session token.
3. The function reads the profile ZIP (or `?zip=12345`), looks it up in `zip_zcta` to get city, state and ZCTA, and returns news for that city.
4. News comes from NewsData.io and is cached per city for 3 hours in `local_news_cache`. Only headlines, short summaries and links are returned.

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

## Files

- `supabase/schema.sql`: tables, security rules and sign-up trigger (already applied)
- `supabase/functions/local-news/index.ts`: the Edge Function (already deployed)

ZIP data: UDS Mapper ZIP Code to ZCTA Crosswalk 2022 (HRSA), 2020 Census ZCTAs.
