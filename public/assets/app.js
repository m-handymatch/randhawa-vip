// localconnect.site front end
(function () {
  var SUPABASE_URL = 'https://pipzvzxcfvsxyiwmqpyv.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_lt-qIsIQf8oXzk-P6b4mAQ_2BwK15ZN'; // public, read-only key
  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var $ = function (id) { return document.getElementById(id); };
  var state = { user: null, profile: null, places: [] };
  // Shared with forum.js (the forum and personal pages).
  window.RV = { db: db, state: state };

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
      document.querySelectorAll('.auth-tab').forEach(function (t) {
        var on = t.getAttribute('data-show') === which;
        t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on));
      });
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
    if (f.rules && !f.rules.checked) return message(msg, 'Please agree to the house rules to join.', 'bad');
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
      var zipSpan = document.createElement('span'); zipSpan.className = 'place-zip';
      zipSpan.textContent = place ? '(' + p.zip + ')' : '';
      $('place').append('Your neighborhood: ', strong, ' ', zipSpan);
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
        prop: 'extracts|pageimages|pageprops|info|images', explaintext: 1, exsectionformat: 'plain', exsentences: 14,
        piprop: 'name', pilicense: 'free', ppprop: 'wikibase_item|disambiguation', inprop: 'url', imlimit: 60
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

  // Pick the nicest city photo from the article: wide views of the city itself
  // (aerial, skyline, downtown, landmarks) beat buildings, maps, seals and logos.
  var PHOTO_SKIP = /\.(svg|png|gif|tiff?)$|\b(map|maps|logo|flag|seal|icon|coat of arms|locator|location|usgs|diagram|chart|graph|signature|census|condemned|vacant|barracks|portrait|headshot)\b/i;
  var PHOTO_GOOD = /\b(skyline|aerial|from the air|overview|panorama|view|vista|downtown|main street|city hall|plaza|waterfront|harbou?r|beach|bay|hills?|sunset|blossoms?|park)\b/i;
  function photoScore(file, city, lead) {
    var name = file.replace(/^File:/, '').replace(/_/g, ' ');
    if (PHOTO_SKIP.test(name)) return -1;
    var n = name.toLowerCase(), score = 0;
    if (n.indexOf(city.toLowerCase()) !== -1) score += 2;
    if (PHOTO_GOOD.test(name)) score += 3;
    if (/street|avenue|square/i.test(name)) score += 1;
    if (lead && name === lead.replace(/_/g, ' ')) score += 1;
    return score;
  }
  function bestCityPhoto(pg, city) {
    var lead = pg.pageimage || '';
    var files = (pg.images || []).map(function (i) { return i.title; });
    if (lead && files.indexOf('File:' + lead.replace(/_/g, ' ')) === -1) files.push('File:' + lead.replace(/_/g, ' '));
    var ranked = files.map(function (f) { return { f: f, s: photoScore(f, city, lead) }; })
      .filter(function (x) { return x.s >= 0; })
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 8);
    if (!ranked.length) return commonsPhoto(lead);
    return getJSON('https://commons.wikimedia.org/w/api.php?' + qs({
      action: 'query', format: 'json', formatversion: 2, origin: '*',
      titles: ranked.map(function (x) { return x.f; }).join('|'),
      prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: 900
    })).then(function (r) {
      var pages = (r && r.query && r.query.pages) || [];
      var byTitle = {};
      pages.forEach(function (p) { byTitle[p.title] = p; });
      for (var i = 0; i < ranked.length; i++) {
        var p = byTitle[ranked[i].f.replace(/_/g, ' ')];
        var info = p && p.imageinfo && p.imageinfo[0];
        if (!info || !info.width || info.width < 800 || info.width < info.height * 1.2) continue; // wide, sharp photos only
        var photo = photoFromInfo(info);
        if (photo) return photo;
      }
      return commonsPhoto(lead);
    }).catch(function () { return commonsPhoto(lead); });
  }
  function photoFromInfo(info) {
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
  }

  // Only freely licensed Commons files, with the photographer and license we must show.
  function commonsPhoto(fileName) {
    if (!fileName) return Promise.resolve(null);
    return getJSON('https://commons.wikimedia.org/w/api.php?' + qs({
      action: 'query', format: 'json', formatversion: 2, origin: '*', titles: 'File:' + fileName,
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: 900
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

  // The city text fills the card: it wraps beside and under the photo, and is
  // cut at the last whole word that fits above the links row.
  var aboutFull = '';
  function fitExtract() {
    var el = $('about-extract'), body = $('about-body');
    if (!el || !body || !aboutFull) return;
    // Fits when the text ends above the bottom of the space (the photo may be taller).
    var fits = function () { return el.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 1; };
    el.textContent = aboutFull;
    if (fits()) return;
    var words = aboutFull.split(' '), lo = 0, hi = words.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      el.textContent = words.slice(0, mid).join(' ') + '\u2026';
      if (fits()) lo = mid; else hi = mid - 1;
    }
    el.textContent = words.slice(0, lo).join(' ').replace(/[,;:]$/, '') + '\u2026';
  }
  if (window.ResizeObserver) {
    new ResizeObserver(function () { fitExtract(); }).observe(document.querySelector('.about-card'));
  }
  window.addEventListener('resize', fitExtract);

  function renderAbout(place) {
    var token = ++aboutToken;
    var card = document.querySelector('.about-card');
    if (!place) { $('about').hidden = true; return; }
    var city = titleCase(place.city);
    $('about-title').textContent = 'About ' + city;

    centroid(place.zcta).then(function (c) {
      if (token !== aboutToken) return;
      $('about').hidden = false;
      if (!c) { $('alert-main').textContent = 'Unavailable'; return; }
      renderToday(Number(c.lat), Number(c.lon), token);
    });

    wikiCity(city, place.state).then(function (pg) {
      if (token !== aboutToken) return;
      if (!pg) {
        aboutFull = ''; $('about-extract').textContent = '';
        $('about-links').innerHTML = '';
        $('about-text-credit').hidden = true;
        $('about-photo').hidden = true; card.classList.add('no-photo');
        return;
      }
      $('about').hidden = false;
      // The intro plus the start of the article (history, geography...), with
      // section headings dropped, so short intros still fill the card.
      var text = pg.extract.split(/\n+/).filter(function (line) {
        line = line.trim();
        return line && /[.!?]["')\]]?$/.test(line);
      }).join(' ');
      aboutFull = text.replace(/\s*\([^()]*\)/, '').replace(/\s+/g, ' ').trim();
      fitExtract();
      var wikiUrl = safeUrl(pg.fullurl) || 'https://en.wikipedia.org/wiki/' + encodeURIComponent(pg.title.replace(/ /g, '_'));
      $('about-wiki-credit').href = wikiUrl;
      $('about-text-credit').hidden = false;
      var links = $('about-links'); links.innerHTML = '';
      links.appendChild(link(wikiUrl, 'More on Wikipedia'));
      return Promise.all([bestCityPhoto(pg, city), officialSite(pg.pageprops && pg.pageprops.wikibase_item)]).then(function (res) {
        if (token !== aboutToken) return;
        var photo = res[0], site = res[1];
        if (site) {
          var cityLink = link(site, 'City website');
          cityLink.title = site.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '');
          links.appendChild(cityLink);
        }
        renderCounty(pg.pageprops && pg.pageprops.wikibase_item, token);
        if (!photo) { $('about-photo').hidden = true; card.classList.add('no-photo'); fitExtract(); return; }
        var img = $('about-img');
        img.src = photo.src; img.alt = photo.alt || 'Photo of ' + city;
        var cap = $('about-credit'); cap.innerHTML = '';
        cap.append('Photo: ');
        cap.appendChild(photo.page ? link(photo.page, photo.artist || 'Wikimedia Commons') : document.createTextNode(photo.artist || 'Wikimedia Commons'));
        cap.append(', ');
        cap.appendChild(photo.licenseUrl ? link(photo.licenseUrl, photo.license) : document.createTextNode(photo.license));
        $('about-photo').hidden = false; card.classList.remove('no-photo');
        img.onload = fitExtract; fitExtract();
      });
    }).catch(function () { /* the card just shows what loaded */ });
  }

  // Obituaries and death notices are left out (the server filters them too).
  var OBITUARY = /obituar|\bobits?\b|in memoriam|passed away|death notice|funeral (home|service)|celebration of life|died peacefully|\blegacy\.com\b/i;
  function renderStories(articles) {
    var list = $('stories');
    list.innerHTML = '';
    articles = articles.filter(function (a) {
      return !OBITUARY.test([a.title, a.summary || '', a.source || '', a.link].join(' '));
    });
    articles.forEach(function (a) {
      var li = document.createElement('li');
      li.className = 'story' + (a.image ? '' : ' no-image');
      var text = document.createElement('div');
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

  // Last headlines for this ZIP + nearby cities: shown at once, then replaced
  // with fresh ones when they arrive (browser storage can be missing: ignore errors).
  function newsCacheKey() {
    var p = state.profile || {};
    return 'rv-news:' + p.zip + '|' + (p.nearby_places || []).join(';');
  }
  function showNews(places, articles) {
    state.places = places;
    $('news-note').textContent = places.length > 1 ? 'From ' + listJoin(places) + '.' : 'Headlines from local and regional news.';
    $('news-note').title = $('news-note').textContent;
    $('news-loading').hidden = true; $('news-empty').hidden = true;
    renderStories(articles);
  }
  var newsToken = 0;
  function loadNews() {
    var token = ++newsToken;
    $('stories').innerHTML = ''; $('news-empty').hidden = true; $('news-loading').hidden = false;
    if (!state.profile || !state.profile.zip) {
      $('news-loading').hidden = true;
      emptyState(['Add your ZIP code above and we\u2019ll show news from your neighborhood.']);
      return;
    }
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(newsCacheKey()) || 'null'); } catch (e) { cached = null; }
    var shownCached = !!(cached && cached.articles && cached.articles.length);
    if (shownCached) showNews(cached.places || [], cached.articles);
    db.functions.invoke('local-news', { method: 'GET' }).then(function (r) {
      if (token !== newsToken) return;
      $('news-loading').hidden = true;
      if (r.error) {
        if (!shownCached) emptyState(['We couldn\u2019t load local news right now.', 'Try again in a few minutes.']);
        return;
      }
      var articles = (r.data && r.data.articles) || [];
      var places = (r.data && r.data.places) || [];
      if (!articles.length) {
        if (shownCached) return;
        showNews(places, []);
        emptyState(['No local headlines yet for your area.', 'Smaller towns get fewer stories. Check back later today.']);
        return;
      }
      showNews(places, articles);
      try {
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf('rv-news:') === 0) localStorage.removeItem(k); });
        localStorage.setItem(newsCacheKey(), JSON.stringify({ at: Date.now(), places: places, articles: articles }));
      } catch (e) { /* storage full or blocked */ }
    });
  }

  // ---------- Upcoming events (left column) ----------
  var MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function eventsEmpty(lines) {
    var box = $('events-empty'); box.innerHTML = '';
    lines.forEach(function (t) { var p = document.createElement('p'); p.textContent = t; box.appendChild(p); });
    box.hidden = false;
  }

  function renderEvents(events) {
    var list = $('events'); list.innerHTML = '';
    events.forEach(function (ev) {
      var li = document.createElement('li'); li.className = 'event';
      var date = document.createElement('div'); date.className = 'event-date';
      var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(ev.start || '');
      if (m) {
        var mon = document.createElement('span'); mon.className = 'mon'; mon.textContent = MONTH_ABBR[Number(m[2]) - 1];
        var day = document.createElement('span'); day.className = 'day'; day.textContent = String(Number(m[3]));
        date.append(mon, day);
      } else {
        date.classList.add('tba'); date.textContent = 'Soon';
      }
      var body = document.createElement('div');
      var h3 = document.createElement('h3');
      if (ev.link) {
        var a = document.createElement('a'); a.href = ev.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ev.title;
        h3.appendChild(a);
      } else { h3.textContent = ev.title; }
      body.appendChild(h3);
      if (ev.when) { var w = document.createElement('p'); w.className = 'event-when'; w.textContent = ev.when; body.appendChild(w); }
      var where = [ev.venue, ev.place].filter(Boolean).join(', ');
      if (where) { var p = document.createElement('p'); p.className = 'event-where'; p.textContent = where; body.appendChild(p); }
      li.append(date, body);
      list.appendChild(li);
    });
  }


  // ---------- County basics (Wikidata) ----------
  function wdEntities(ids, props) {
    return getJSON('https://www.wikidata.org/w/api.php?' + qs({ action: 'wbgetentities', format: 'json', origin: '*', ids: ids.join('|'), props: props, languages: 'en' }))
      .then(function (r) { return (r && r.entities) || {}; });
  }
  function claimIds(ent, prop) {
    return ((ent && ent.claims && ent.claims[prop]) || []).map(function (c) {
      return c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id;
    }).filter(Boolean);
  }
  function claimString(ent, prop) {
    var c = ((ent && ent.claims && ent.claims[prop]) || [])[0];
    return c && c.mainsnak && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : null;
  }
  function renderCounty(cityQid, token) {
    var box = $('about-county'); box.hidden = true; box.innerHTML = '';
    if (!cityQid) return;
    wdEntities([cityQid], 'claims').then(function (ents) {
      var parents = claimIds(ents[cityQid], 'P131').slice(0, 5);
      return parents.length ? wdEntities(parents, 'labels|claims') : {};
    }).then(function (ents) {
      if (token !== aboutToken) return;
      var county = Object.keys(ents).map(function (k) { return ents[k]; }).filter(function (e) {
        var l = e.labels && e.labels.en && e.labels.en.value || '';
        return /\b(County|Parish|Borough)$/.test(l);
      })[0];
      if (!county) return;
      var name = county.labels.en.value;
      var site = safeUrl(claimString(county, 'P856'));
      var seatId = claimIds(county, 'P36')[0];
      return (seatId ? wdEntities([seatId], 'labels') : Promise.resolve({})).then(function (se) {
        if (token !== aboutToken) return;
        var seat = seatId && se[seatId] && se[seatId].labels && se[seatId].labels.en ? se[seatId].labels.en.value : null;
        // Joins the links row: "Marin County (seat: San Rafael)" and its website.
        var links = $('about-links');
        var c = document.createElement('span'); c.className = 'about-county-name';
        c.textContent = name + (seat ? ' (seat: ' + seat + ')' : '');
        links.appendChild(c);
        if (site) links.appendChild(link(site, 'County website'));
      });
    }).catch(function () {});
  }

  // ---------- Today: weather + alerts (NWS), air quality (Open-Meteo) ----------
  function aqiCategory(v) {
    if (v <= 50) return ['Good', '#23A866'];
    if (v <= 100) return ['Moderate', '#E8B90C'];
    if (v <= 150) return ['Unhealthy for sensitive groups', '#F0802A'];
    if (v <= 200) return ['Unhealthy', '#D93A3A'];
    if (v <= 300) return ['Very unhealthy', '#8F3F97'];
    return ['Hazardous', '#7E0023'];
  }
  function ago(ms) {
    var h = Math.round((Date.now() - ms) / 3600e3);
    if (h < 1) return 'less than an hour ago';
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }
  function untilText(iso) {
    var t = Date.parse(iso || ''); if (isNaN(t)) return '';
    return ' until ' + new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function renderToday(lat, lon, token) {
    var pt = lat.toFixed(4) + ',' + lon.toFixed(4);
    $('today').hidden = false;
    $('wx-tile').href = 'https://forecast.weather.gov/MapClick.php?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4);
    ['wx-main', 'aqi-main', 'alert-main'].forEach(function (id) { $(id).textContent = '…'; });
    ['wx-sub', 'aqi-sub', 'alert-sub'].forEach(function (id) { $(id).textContent = ''; });

    getJSON('https://api.weather.gov/points/' + pt).then(function (p) {
      return getJSON(p.properties.forecast);
    }).then(function (f) {
      if (token !== aboutToken) return;
      var ps = (f.properties && f.properties.periods) || [];
      if (!ps.length) throw new Error('no periods');
      $('wx-main').textContent = ps[0].temperature + '°' + (ps[0].temperatureUnit === 'C' ? 'C' : '') + ' ' + ps[0].shortForecast;
      $('wx-sub').textContent = ps[0].name + (ps[1] ? ' · ' + ps[1].name + ' ' + ps[1].temperature + '°' : '');
    }).catch(function () { if (token === aboutToken) $('wx-main').textContent = 'Forecast unavailable'; });

    var at = $('alert-tile'); at.href = $('wx-tile').href; at.className = 'tile alert-tile';
    getJSON('https://api.weather.gov/alerts/active?point=' + pt).then(function (r) {
      if (token !== aboutToken) return;
      var seen = {};
      var feats = (r.features || []).map(function (ft) { return ft.properties || {}; }).filter(function (pr) {
        var k = pr.event || ''; if (!k || seen[k]) return false; seen[k] = true; return true;
      });
      if (!feats.length) {
        at.classList.add('is-clear');
        $('alert-main').textContent = 'No active alerts';
        $('alert-sub').textContent = 'National Weather Service';
        at.title = '';
        return;
      }
      // Most serious first: warnings, then watches, then advisories and statements.
      function level(ev) { return /warning/i.test(ev) ? 'warning' : /watch/i.test(ev) ? 'watch' : 'advisory'; }
      var rank = { warning: 0, watch: 1, advisory: 2 };
      feats.sort(function (x, y) { return rank[level(x.event)] - rank[level(y.event)]; });
      at.classList.add('is-' + level(feats[0].event));
      $('alert-main').textContent = feats[0].event;
      var until = untilText(feats[0].ends || feats[0].expires).replace(/^ until /, 'Until ');
      $('alert-sub').textContent = [until, feats.length > 1 ? '+' + (feats.length - 1) + ' more' : ''].filter(Boolean).join(' · ');
      at.title = feats.map(function (pr) { return pr.event + untilText(pr.ends || pr.expires); }).join('\n');
    }).catch(function () { if (token === aboutToken) $('alert-main').textContent = 'Unavailable'; });

    getJSON('https://air-quality-api.open-meteo.com/v1/air-quality?' + qs({ latitude: lat.toFixed(3), longitude: lon.toFixed(3), current: 'us_aqi', timezone: 'auto' })).then(function (r) {
      if (token !== aboutToken) return;
      var v = r && r.current && r.current.us_aqi;
      if (typeof v !== 'number') throw new Error('no aqi');
      var cat = aqiCategory(v);
      $('aqi-main').textContent = 'AQI ' + Math.round(v);
      $('aqi-dot').style.background = cat[1];
      $('aqi-sub').textContent = cat[0];
    }).catch(function () { if (token === aboutToken) { $('aqi-main').textContent = 'Unavailable'; $('aqi-dot').style.background = 'transparent'; } });

  }

  // ---------- Home values (Zillow Research ZHVI, refreshed monthly into data/home-values/) ----------
  var hvCache = {};
  function homeValues(st) {
    if (!hvCache[st]) {
      hvCache[st] = fetch('data/home-values/' + encodeURIComponent(st) + '.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    return hvCache[st];
  }
  function money(v) {
    return v >= 1e6 ? '$' + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : '$' + Math.round(v / 1e3) + 'K';
  }
  function hvBadge(pair) {
    var span = document.createElement('span'); span.className = 'hv';
    var val = document.createElement('span'); val.className = 'hv-val'; val.textContent = money(pair[0]);
    span.appendChild(val);
    if (typeof pair[1] === 'number') {
      var chg = document.createElement('span');
      chg.className = 'hv-chg ' + (pair[1] >= 0 ? 'up' : 'down');
      chg.textContent = (pair[1] >= 0 ? '▲' : '▼') + Math.abs(pair[1]).toFixed(1) + '%';
      chg.title = 'Change over the last 12 months';
      span.appendChild(chg);
    }
    span.title = 'Typical home value (Zillow Home Value Index)';
    return span;
  }

  // ---------- Open houses: links to each site's own open-house search ----------
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function zipForCity(city, st) {
    return db.from('zip_zcta').select('zip').ilike('city', city).eq('state', st).eq('zip_type', 'ZIP Code Area')
      .order('zip').limit(1).then(function (r) { return r.data && r.data[0] ? r.data[0].zip : null; })
      .catch(function () { return null; });
  }

  function ohLink(href, text) {
    var a = document.createElement('a'); a.href = href; a.textContent = text; a.target = '_blank'; a.rel = 'noopener'; a.className = 'oh-link';
    return a;
  }

  // ---------- Garage & estate sales: links to each site's own listings ----------
  function renderSales(cities) {
    var list = $('sales-list'); list.innerHTML = '';
    var names = cities.map(function (c) { return c.city; });
    $('sales-note').textContent = names.length ? 'From ' + listJoin(names) + '.' : 'This week\u2019s sales on each site.';
    $('sales-note').title = $('sales-note').textContent;
    cities.forEach(function (c) {
      var li = document.createElement('li'); li.className = 'oh-row';
      var name = document.createElement('span'); name.className = 'oh-city'; name.textContent = c.city;
      var links = document.createElement('span'); links.className = 'oh-links';
      var cityPath = c.city.replace(/ /g, '-');
      links.appendChild(ohLink('https://www.estatesales.net/' + c.st + '/' + encodeURIComponent(cityPath) + (c.zip ? '/' + c.zip : ''), 'EstateSales.net'));
      links.appendChild(ohLink('https://estatesales.org/estate-sales/' + c.st.toLowerCase() + '/' + encodeURIComponent(slug(c.city)), 'EstateSales.org'));
      links.appendChild(ohLink('https://www.google.com/search?q=' + encodeURIComponent('garage sales this weekend ' + c.city + ', ' + c.st), 'Garage sales'));
      li.append(name, links);
      list.appendChild(li);
    });
  }

  // ---------- Farmers markets: USDA directory, in 1-degree tiles ----------
  var MARKET_MILES = 6, MARKETS_SHOWN = 1e9, marketsToken = 0, marketTiles = {};
  function marketTile(key) {
    if (!marketTiles[key]) {
      marketTiles[key] = fetch('data/farmers-markets/' + key + '.json')
        .then(function (r) { return r.ok ? r.json() : { markets: [] }; })
        .then(function (j) { return j.markets || []; })
        .catch(function () { return []; });
    }
    return marketTiles[key];
  }
  function miles(aLat, aLon, bLat, bLon) {
    var R = 3958.8, toR = Math.PI / 180;
    var dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function renderMarkets(cities) {
    var token = ++marketsToken, box = $('markets');
    box.hidden = true; $('markets-list').innerHTML = '';
    Promise.all(cities.map(function (c) {
      return centroid(c.zip).then(function (p) {
        return p ? { city: c.city, lat: Number(p.lat), lon: Number(p.lon) } : null;
      });
    })).then(function (pts) {
      pts = pts.filter(Boolean);
      var keys = {};
      var pad = MARKET_MILES / 69;
      pts.forEach(function (p) {
        [-pad, pad].forEach(function (dy) {
          [-pad, pad].forEach(function (dx) {
            keys[Math.floor(p.lat + dy) + '_' + Math.floor(p.lon + dx / Math.cos(p.lat * Math.PI / 180))] = 1;
          });
        });
      });
      return Promise.all(Object.keys(keys).map(marketTile)).then(function (tiles) {
        if (token !== marketsToken) return;
        var seen = {}, found = [];
        [].concat.apply([], tiles).forEach(function (m) {
          if (seen[m.id]) return; seen[m.id] = 1;
          var best = null;
          pts.forEach(function (p, i) {
            var d = miles(p.lat, p.lon, m.lat, m.lon);
            if (d <= MARKET_MILES && (!best || d < best.d)) best = { d: d, i: i, city: p.city };
          });
          if (best) found.push({ m: m, near: best });
        });
        // Home city first, then the nearby cities in the order picked; closest first within each.
        found.sort(function (a, b) { return a.near.i - b.near.i || a.near.d - b.near.d; });
        drawMarkets(found);
      });
    });
  }
  function drawMarkets(found) {
    var box = $('markets'), list = $('markets-list'), more = $('markets-more');
    list.innerHTML = '';
    if (!found.length) { box.hidden = true; return; }
    $('markets-count').textContent = found.length + ' nearby';
    found.forEach(function (f, i) {
      var m = f.m;
      var li = document.createElement('li'); li.className = 'market';
      if (i >= MARKETS_SHOWN) li.hidden = true;
      var h = document.createElement('h4');
      var a = document.createElement('a');
      a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(m.name + ', ' + m.addr);
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = m.name;
      h.appendChild(a);
      var where = document.createElement('p'); where.className = 'market-where';
      where.textContent = m.addr.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ');
      var meta = document.createElement('p'); meta.className = 'market-meta';
      var near = document.createElement('span'); near.className = 'market-near';
      near.textContent = f.near.d < 1 ? f.near.city : f.near.d.toFixed(1) + ' mi from ' + f.near.city;
      meta.appendChild(near);
      if (m.ebt) { var e = document.createElement('span'); e.className = 'market-tag'; e.textContent = 'SNAP/EBT'; meta.appendChild(e); }
      if (m.organic) { var o = document.createElement('span'); o.className = 'market-tag'; o.textContent = 'Organic'; meta.appendChild(o); }
      li.append(h, where);
      if (m.about) {
        var ab = document.createElement('p'); ab.className = 'market-about';
        ab.textContent = m.about; li.appendChild(ab);
      }
      li.appendChild(meta);
      list.appendChild(li);
    });
    var hidden = found.length - MARKETS_SHOWN;
    more.hidden = hidden <= 0;
    more.textContent = 'Show ' + hidden + ' more';
    more.setAttribute('aria-expanded', 'false');
    box.hidden = false;
  }
  // Scrolling runs on from one box into the next: past the end of the farmers
  // markets list the wheel moves the local events list, and back up again.
  (function chainScroll() {
    var top = $('markets-list'), bottom = document.querySelector('.evbox-scroll');
    if (!top || !bottom) return;
    function px(e, el) { return e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY; }
    top.addEventListener('wheel', function (e) {
      var dy = px(e, top);
      if (dy > 0 && top.scrollTop + top.clientHeight >= top.scrollHeight - 1) {
        e.preventDefault(); bottom.scrollTop += dy;
      }
    }, { passive: false });
    bottom.addEventListener('wheel', function (e) {
      var dy = px(e, bottom);
      if (dy < 0 && bottom.scrollTop <= 0 && !$('markets').hidden) {
        e.preventDefault(); top.scrollTop += dy;
      }
    }, { passive: false });
  })();

  // ---------- Make this your home page ----------
  // Browsers don't let a site set itself as the home page, so this shows the
  // steps for the visitor's browser and copies the address.
  (function homePage() {
    var btn = $('hp-btn'), help = $('hp-help');
    if (!btn || !help) return;
    var ua = navigator.userAgent;
    var mine = /Edg\//.test(ua) ? 'edge' : /Firefox\//.test(ua) ? 'firefox' :
      (/Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua)) ? 'safari' : 'chrome';
    function pick(name) {
      help.querySelectorAll('[data-hp]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.hp === name)); });
      help.querySelectorAll('[data-hp-steps]').forEach(function (ol) { ol.hidden = ol.dataset.hpSteps !== name; });
    }
    function setOpen(open) {
      help.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) { pick(mine); $('hp-copied').textContent = ''; }
    }
    btn.addEventListener('click', function () { setOpen(help.hidden); });
    help.querySelectorAll('[data-hp]').forEach(function (b) { b.addEventListener('click', function () { pick(b.dataset.hp); }); });
    $('hp-copy').addEventListener('click', function () {
      var url = location.origin + '/';
      var done = function () { $('hp-copied').textContent = 'Copied ' + url; };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { $('hp-copied').textContent = url; });
      else $('hp-copied').textContent = url;
    });
    document.addEventListener('click', function (e) {
      if (!help.hidden && !help.contains(e.target) && !btn.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !help.hidden) { setOpen(false); btn.focus(); }
    });
  })();

  $('markets-more').addEventListener('click', function () {
    var open = this.getAttribute('aria-expanded') !== 'true';
    var rows = $('markets-list').children, n = 0;
    for (var i = MARKETS_SHOWN; i < rows.length; i++) { rows[i].hidden = !open; n++; }
    this.setAttribute('aria-expanded', String(open));
    this.textContent = open ? 'Show fewer' : 'Show ' + n + ' more';
  });

  function renderOpenHouses() {
    var list = $('oh-list'); list.innerHTML = ''; $('hv-credit').hidden = true;
    $('markets').hidden = true; marketsToken++;
    var p = state.profile;
    if (!p || !p.zip) return;
    lookupZip(p.zip).then(function (home) {
      if (!home) return;
      var cities = [{ city: titleCase(home.city), st: home.state, zip: p.zip }];
      (p.nearby_places || []).forEach(function (v) {
        var m = String(v).match(/^(.*\S),\s*([A-Z]{2})$/);
        cities.push({ city: m ? m[1] : v, st: m ? m[2] : home.state, zip: null });
      });
      return Promise.all(cities.map(function (c) {
        return c.zip ? c : zipForCity(c.city, c.st).then(function (z) { c.zip = z; return c; });
      }));
    }).then(function (cities) {
      if (!cities) return;
      list.innerHTML = '';
      cities.forEach(function (c) {
        var li = document.createElement('li'); li.className = 'oh-row';
        var name = document.createElement('span'); name.className = 'oh-city'; name.textContent = c.city;
        c.nameEl = name;
        var links = document.createElement('span'); links.className = 'oh-links';
        links.appendChild(ohLink('https://www.zillow.com/' + slug(c.city) + '-' + c.st.toLowerCase() + '/open-house/', 'Zillow'));
        if (c.zip) links.appendChild(ohLink('https://www.redfin.com/zipcode/' + c.zip + '/open-houses', 'Redfin'));
        links.appendChild(ohLink('https://www.realtor.com/realestateandhomes-search/' + encodeURIComponent(c.city.replace(/ /g, '-')) + '_' + c.st + '/show-open-house', 'Realtor.com'));
        li.append(name, links);
        list.appendChild(li);
      });
      renderSales(cities);
      renderMarkets(cities);
      return homeValues(cities[0].st).then(function (hv) {
        if (!hv) return;
        var any = false;
        cities.forEach(function (c, i) {
          var pair = (hv.cities && hv.cities[c.city.toLowerCase()]) || (i === 0 && hv.zips && hv.zips[c.zip]);
          if (c.st !== cities[0].st) return;
          if (pair) { c.nameEl.appendChild(hvBadge(pair)); any = true; }
        });
        if (any && hv.month) {
          var mm = /^(\d{4})-(\d\d)$/.exec(hv.month);
          $('hv-month').textContent = mm ? MONTH_ABBR[Number(mm[2]) - 1] + ' ' + mm[1] : hv.month;
          $('hv-credit').hidden = false;
        }
      });
    });
  }

  // Last events shown for this ZIP + nearby cities, so the box fills at once
  // while fresh results load (browser storage can be missing: ignore errors).
  function eventsCacheKey() {
    var p = state.profile || {};
    return 'rv-events:' + p.zip + '|' + (p.nearby_places || []).join(';');
  }
  function readEventsCache() {
    try { return JSON.parse(localStorage.getItem(eventsCacheKey()) || 'null'); } catch (e) { return null; }
  }
  var DAY_MS = 24 * 3600e3;
  function writeEventsCache(data) {
    // Ask the server again once its saved events turn 24 hours old; if it was
    // refreshing in the background just now, check back in 10 minutes.
    var now = Date.now(), updated = Date.parse(data.updated_at || '') || now;
    var recheck = data.refreshing ? now + 10 * 60e3 : updated + DAY_MS;
    recheck = Math.min(Math.max(recheck, now + 5 * 60e3), now + DAY_MS);
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('rv-events:') === 0) localStorage.removeItem(k); });
      localStorage.setItem(eventsCacheKey(), JSON.stringify({ at: now, updated_at: data.updated_at || null, recheck: recheck, places: data.places || [], events: data.events || [] }));
    } catch (e) { /* storage full or blocked */ }
  }
  function showEventsUpdated(iso) {
    var t = Date.parse(iso || ''), msg = 'Events refreshed once a day.';
    if (t) {
      var d = new Date(t), today = new Date();
      var when = d.toDateString() === today.toDateString() ? 'today' :
        d.toDateString() === new Date(today.getTime() - DAY_MS).toDateString() ? 'yesterday' :
        d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      msg += ' Last updated ' + when + ' at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
    }
    $('events-updated').textContent = msg;
  }
  function showEventsNote(places) {
    $('events-note').textContent = places.length ? 'From ' + listJoin(places) + '.' : 'Around you and your nearby cities.';
    $('events-note').title = $('events-note').textContent;
  }
  function showEvents(places, events) {
    var today = new Date(); var iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    events = events.filter(function (e) { return !e.start || e.start >= iso; });
    showEventsNote(places);
    $('events-empty').hidden = true; $('events-loading').hidden = true;
    renderEvents(events);
    $('events-count').textContent = events.length + ' upcoming';
    return events.length;
  }

  var eventsToken = 0;
  function loadEvents() {
    var token = ++eventsToken;
    renderOpenHouses();
    document.dispatchEvent(new CustomEvent('rv:area-changed'));
    $('events').innerHTML = ''; $('events-empty').hidden = true; $('events-loading').hidden = false;
    $('events-count').textContent = '';
    if (!state.profile || !state.profile.zip) {
      $('events-loading').hidden = true;
      eventsEmpty(['Add your ZIP code to see events near you.']);
      return;
    }
    var cached = readEventsCache(), shownCached = false;
    if (cached && cached.events && cached.events.length) {
      shownCached = showEvents(cached.places || [], cached.events) > 0;
      showEventsUpdated(cached.updated_at);
      // Saved less than a day ago: use it and don't ask the server again yet.
      if (shownCached && cached.recheck && Date.now() < cached.recheck) return;
      if (shownCached) $('events-count').textContent = 'Updating\u2026';
    }
    db.functions.invoke('local-events', { method: 'GET' }).then(function (r) {
      if (token !== eventsToken) return;
      $('events-loading').hidden = true;
      if (r.error) {
        if (shownCached) { $('events-count').textContent = $('events').children.length + ' upcoming'; return; }
        eventsEmpty(['We couldn\u2019t load events right now.', 'Try again in a few minutes.']); return;
      }
      var events = (r.data && r.data.events) || [];
      var evPlaces = (r.data && r.data.places) || [];
      if (r.data && r.data.configured === false) { showEventsNote(evPlaces); eventsEmpty(['Events are almost ready.', 'The events service still needs its key.']); return; }
      if (!events.length) {
        if (shownCached) { $('events-count').textContent = $('events').children.length + ' upcoming'; return; }
        showEventsNote(evPlaces);
        eventsEmpty(['No upcoming events found nearby yet.', 'Check back tomorrow.']); return;
      }
      showEvents(evPlaces, events);
      showEventsUpdated(r.data.updated_at);
      writeEventsCache(r.data);
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
        loadNews(); loadEvents();
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
    var text = chosen.length
      ? chosen.map(function (b) { return b.getAttribute('data-name'); }).join(', ')
      : 'Choose up to ' + MAX_PLACES;
    $('places-summary-text').textContent = text;
    $('places-summary').title = chosen.length ? text : '';
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
      loadNews(); loadEvents();
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
    show($('top-greeting'), !!state.user);
    show($('top-settings'), !!state.user);
    document.body.classList.toggle('signed-in', !!state.user);
    if (!state.user) { state.profile = null; setStreetZip(''); document.dispatchEvent(new CustomEvent('rv:signed-out')); return; }
    loadProfile().then(renderPlace).then(function () { loadNews(); loadEvents(); loadNearbyOptions(); });
  }

  var lastUserId;
  db.auth.onAuthStateChange(function (_event, session) {
    var id = session ? session.user.id : null;
    // Supabase can report the same session twice on load (SIGNED_IN, then
    // INITIAL_SESSION); only redraw when the signed-in person actually changes.
    if (id === lastUserId) return;
    lastUserId = id;
    render(session);
  });
})();
