// randhawa.vip front end
(function () {
  var SUPABASE_URL = 'https://pipzvzxcfvsxyiwmqpyv.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_lt-qIsIQf8oXzk-P6b4mAQ_2BwK15ZN'; // public, read-only key
  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var $ = function (id) { return document.getElementById(id); };
  var state = { user: null, profile: null, places: [] };

  // ---------- The street ----------
  var HOUSES = [
    { w: 120, h: 96,  body: '#FF7A9A', roof: '#1D2B4F' },
    { w: 104, h: 130, body: '#FFC233', roof: '#23A866' },
    { w: 132, h: 104, body: '#7CC6FF', roof: '#FF7A9A' },
    { w: 150, h: 128, body: '#FFFFFF', roof: '#FFC233', home: true },
    { w: 112, h: 112, body: '#23A866', roof: '#1D2B4F' },
    { w: 128, h: 92,  body: '#FFB3C4', roof: '#7CC6FF' },
    { w: 104, h: 124, body: '#FFE08A', roof: '#FF7A9A' }
  ];
  var INK = '#1D2B4F';

  function house(x, base, hs) {
    var top = base - hs.h, roofH = Math.round(hs.w * 0.42);
    var midX = x + hs.w / 2;
    var winW = 22, winH = 24, winY = top + 18;
    var parts = [];
    parts.push('<g' + (hs.home ? ' class="my-house"' : '') + '>');
    parts.push('<path d="M' + (x - 8) + ' ' + top + ' L' + midX + ' ' + (top - roofH) + ' L' + (x + hs.w + 8) + ' ' + top + ' Z" fill="' + hs.roof + '" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/>');
    parts.push('<rect x="' + x + '" y="' + top + '" width="' + hs.w + '" height="' + hs.h + '" fill="' + hs.body + '" stroke="' + INK + '" stroke-width="4"/>');
    parts.push('<rect class="win" x="' + (x + 16) + '" y="' + winY + '" width="' + winW + '" height="' + winH + '" rx="4" fill="#CFE7FF" stroke="' + INK + '" stroke-width="3"/>');
    parts.push('<rect class="win" x="' + (x + hs.w - 16 - winW) + '" y="' + winY + '" width="' + winW + '" height="' + winH + '" rx="4" fill="#CFE7FF" stroke="' + INK + '" stroke-width="3"/>');
    parts.push('<rect x="' + (midX - 14) + '" y="' + (base - 46) + '" width="28" height="46" rx="5" fill="' + (hs.home ? '#FF7A9A' : INK) + '" stroke="' + INK + '" stroke-width="3"/>');
    if (hs.home) {
      // mailbox with the ZIP
      var mx = x + hs.w + 22;
      parts.push('<line x1="' + (mx + 22) + '" y1="' + (base - 34) + '" x2="' + (mx + 22) + '" y2="' + base + '" stroke="' + INK + '" stroke-width="4"/>');
      parts.push('<rect x="' + mx + '" y="' + (base - 60) + '" width="64" height="28" rx="10" fill="#2D6CDF" stroke="' + INK + '" stroke-width="3"/>');
      parts.push('<text class="mailbox-zip" x="' + (mx + 32) + '" y="' + (base - 40) + '" text-anchor="middle" font-size="15" fill="#FFFFFF"></text>');
    }
    parts.push('</g>');
    return parts.join('');
  }

  function streetSvg() {
    var gap = 34, x = 24, base = 210, out = [];
    // a few clouds and a sun, quiet
    out.push('<circle cx="1040" cy="52" r="26" fill="#FFC233" stroke="' + INK + '" stroke-width="3"/>');
    out.push('<path d="M120 60a18 18 0 0 1 34-6 14 14 0 0 1 22 12H112a10 10 0 0 1 8-6z" fill="#FFFFFF" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>');
    out.push('<path d="M620 44a18 18 0 0 1 34-6 14 14 0 0 1 22 12H612a10 10 0 0 1 8-6z" fill="#FFFFFF" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>');
    HOUSES.forEach(function (hs) {
      out.push(house(x, base, hs));
      x += hs.w + gap + (hs.home ? 92 : 0);
    });
    var width = x - gap + 24;
    out[0] = out[0].replace('cx="1040" cy="52"', 'cx="' + Math.round(width * 0.45) + '" cy="40"');
    return '<svg class="street" viewBox="0 0 ' + width + ' 212" role="img" aria-label="A row of colorful houses on a sunny street" preserveAspectRatio="xMidYMax meet">' + out.join('') + '</svg>';
  }

  document.querySelectorAll('[data-street]').forEach(function (el) { el.innerHTML = streetSvg(); });

  function setStreetZip(zip) {
    document.querySelectorAll('.street').forEach(function (svg) {
      var t = svg.querySelector('.mailbox-zip');
      if (t) t.textContent = zip || '';
      svg.classList.toggle('lit', !!zip);
    });
  }

  // ---------- Helpers ----------
  function show(el, on) { el.hidden = !on; }
  function message(el, text, kind) {
    el.textContent = text; el.className = 'message ' + (kind || 'ok'); el.hidden = !text;
  }
  function validZip(z) { return /^[0-9]{5}$/.test(z); }

  var zipCache = {};
  function lookupZip(zip) {
    if (zipCache[zip]) return Promise.resolve(zipCache[zip]);
    return db.from('zip_zcta').select('zip, city, state, zcta').eq('zip', zip).maybeSingle()
      .then(function (r) { if (r.data) zipCache[zip] = r.data; return r.data; });
  }

  function titleCase(s) { return (s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }

  function timeAgo(iso) {
    if (!iso) return '';
    var t = Date.parse(iso.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
    if (isNaN(t)) return '';
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  function wireZipHint(input, hint) {
    input.addEventListener('input', function () {
      input.value = input.value.replace(/\D/g, '').slice(0, 5);
      hint.className = 'hint';
      if (input.value.length < 5) { hint.textContent = ''; return; }
      hint.textContent = 'Looking that up…';
      var asked = input.value;
      lookupZip(asked).then(function (p) {
        if (input.value !== asked) return;
        if (p) { hint.textContent = titleCase(p.city) + ', ' + p.state; hint.className = 'hint ok'; }
        else { hint.textContent = 'We don’t recognize that ZIP code.'; hint.className = 'hint bad'; }
      }).catch(function () { hint.textContent = ''; });
    });
  }

  // ---------- Sign up / sign in ----------
  document.querySelectorAll('[data-show]').forEach(function (b) {
    b.addEventListener('click', function () {
      var which = b.getAttribute('data-show');
      show($('signup-panel'), which === 'signup');
      show($('signin-panel'), which === 'signin');
      var first = $(which + '-panel').querySelector('input');
      if (first) first.focus();
    });
  });

  wireZipHint($('signup-form').zip, $('signup-zip-hint'));

  $('signup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('signup-message'), btn = f.querySelector('button');
    var name = f.name.value.trim(), zip = f.zip.value.trim(), email = f.email.value.trim(), pw = f.password.value;
    if (!name) return message(msg, 'Add your first name.', 'bad');
    if (!validZip(zip)) return message(msg, 'Enter your 5-digit ZIP code.', 'bad');
    if (!/^\S+@\S+\.\S+$/.test(email)) return message(msg, 'Enter a valid email address.', 'bad');
    if (pw.length < 8) return message(msg, 'Use a password with at least 8 characters.', 'bad');
    btn.disabled = true; message(msg, '');
    lookupZip(zip).then(function (p) {
      if (!p) throw new Error('We don’t recognize ZIP code ' + zip + '. Check it and try again.');
      return db.auth.signUp({
        email: email, password: pw,
        options: { data: { zip: zip, display_name: name }, emailRedirectTo: location.href.split('#')[0] }
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data.session) {
        message(msg, 'Almost there. We sent a link to ' + email + '. Open it to confirm your email, then sign in.', 'ok');
        f.reset(); $('signup-zip-hint').textContent = '';
      }
    }).catch(function (err) {
      message(msg, (err && err.message) || 'Something went wrong. Try again.', 'bad');
    }).finally(function () { btn.disabled = false; });
  });

  $('signin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('signin-message'), btn = f.querySelector('button');
    btn.disabled = true; message(msg, '');
    db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value })
      .then(function (r) {
        if (r.error) {
          var text = /confirm/i.test(r.error.message) ? 'Confirm your email first: open the link we sent you.' : 'That email and password don’t match. Try again.';
          message(msg, text, 'bad');
        }
      })
      .finally(function () { btn.disabled = false; });
  });

  $('signout').addEventListener('click', function () { db.auth.signOut(); });

  // ---------- Signed-in home ----------
  function renderPlace() {
    var p = state.profile || {};
    $('greeting').textContent = p.display_name ? 'Hi, ' + p.display_name : 'Hi, neighbor';
    $('who').textContent = state.user ? state.user.email : '';
    if (!p.zip) {
      $('place').textContent = 'Add your ZIP code to see what’s happening nearby.';
      setStreetZip('');
      return Promise.resolve();
    }
    setStreetZip(p.zip);
    return lookupZip(p.zip).then(function (place) {
      $('place').innerHTML = '';
      var strong = document.createElement('strong');
      strong.textContent = place ? titleCase(place.city) + ', ' + place.state : 'ZIP ' + p.zip;
      $('place').append('Your neighborhood: ', strong, place ? ' (' + p.zip + ')' : '');
      $('news-title').textContent = place ? 'Around ' + titleCase(place.city) : 'Around the neighborhood';
      renderAbout(place);
    });
  }

  // ---------- About your city (Wikipedia, Wikimedia Commons, Wikidata, OpenStreetMap) ----------
  var STATE_NAMES = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico',GU:'Guam',VI:'U.S. Virgin Islands',AS:'American Samoa',MP:'Northern Mariana Islands'};
  var aboutToken = 0;

  function getJSON(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function qs(params) {
    return Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  }
  function plainText(html) {
    var d = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : null; }
  function link(href, text) {
    var a = document.createElement('a'); a.href = href; a.textContent = text; a.target = '_blank'; a.rel = 'noopener'; return a;
  }

  function wikiCity(city, st) {
    var stateName = STATE_NAMES[st];
    var titles = stateName ? [city + ', ' + stateName, city] : [city];
    function tryTitle(i) {
      if (i >= titles.length) return Promise.resolve(null);
      return getJSON('https://en.wikipedia.org/w/api.php?' + qs({
        action: 'query', format: 'json', formatversion: 2, origin: '*', redirects: 1, titles: titles[i],
        prop: 'extracts|pageimages|pageprops|info', exintro: 1, explaintext: 1, exsentences: 2,
        piprop: 'name', pilicense: 'free', ppprop: 'wikibase_item|disambiguation', inprop: 'url'
      })).then(function (r) {
        var pg = r && r.query && r.query.pages && r.query.pages[0];
        var ok = pg && !pg.missing && !(pg.pageprops && 'disambiguation' in pg.pageprops) && pg.extract
          // a bare city name must still be about a place in this state
          && (i === 0 || !stateName || pg.extract.indexOf(stateName) !== -1);
        return ok ? pg : tryTitle(i + 1);
      });
    }
    return tryTitle(0);
  }

  // Only freely licensed Commons files, with the photographer and license we must show.
  function commonsPhoto(fileName) {
    if (!fileName) return Promise.resolve(null);
    return getJSON('https://commons.wikimedia.org/w/api.php?' + qs({
      action: 'query', format: 'json', formatversion: 2, origin: '*', titles: 'File:' + fileName,
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: 640
    })).then(function (r) {
      var pg = r && r.query && r.query.pages && r.query.pages[0];
      var info = pg && pg.imageinfo && pg.imageinfo[0];
      if (!info) return null;
      var m = info.extmetadata || {};
      var license = plainText(m.LicenseShortName && m.LicenseShortName.value);
      var free = /^(cc[ -]?by|cc0|public domain|pd\b|gfdl)/i.test(license) && !/\bnc\b|\bnd\b|non-?free|fair use/i.test(license);
      if (!free || !safeUrl(info.thumburl)) return null;
      return {
        src: info.thumburl, page: safeUrl(info.descriptionurl), license: license,
        licenseUrl: safeUrl(m.LicenseUrl && m.LicenseUrl.value),
        artist: plainText(m.Artist && m.Artist.value).slice(0, 80),
        alt: plainText(m.ImageDescription && m.ImageDescription.value).slice(0, 160)
      };
    }).catch(function () { return null; });
  }

  function officialSite(qid) {
    if (!qid) return Promise.resolve(null);
    return getJSON('https://www.wikidata.org/w/api.php?' + qs({ action: 'wbgetclaims', format: 'json', origin: '*', entity: qid, property: 'P856' }))
      .then(function (r) {
        var c = r && r.claims && r.claims.P856 && r.claims.P856[0];
        return safeUrl(c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value);
      }).catch(function () { return null; });
  }

  function centroid(zcta) {
    if (!zcta) return Promise.resolve(null);
    return db.from('zcta_centroids').select('lat, lon').eq('zcta', zcta).maybeSingle()
      .then(function (r) { return r.data; }).catch(function () { return null; });
  }

  function renderAbout(place) {
    var token = ++aboutToken;
    var card = document.querySelector('.about-card');
    if (!place) { $('about').hidden = true; return; }
    var city = titleCase(place.city);
    $('about-title').textContent = 'About ' + city;

    centroid(place.zcta).then(function (c) {
      if (token !== aboutToken) return;
      if (!c) { $('about-map').hidden = true; card.classList.add('no-map'); return; }
      var d = 0.035, lat = Number(c.lat), lon = Number(c.lon);
      var bbox = [lon - d * 1.4, lat - d, lon + d * 1.4, lat + d].map(function (n) { return n.toFixed(5); }).join(',');
      $('about-map-frame').src = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + lat.toFixed(5) + ',' + lon.toFixed(5);
      $('about-map-open').href = $('about-map-link').href = 'https://www.openstreetmap.org/?mlat=' + lat.toFixed(5) + '&mlon=' + lon.toFixed(5) + '#map=13/' + lat.toFixed(5) + '/' + lon.toFixed(5);
      $('about-map').hidden = false; card.classList.remove('no-map');
      $('about').hidden = false;
    });

    wikiCity(city, place.state).then(function (pg) {
      if (token !== aboutToken) return;
      if (!pg) {
        $('about-extract').textContent = '';
        $('about-links').innerHTML = '';
        $('about-text-credit').hidden = true;
        $('about-photo').hidden = true; card.classList.add('no-photo');
        return;
      }
      $('about').hidden = false;
      $('about-extract').textContent = pg.extract.replace(/\s*\([^()]*\)/, '').replace(/\s+/g, ' ').trim();
      var wikiUrl = safeUrl(pg.fullurl) || 'https://en.wikipedia.org/wiki/' + encodeURIComponent(pg.title.replace(/ /g, '_'));
      $('about-wiki-credit').href = wikiUrl;
      $('about-text-credit').hidden = false;
      var links = $('about-links'); links.innerHTML = '';
      links.appendChild(link(wikiUrl, 'Read more on Wikipedia'));
      return Promise.all([commonsPhoto(pg.pageimage), officialSite(pg.pageprops && pg.pageprops.wikibase_item)]).then(function (res) {
        if (token !== aboutToken) return;
        var photo = res[0], site = res[1];
        if (site) {
          var host = site.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '');
          links.appendChild(link(site, 'City website (' + host + ')'));
        }
        if (!photo) { $('about-photo').hidden = true; card.classList.add('no-photo'); return; }
        var img = $('about-img');
        img.src = photo.src; img.alt = photo.alt || 'Photo of ' + city;
        var cap = $('about-credit'); cap.innerHTML = '';
        cap.append('Photo: ');
        cap.appendChild(photo.page ? link(photo.page, photo.artist || 'Wikimedia Commons') : document.createTextNode(photo.artist || 'Wikimedia Commons'));
        cap.append(', ');
        cap.appendChild(photo.licenseUrl ? link(photo.licenseUrl, photo.license) : document.createTextNode(photo.license));
        $('about-photo').hidden = false; card.classList.remove('no-photo');
      });
    }).catch(function () { /* the card just shows what loaded */ });
  }

  function renderStories(articles) {
    var list = $('stories');
    list.innerHTML = '';
    articles.forEach(function (a) {
      var li = document.createElement('li');
      li.className = 'story' + (a.image ? '' : ' no-image');
      var text = document.createElement('div');
      if (a.place && state.places.length > 1) {
        var tag = document.createElement('span');
        tag.className = 'tag' + (a.place === state.places[0] ? ' home' : '');
        tag.textContent = a.place;
        text.appendChild(tag);
      }
      var h3 = document.createElement('h3');
      var link = document.createElement('a');
      link.href = a.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = a.title;
      h3.appendChild(link);
      var from = document.createElement('p');
      from.className = 'from';
      var when = timeAgo(a.published);
      from.textContent = [a.source, when].filter(Boolean).join(', ');
      text.append(h3, from);
      if (a.summary) {
        var s = document.createElement('p'); s.className = 'summary'; s.textContent = a.summary; text.appendChild(s);
      }
      li.appendChild(text);
      if (a.image && /^https:\/\//.test(a.image)) {
        var img = document.createElement('img');
        img.src = a.image; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', function () { img.remove(); li.classList.add('no-image'); });
        li.appendChild(img);
      }
      list.appendChild(li);
    });
  }

  function emptyState(lines) {
    var box = $('news-empty');
    box.innerHTML = '';
    lines.forEach(function (t) { var p = document.createElement('p'); p.textContent = t; box.appendChild(p); });
    box.hidden = false;
  }

  function loadNews() {
    $('stories').innerHTML = ''; $('news-empty').hidden = true; $('news-loading').hidden = false;
    if (!state.profile || !state.profile.zip) {
      $('news-loading').hidden = true;
      emptyState(['Add your ZIP code above and we’ll show news from your neighborhood.']);
      return;
    }
    db.functions.invoke('local-news', { method: 'GET' }).then(function (r) {
      $('news-loading').hidden = true;
      if (r.error) {
        emptyState(['We couldn’t load local news right now.', 'Try again in a few minutes.']);
        return;
      }
      var articles = (r.data && r.data.articles) || [];
      state.places = (r.data && r.data.places) || [];
      $('news-note').textContent = (state.places.length > 1
        ? 'Headlines about ' + listJoin(state.places) + '.'
        : 'Headlines from local and regional news.') + ' Tap one to read it on the publisher\u2019s site.';
      if (!articles.length) {
        emptyState(['No local headlines yet for your area.', 'Smaller towns get fewer stories. Check back later today.']);
        return;
      }
      renderStories(articles);
    });
  }

  function loadProfile() {
    return db.from('profiles').select('display_name, zip, nearby_places').eq('id', state.user.id).maybeSingle()
      .then(function (r) {
        state.profile = r.data || { display_name: null, zip: null, nearby_places: [] };
        state.profile.nearby_places = state.profile.nearby_places || [];
      });
  }

  wireZipHint($('zip-form').zip, $('zip-change-hint'));

  $('zip-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, zip = f.zip.value.trim(), hint = $('zip-change-hint'), btn = f.querySelector('button');
    if (!validZip(zip)) { hint.textContent = 'Enter a 5-digit ZIP code.'; hint.className = 'hint bad'; return; }
    btn.disabled = true;
    var moved = zip !== state.profile.zip;
    lookupZip(zip).then(function (p) {
      if (!p) throw new Error('We don’t recognize that ZIP code.');
      // A new ZIP means a new set of neighbors: clear the old nearby cities.
      var changes = moved ? { zip: zip, nearby_places: [] } : { zip: zip };
      return db.from('profiles').update(changes).eq('id', state.user.id);
    }).then(function (r) {
      if (r.error) throw r.error;
      state.profile.zip = zip;
      if (moved) state.profile.nearby_places = [];
      f.reset(); hint.textContent = 'Updated.'; hint.className = 'hint ok';
      if (moved) { $('places-hint').textContent = 'Pick up to 5 cities near your new ZIP.'; $('places-hint').className = 'hint'; }
      return renderPlace().then(function () {
        loadNews();
        return loadNearbyOptions().then(function () {
          if (!moved) return;
          var picker = $('places-picker');
          picker.open = true;
          picker.querySelector('summary').focus({ preventScroll: true });
          picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      });
    }).catch(function (err) {
      hint.textContent = (err && err.message) || 'Couldn’t update your ZIP. Try again.'; hint.className = 'hint bad';
    }).finally(function () { btn.disabled = false; });
  });

  function listJoin(items) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // ---------- Nearby cities picker ----------
  var MAX_PLACES = 5;
  var homeState = '';

  // Saved values are "City, ST"; older ones may be a bare name (home state).
  function placeKey(value) {
    var m = String(value).match(/^(.*\S),\s*([A-Z]{2})$/);
    return (m ? m[1] + ', ' + m[2] : value + ', ' + homeState).toLowerCase();
  }

  function updatePickerSummary() {
    var boxes = Array.prototype.slice.call(document.querySelectorAll('#places-options input'));
    var chosen = boxes.filter(function (b) { return b.checked; });
    boxes.forEach(function (b) { if (!b.checked) b.disabled = chosen.length >= MAX_PLACES; });
    $('places-summary').textContent = chosen.length
      ? chosen.map(function (b) { return b.getAttribute('data-name'); }).join(', ')
      : 'Choose up to ' + MAX_PLACES;
  }

  function renderPicker(options) {
    var box = $('places-options');
    box.innerHTML = '';
    var saved = (state.profile.nearby_places || []);
    var savedKeys = saved.map(placeKey);
    var seen = {};
    // Saved places that aren't among the nearest still show (and stay ticked).
    var all = options.map(function (o) { return { value: o.city + ', ' + o.state, name: o.city, miles: o.miles }; });
    saved.forEach(function (v) {
      if (!all.some(function (o) { return placeKey(o.value) === placeKey(v); })) {
        all.unshift({ value: v, name: String(v).replace(/,\s*[A-Z]{2}$/, ''), miles: null });
      }
    });
    if (!all.length) {
      box.innerHTML = '<p class="hint">No nearby cities found for this ZIP.</p>';
      updatePickerSummary();
      return;
    }
    all.forEach(function (o) {
      var key = placeKey(o.value);
      if (seen[key]) return; seen[key] = true;
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox'; input.value = o.value; input.setAttribute('data-name', o.name);
      input.checked = savedKeys.indexOf(key) !== -1;
      input.addEventListener('change', updatePickerSummary);
      var name = document.createElement('span');
      var stateSuffix = /,\s*([A-Z]{2})$/.exec(o.value);
      name.textContent = o.name + (stateSuffix && stateSuffix[1] !== homeState ? ', ' + stateSuffix[1] : '');
      label.append(input, name);
      if (o.miles != null) {
        var mi = document.createElement('span'); mi.className = 'miles'; mi.textContent = o.miles + ' mi';
        label.appendChild(mi);
      }
      box.appendChild(label);
    });
    updatePickerSummary();
  }

  function loadNearbyOptions() {
    var zip = state.profile && state.profile.zip;
    if (!zip) { $('places-options').innerHTML = '<p class="hint">Add your ZIP code first.</p>'; return Promise.resolve(); }
    return lookupZip(zip).then(function (p) {
      homeState = p ? p.state : '';
      return db.rpc('nearby_cities', { p_zip: zip, p_limit: 15 });
    }).then(function (r) {
      renderPicker((r && r.data) || []);
    }).catch(function () {
      $('places-options').innerHTML = '<p class="hint bad">Couldn\u2019t load nearby cities.</p>';
    });
  }

  $('places-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var hint = $('places-hint'), btn = e.target.querySelector('button[type=submit]');
    var places = Array.prototype.slice.call(document.querySelectorAll('#places-options input:checked'))
      .map(function (b) { return b.value; }).slice(0, MAX_PLACES);
    btn.disabled = true;
    db.from('profiles').update({ nearby_places: places }).eq('id', state.user.id).then(function (r) {
      if (r.error) throw r.error;
      state.profile.nearby_places = places;
      $('places-picker').open = false;
      hint.textContent = places.length ? 'Saved. Adding their news\u2026' : 'Saved.';
      hint.className = 'hint ok';
      loadNews();
    }).catch(function () {
      hint.textContent = 'Couldn\u2019t save. Try again.'; hint.className = 'hint bad';
    }).finally(function () { btn.disabled = false; });
  });

  // Close the picker when clicking elsewhere or pressing Escape.
  document.addEventListener('click', function (e) {
    var picker = $('places-picker');
    if (picker.open && !picker.contains(e.target)) picker.open = false;
  });
  document.addEventListener('keydown', function (e) {
    var picker = $('places-picker');
    if (e.key === 'Escape' && picker.open) { picker.open = false; picker.querySelector('summary').focus(); }
  });

  // ---------- Which screen ----------
  function render(session) {
    $('booting').hidden = true;
    state.user = session ? session.user : null;
    show($('welcome'), !state.user);
    show($('dashboard'), !!state.user);
    show($('who'), !!state.user);
    show($('signout'), !!state.user);
    if (!state.user) { state.profile = null; setStreetZip(''); return; }
    loadProfile().then(renderPlace).then(function () { loadNews(); loadNearbyOptions(); });
  }

  var lastUserId;
  db.auth.onAuthStateChange(function (_event, session) {
    var id = session ? session.user.id : null;
    if (id === lastUserId && _event !== 'INITIAL_SESSION') return;
    lastUserId = id;
    render(session);
  });
})();
