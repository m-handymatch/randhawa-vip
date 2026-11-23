// A member's page: <slug>.localconnect.site (read-only; posting happens on localconnect.site).
(function () {
  var db = window.supabase.createClient('https://pipzvzxcfvsxyiwmqpyv.supabase.co', 'sb_publishable_lt-qIsIQf8oXzk-P6b4mAQ_2BwK15ZN');
  var $ = function (id) { return document.getElementById(id); };
  var CATEGORIES = { 'general': 'General', 'recommendations': 'Recommendations', 'for-sale': 'For sale & free',
    'lost-found': 'Lost & found', 'safety': 'Safety', 'events': 'Events' };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function when(iso) {
    var t = Date.parse(iso); if (isNaN(t)) return '';
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 60) return mins < 1 ? 'just now' : mins + ' min ago';
    var h = Math.round(mins / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function getJSON(u) { return fetch(u, { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  // Slug from the address (singh.localconnect.site -> singh). ?u=singh works for previews.
  var host = location.hostname.toLowerCase();
  var m = host.match(/^([a-z0-9-]+)\.(localconnect\.site|randhawa\.vip)$/);
  var BASE = m ? m[2] : 'localconnect.site';
  if (BASE !== 'localconnect.site') {
    document.querySelectorAll('a[href^="https://localconnect.site"]').forEach(function (a) {
      a.href = a.href.replace('https://localconnect.site', 'https://' + BASE);
    });
    // Visible text too ("Join localconnect.site" -> "Join randhawa.vip").
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (var node; (node = walker.nextNode());) {
      if (node.nodeValue.indexOf('localconnect.site') !== -1) node.nodeValue = node.nodeValue.split('localconnect.site').join(BASE);
    }
    document.title = document.title.split('localconnect.site').join(BASE);
  }
  var slug = (m && m[1] !== 'www') ? m[1] : (new URLSearchParams(location.search).get('u') || '').toLowerCase();

  function missing() {
    $('mp-title').textContent = slug ? slug + '.' + BASE : BASE;
    $('mp-address').textContent = '';
    $('mp-missing').hidden = false;
    document.title = 'Not found · ' + BASE;
  }

  if (!/^[a-z0-9-]{3,30}$/.test(slug)) { missing(); return; }

  db.from('member_sites').select('slug, title, about, city, state, zip, created_at').eq('slug', slug).maybeSingle().then(function (r) {
    var site = r.data;
    if (!site) { missing(); return; }
    document.title = site.title + ' · ' + BASE;
    $('mp-address').textContent = site.slug + '.' + BASE;
    $('mp-title').textContent = site.title;
    $('mp-where').textContent = site.city ? 'Neighbor in ' + site.city + ', ' + site.state : 'Neighbor on ' + BASE;
    $('mp-about').textContent = site.about || ('Hi! I’m ' + site.title + (site.city ? ', a neighbor in ' + site.city : '') + '. Say hello on ' + BASE + '.');
    $('mp-since').textContent = 'Member since ' + new Date(site.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    $('mp-content').hidden = false;
    loadPosts(site);
    if (site.zip) loadWeather(site);
  }).catch(missing);

  function loadPosts(site) {
    db.from('posts').select('id, category, title, body, created_at, edited_at').eq('site_slug', site.slug)
      .order('created_at', { ascending: false }).limit(50).then(function (r) {
        var rows = r.data || [];
        if (!rows.length) { $('mp-empty').hidden = false; return; }
        rows.forEach(function (p) {
          var li = el('li', 'post');
          var top = el('div', 'post-top');
          top.appendChild(el('span', 'cat cat-' + p.category, CATEGORIES[p.category] || 'General'));
          top.appendChild(el('span', 'post-meta', when(p.created_at) + (p.edited_at ? ' · edited' : '')));
          li.appendChild(top);
          li.appendChild(el('h3', 'post-title', p.title));
          li.appendChild(el('p', 'post-body', p.body));
          var actions = el('div', 'post-actions');
          var rb = el('button', 'act', 'Replies'); rb.type = 'button';
          var join = el('a', 'act', 'Reply on localconnect.site'); join.href = 'https://' + BASE + '/#forum';
          actions.append(rb, join);
          li.appendChild(actions);
          var thread = el('ul', 'replies'); thread.hidden = true; li.appendChild(thread);
          rb.addEventListener('click', function () {
            thread.hidden = !thread.hidden;
            if (thread.dataset.loaded) return;
            thread.dataset.loaded = '1';
            db.from('replies').select('author_name, author_slug, body, created_at').eq('post_id', p.id).order('created_at').then(function (res) {
              var reps = res.data || [];
              if (!reps.length) { thread.appendChild(el('li', 'muted small', 'No replies yet.')); return; }
              reps.forEach(function (rep) {
                var r2 = el('li', 'reply');
                var meta = el('div', 'post-meta');
                if (rep.author_slug) { var a = el('a', 'author', rep.author_name); a.href = 'https://' + rep.author_slug + '.' + BASE + '/'; meta.appendChild(a); }
                else meta.appendChild(el('span', 'author', rep.author_name));
                meta.append(' · ' + when(rep.created_at));
                r2.append(meta, el('p', 'reply-body', rep.body));
                thread.appendChild(r2);
              });
            });
          });
          $('mp-feed').appendChild(li);
        });
      });
  }

  function loadWeather(site) {
    db.from('zip_zcta').select('zcta').eq('zip', site.zip).maybeSingle().then(function (r) {
      if (!r.data) return null;
      return db.from('zcta_centroids').select('lat, lon').eq('zcta', r.data.zcta).maybeSingle();
    }).then(function (r) {
      if (!r || !r.data) return null;
      return getJSON('https://api.weather.gov/points/' + Number(r.data.lat).toFixed(4) + ',' + Number(r.data.lon).toFixed(4));
    }).then(function (p) {
      return p ? getJSON(p.properties.forecast) : null;
    }).then(function (f) {
      var ps = f && f.properties && f.properties.periods;
      if (!ps || !ps.length) return;
      $('mp-weather-city').textContent = site.city;
      $('mp-wx').textContent = ps[0].temperature + '° ' + ps[0].shortForecast + (ps[1] ? ' · ' + ps[1].name + ' ' + ps[1].temperature + '°' : '');
      $('mp-weather').hidden = false;
    }).catch(function () {});
  }
})();
