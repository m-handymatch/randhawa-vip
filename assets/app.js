// randhawa.vip front end
(function () {
  var SUPABASE_URL = 'https://pipzvzxcfvsxyiwmqpyv.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_lt-qIsIQf8oXzk-P6b4mAQ_2BwK15ZN'; // public, read-only key
  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var $ = function (id) { return document.getElementById(id); };
  var state = { user: null, profile: null };

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
    return db.from('zip_zcta').select('zip, city, state').eq('zip', zip).maybeSingle()
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
    });
  }

  function renderStories(articles) {
    var list = $('stories');
    list.innerHTML = '';
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
      if (!articles.length) {
        emptyState(['No local headlines yet for your area.', 'Smaller towns get fewer stories. Check back later today.']);
        return;
      }
      renderStories(articles);
    });
  }

  function loadProfile() {
    return db.from('profiles').select('display_name, zip').eq('id', state.user.id).maybeSingle()
      .then(function (r) { state.profile = r.data || { display_name: null, zip: null }; });
  }

  wireZipHint($('zip-form').zip, $('zip-change-hint'));

  $('zip-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, zip = f.zip.value.trim(), hint = $('zip-change-hint'), btn = f.querySelector('button');
    if (!validZip(zip)) { hint.textContent = 'Enter a 5-digit ZIP code.'; hint.className = 'hint bad'; return; }
    btn.disabled = true;
    lookupZip(zip).then(function (p) {
      if (!p) throw new Error('We don’t recognize that ZIP code.');
      return db.from('profiles').update({ zip: zip }).eq('id', state.user.id);
    }).then(function (r) {
      if (r.error) throw r.error;
      state.profile.zip = zip;
      f.reset(); hint.textContent = 'Updated.'; hint.className = 'hint ok';
      return renderPlace().then(loadNews);
    }).catch(function (err) {
      hint.textContent = (err && err.message) || 'Couldn’t update your ZIP. Try again.'; hint.className = 'hint bad';
    }).finally(function () { btn.disabled = false; });
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
    loadProfile().then(renderPlace).then(loadNews);
  }

  var lastUserId;
  db.auth.onAuthStateChange(function (_event, session) {
    var id = session ? session.user.id : null;
    if (id === lastUserId && _event !== 'INITIAL_SESSION') return;
    lastUserId = id;
    render(session);
  });
})();
