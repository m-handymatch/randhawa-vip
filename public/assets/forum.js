// randhawa.vip: personal pages (name.randhawa.vip) and the neighborhood forum.
// Uses the Supabase client and signed-in state that app.js shares as window.RV.
(function () {
  var RV = window.RV;
  if (!RV) return;
  var db = RV.db, state = RV.state;
  var $ = function (id) { return document.getElementById(id); };

  var BASE_DOMAIN = 'randhawa.vip';
  var CATEGORIES = {
    'general': 'General', 'recommendations': 'Recommendations', 'for-sale': 'For sale & free',
    'lost-found': 'Lost & found', 'safety': 'Safety', 'events': 'Events'
  };
  var me = { site: null, isAdmin: false };
  var feed = { everywhere: false, oldest: null, busy: false };

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function siteUrl(slug) { return 'https://' + slug + '.' + BASE_DOMAIN + '/'; }
  function hint(id, text, kind) { var h = $(id); h.textContent = text || ''; h.className = 'hint' + (kind ? ' ' + kind : ''); }
  function errText(err, fallback) {
    var m = err && (err.message || err.details);
    if (!m) return fallback;
    if (/duplicate key|member_sites_pkey/i.test(m)) return 'That address is taken. Try another.';
    if (/member_sites_user_id_key/i.test(m)) return 'You already have a page.';
    if (/slug_check|violates check constraint "member_sites_slug/i.test(m)) return 'That address isn’t allowed. Use 3 to 30 letters, numbers or dashes.';
    if (/check constraint/i.test(m)) return 'Please check the length of what you typed.';
    return m;
  }
  function when(iso) {
    var t = Date.parse(iso); if (isNaN(t)) return '';
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.round(mins / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24); if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
  }
  function cleanSlug(v) { return String(v || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, ''); }
  function slugProblem(s) {
    if (s.length < 3) return 'Use at least 3 characters.';
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s) || /--/.test(s)) return 'Letters, numbers and single dashes; no dash at the start or end.';
    return null;
  }

  // ---------- Your page ----------
  function loadMyPage() {
    if (!state.user) return Promise.resolve();
    return db.from('member_sites').select('slug, title, about, city, state, is_hidden').eq('user_id', state.user.id).maybeSingle()
      .then(function (r) {
        me.site = r.data || null;
        $('mypage-claim').hidden = !!me.site;
        $('mypage-own').hidden = !me.site;
        $('compose').hidden = !me.site;
        if (me.site) {
          var a = $('mypage-url'); a.href = siteUrl(me.site.slug); a.textContent = me.site.slug + '.' + BASE_DOMAIN;
          $('page-title').value = me.site.title;
          $('page-about').value = me.site.about || '';
          if (me.site.is_hidden) hint('page-hint', 'Your page is hidden by a moderator.', 'bad');
        } else {
          var name = (state.profile && state.profile.display_name) || '';
          if (!$('claim-title').value) $('claim-title').value = name;
          if (!$('claim-slug').value && name) $('claim-slug').value = cleanSlug(name.split(/\s+/).pop());
        }
      });
  }

  var slugTimer = null;
  $('claim-slug').addEventListener('input', function (e) {
    var s = cleanSlug(e.target.value);
    if (s !== e.target.value) e.target.value = s;
    clearTimeout(slugTimer);
    var problem = slugProblem(s);
    if (problem) { hint('claim-hint', problem, s ? 'bad' : ''); return; }
    hint('claim-hint', 'Checking ' + s + '.' + BASE_DOMAIN + '…');
    slugTimer = setTimeout(function () {
      db.from('member_sites').select('slug').eq('slug', s).maybeSingle().then(function (r) {
        if (cleanSlug($('claim-slug').value) !== s) return;
        if (r.data) hint('claim-hint', s + '.' + BASE_DOMAIN + ' is taken.', 'bad');
        else hint('claim-hint', s + '.' + BASE_DOMAIN + ' looks available.', 'ok');
      });
    }, 350);
  });

  $('claim-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var slug = cleanSlug($('claim-slug').value), title = $('claim-title').value.trim();
    var problem = slugProblem(slug);
    if (problem) return hint('claim-hint', problem, 'bad');
    if (!title) return hint('claim-hint', 'Add the name to show on your page.', 'bad');
    var btn = e.target.querySelector('button'); btn.disabled = true;
    db.from('member_sites').insert({ slug: slug, title: title, about: '' }).then(function (r) {
      if (r.error) throw r.error;
      return loadMyPage();
    }).then(function () {
      hint('page-hint', 'Your page is live at ' + slug + '.' + BASE_DOMAIN + '.', 'ok');
      loadFeed(true);
    }).catch(function (err) {
      hint('claim-hint', errText(err, 'Couldn’t create your page. Try again.'), 'bad');
    }).finally(function () { btn.disabled = false; });
  });

  $('page-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!me.site) return;
    var title = $('page-title').value.trim(), about = $('page-about').value.trim();
    if (!title) return hint('page-hint', 'Add a name for your page.', 'bad');
    var btn = e.target.querySelector('button'); btn.disabled = true;
    db.from('member_sites').update({ title: title, about: about }).eq('slug', me.site.slug).then(function (r) {
      if (r.error) throw r.error;
      me.site.title = title; me.site.about = about;
      hint('page-hint', 'Saved.', 'ok');
    }).catch(function (err) {
      hint('page-hint', errText(err, 'Couldn’t save. Try again.'), 'bad');
    }).finally(function () { btn.disabled = false; });
  });

  // ---------- New post ----------
  $('post-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, title = f.title.value.trim(), body = f.body.value.trim();
    if (!title || !body) return hint('post-hint', 'Add a title and a message.', 'bad');
    var btn = f.querySelector('button'); btn.disabled = true;
    db.from('posts').insert({ title: title, body: body, category: f.category.value }).then(function (r) {
      if (r.error) throw r.error;
      f.title.value = ''; f.body.value = '';
      hint('post-hint', 'Posted.', 'ok');
      loadFeed(true);
    }).catch(function (err) {
      hint('post-hint', errText(err, 'Couldn’t post. Try again.'), 'bad');
    }).finally(function () { btn.disabled = false; });
  });

  // ---------- Feed ----------
  function setTab(everywhere) {
    feed.everywhere = everywhere;
    $('feed-near').classList.toggle('is-on', !everywhere); $('feed-near').setAttribute('aria-selected', String(!everywhere));
    $('feed-all').classList.toggle('is-on', everywhere); $('feed-all').setAttribute('aria-selected', String(everywhere));
    loadFeed(true);
  }
  $('feed-near').addEventListener('click', function () { setTab(false); });
  $('feed-all').addEventListener('click', function () { setTab(true); });
  $('feed-more').addEventListener('click', function () { loadFeed(false); });

  function loadFeed(reset) {
    if (!state.user || feed.busy) return;
    feed.busy = true;
    if (reset) { $('feed').innerHTML = ''; feed.oldest = null; $('feed-loading').hidden = false; }
    $('feed-empty').hidden = true; $('feed-more').hidden = true;
    db.rpc('forum_feed', { p_everywhere: feed.everywhere, p_before: feed.oldest, p_limit: 20 }).then(function (r) {
      $('feed-loading').hidden = true;
      if (r.error) throw r.error;
      var rows = r.data || [];
      rows.forEach(function (p) { $('feed').appendChild(renderPost(p)); });
      if (rows.length) feed.oldest = rows[rows.length - 1].created_at;
      $('feed-more').hidden = rows.length < 20;
      if (!$('feed').children.length) {
        var box = $('feed-empty'); box.innerHTML = '';
        box.appendChild(el('p', null, feed.everywhere ? 'No posts yet.' : 'No posts near you yet.'));
        box.appendChild(el('p', null, me.site ? 'Be the first: write a post on the left.' : 'Create your page on the left, then write the first post.'));
        box.hidden = false;
      }
    }).catch(function () {
      $('feed-loading').hidden = true;
      var box = $('feed-empty'); box.innerHTML = '';
      box.appendChild(el('p', null, 'We couldn’t load the forum right now. Try again in a minute.'));
      box.hidden = false;
    }).finally(function () { feed.busy = false; });
  }

  function authorLink(name, slug) {
    if (!slug) return el('span', 'author', name);
    var a = el('a', 'author', name); a.href = siteUrl(slug); a.target = '_blank'; a.rel = 'noopener';
    return a;
  }

  function renderPost(p) {
    var li = el('li', 'post'); li.dataset.id = p.id;
    var top = el('div', 'post-top');
    top.appendChild(el('span', 'cat cat-' + p.category, CATEGORIES[p.category] || 'General'));
    var meta = el('span', 'post-meta');
    meta.appendChild(authorLink(p.author_name, p.site_slug));
    meta.append(' · ' + (p.city || '') + ' · ' + when(p.created_at) + (p.edited_at ? ' · edited' : ''));
    top.appendChild(meta);
    li.appendChild(top);
    li.appendChild(el('h3', 'post-title', p.title));
    var body = el('p', 'post-body', p.body); li.appendChild(body);
    if (p.body.length > 280) {
      body.classList.add('clamped');
      var more = el('button', 'linkish small', 'Show more'); more.type = 'button';
      more.addEventListener('click', function () { body.classList.toggle('clamped'); more.textContent = body.classList.contains('clamped') ? 'Show more' : 'Show less'; });
      li.appendChild(more);
    }
    var actions = el('div', 'post-actions');
    var rbtn = el('button', 'act', 'Replies (' + p.reply_count + ')'); rbtn.type = 'button';
    rbtn.setAttribute('aria-expanded', 'false');
    actions.appendChild(rbtn);
    if (p.is_mine) {
      var del = el('button', 'act', 'Delete'); del.type = 'button';
      del.addEventListener('click', function () {
        if (!window.confirm('Delete this post and its replies?')) return;
        db.from('posts').delete().eq('id', p.id).then(function (r) { if (!r.error) li.remove(); });
      });
      actions.appendChild(del);
    } else {
      actions.appendChild(reportButton({ post_id: p.id }));
    }
    if (me.isAdmin && !p.is_mine) {
      var hide = el('button', 'act act-admin', 'Hide'); hide.type = 'button';
      hide.addEventListener('click', function () {
        db.from('posts').update({ is_hidden: true }).eq('id', p.id).then(function (r) { if (!r.error) li.remove(); });
      });
      actions.appendChild(hide);
    }
    li.appendChild(actions);
    var thread = el('div', 'thread'); thread.hidden = true; li.appendChild(thread);
    rbtn.addEventListener('click', function () {
      var open = thread.hidden;
      thread.hidden = !open; rbtn.setAttribute('aria-expanded', String(open));
      if (open && !thread.dataset.loaded) loadThread(p, thread, rbtn);
    });
    return li;
  }

  function reportButton(target) {
    var b = el('button', 'act act-quiet', 'Report'); b.type = 'button';
    b.addEventListener('click', function () {
      var reason = window.prompt('What’s wrong with this? (optional)', '');
      if (reason === null) return;
      db.from('reports').insert(Object.assign({ reason: reason.slice(0, 500) }, target)).then(function (r) {
        b.textContent = r.error && !/duplicate/i.test(r.error.message || '') ? 'Couldn’t report' : 'Reported';
        b.disabled = true;
      });
    });
    return b;
  }

  function loadThread(p, thread, rbtn) {
    thread.innerHTML = ''; thread.appendChild(el('p', 'muted small', 'Loading replies…'));
    db.from('replies').select('id, author_id, author_name, author_slug, body, created_at').eq('post_id', p.id).order('created_at').then(function (r) {
      thread.innerHTML = ''; thread.dataset.loaded = '1';
      var list = el('ul', 'replies'); thread.appendChild(list);
      (r.data || []).forEach(function (rep) { list.appendChild(renderReply(rep)); });
      var form = el('form', 'reply-form'); form.noValidate = true;
      var ta = el('textarea'); ta.rows = 2; ta.maxLength = 2000; ta.placeholder = 'Write a reply'; ta.setAttribute('aria-label', 'Reply to ' + p.title);
      var row = el('div', 'form-row');
      var send = el('button', 'btn btn-small', 'Reply'); send.type = 'submit';
      var h = el('span', 'hint');
      row.append(send, h); form.append(ta, row); thread.appendChild(form);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = ta.value.trim(); if (!body) return;
        send.disabled = true;
        db.from('replies').insert({ post_id: p.id, body: body }).select('id, author_id, author_name, author_slug, body, created_at').single().then(function (res) {
          if (res.error) throw res.error;
          list.appendChild(renderReply(res.data)); ta.value = ''; h.textContent = '';
          p.reply_count += 1; rbtn.textContent = 'Replies (' + p.reply_count + ')';
        }).catch(function (err) { h.textContent = errText(err, 'Couldn’t reply. Try again.'); h.className = 'hint bad'; })
          .finally(function () { send.disabled = false; });
      });
    });
  }

  function renderReply(rep) {
    var li = el('li', 'reply');
    var meta = el('div', 'post-meta');
    meta.appendChild(authorLink(rep.author_name, rep.author_slug));
    meta.append(' · ' + when(rep.created_at));
    li.appendChild(meta);
    li.appendChild(el('p', 'reply-body', rep.body));
    var actions = el('div', 'post-actions');
    if (state.user && rep.author_id === state.user.id) {
      var del = el('button', 'act', 'Delete'); del.type = 'button';
      del.addEventListener('click', function () {
        db.from('replies').delete().eq('id', rep.id).then(function (r) { if (!r.error) li.remove(); });
      });
      actions.appendChild(del);
    } else {
      actions.appendChild(reportButton({ reply_id: rep.id }));
      if (me.isAdmin) {
        var hide = el('button', 'act act-admin', 'Hide'); hide.type = 'button';
        hide.addEventListener('click', function () {
          db.from('replies').update({ is_hidden: true }).eq('id', rep.id).then(function (r) { if (!r.error) li.remove(); });
        });
        actions.appendChild(hide);
      }
    }
    li.appendChild(actions);
    return li;
  }

  // ---------- Admin: reports ----------
  function loadReports() {
    if (!me.isAdmin) return;
    db.rpc('open_reports').then(function (r) {
      var rows = r.data || [];
      $('admin-card').hidden = false;
      $('admin-count').textContent = String(rows.length);
      var list = $('admin-list'); list.innerHTML = '';
      if (!rows.length) { list.appendChild(el('li', 'muted small', 'Nothing to review.')); return; }
      rows.forEach(function (it) {
        var li = el('li', 'admin-item');
        li.appendChild(el('p', 'small', it.kind + ' by ' + (it.author_name || '?') + ' · ' + it.reports + (it.reports === 1 ? ' report' : ' reports') + (it.is_hidden ? ' · hidden' : '')));
        if (it.title) li.appendChild(el('p', 'admin-title', it.title));
        li.appendChild(el('p', 'admin-body', (it.body || '').slice(0, 240)));
        if (it.reason) li.appendChild(el('p', 'muted small', 'Reason: ' + it.reason));
        var row = el('div', 'post-actions');
        var table = it.kind === 'post' ? 'posts' : it.kind === 'reply' ? 'replies' : 'member_sites';
        var key = it.kind === 'page' ? 'slug' : 'id';
        var col = it.kind === 'post' ? 'post_id' : it.kind === 'reply' ? 'reply_id' : 'site_slug';
        function resolve() { return db.from('reports').update({ resolved: true }).eq(col, it.target_id).then(loadReports); }
        var keep = el('button', 'act', 'Keep it'); keep.type = 'button';
        keep.addEventListener('click', function () {
          db.from(table).update({ is_hidden: false }).eq(key, it.target_id).then(resolve).then(function () { loadFeed(true); });
        });
        var hide = el('button', 'act act-admin', 'Hide it'); hide.type = 'button';
        hide.addEventListener('click', function () {
          db.from(table).update({ is_hidden: true }).eq(key, it.target_id).then(resolve).then(function () { loadFeed(true); });
        });
        row.append(keep, hide);
        li.appendChild(row);
        list.appendChild(li);
      });
    });
  }

  // ---------- Wiring ----------
  var started = false;
  document.addEventListener('rv:area-changed', function () {
    if (!state.user) return;
    if (!started) {
      started = true;
      db.rpc('am_i_admin').then(function (r) { me.isAdmin = r.data === true; loadReports(); });
      loadMyPage().then(function () { loadFeed(true); });
    } else {
      loadFeed(true);
    }
  });
  document.addEventListener('rv:signed-out', function () {
    started = false; me.site = null; me.isAdmin = false;
    $('feed').innerHTML = ''; $('admin-card').hidden = true;
  });
})();
