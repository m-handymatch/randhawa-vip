// Admin page for localconnect.site (served on mandeepsr.us, IP-locked by the Worker).
// Data comes from Supabase tables that only admins can read: admin_ledger,
// admin_next, plus admin_stats() for live numbers.
(function () {
  var db = window.supabase.createClient(
    'https://pipzvzxcfvsxyiwmqpyv.supabase.co',
    'sb_publishable_lt-qIsIQf8oXzk-P6b4mAQ_2BwK15ZN' // public key; the tables check for an admin login
  );
  var $ = function (id) { return document.getElementById(id); };
  var ledger = [], editing = false;

  function money(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return '$' + (n % 1 ? n.toFixed(2) : n.toLocaleString());
  }
  // A row with no price at all says "Not entered" once (in Yearly); other empty boxes show a dash.
  function costCell(v, flag) {
    var td = document.createElement('td'); td.className = 'num';
    var m = money(v);
    if (m === null && flag) { var s = document.createElement('span'); s.className = 'missing'; s.textContent = 'Not entered'; td.appendChild(s); }
    else if (m === null) { td.textContent = '\u2014'; td.classList.add('dash'); }
    else { td.textContent = m; if (Number(v) === 0) td.classList.add('free'); }
    return td;
  }
  function inputCell(row, field, type) {
    var td = document.createElement('td'); td.className = type === 'date' ? '' : 'num';
    var inp = document.createElement('input');
    inp.type = type === 'date' ? 'date' : 'number';
    if (type !== 'date') { inp.min = '0'; inp.step = '0.01'; inp.placeholder = '—'; }
    inp.value = row[field] === null || row[field] === undefined ? '' : row[field];
    inp.setAttribute('aria-label', row.name + ' ' + field.replace('_', ' '));
    inp.addEventListener('change', function () {
      var val = inp.value === '' ? null : (type === 'date' ? inp.value : Number(inp.value));
      var patch = {}; patch[field] = val; patch.updated_at = new Date().toISOString();
      db.from('admin_ledger').update(patch).eq('id', row.id).then(function (r) {
        if (r.error) { $('ledger-hint').textContent = 'Couldn’t save: ' + r.error.message; return; }
        row[field] = val; $('ledger-hint').textContent = 'Saved ' + row.name + '.'; renderTotals();
      });
    });
    td.appendChild(inp);
    return td;
  }

  function renderTotals() {
    var month = 0, year = 0, once = 0, missing = 0;
    ledger.forEach(function (r) {
      month += Number(r.monthly_cost || 0);
      year += Number(r.yearly_cost || 0) + 12 * Number(r.monthly_cost || 0);
      once += Number(r.one_time_cost || 0);
      if (r.monthly_cost === null && r.yearly_cost === null && r.one_time_cost === null) missing++;
    });
    $('t-month').textContent = money(month);
    $('t-year').textContent = money(year);
    $('t-once').textContent = money(once);
    $('t-year-note').textContent = missing ? missing + (missing === 1 ? ' price' : ' prices') + ' not entered yet' : 'Includes 12 months of monthly costs';
  }

  function renderLedger() {
    var body = $('ledger'); body.innerHTML = '';
    var group = null;
    ledger.forEach(function (r) {
      if (r.category !== group) {
        group = r.category;
        var g = document.createElement('tr'); g.className = 'group';
        var gc = document.createElement('td'); gc.colSpan = 6; gc.textContent = group; g.appendChild(gc); body.appendChild(g);
      }
      var tr = document.createElement('tr');
      var svc = document.createElement('td');
      var name = document.createElement('div'); name.className = 'svc-name';
      if (r.link) { var a = document.createElement('a'); a.href = r.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = r.name; name.appendChild(a); }
      else name.textContent = r.name;
      svc.appendChild(name);
      if (r.purpose) { var p = document.createElement('div'); p.className = 'svc-purpose'; p.textContent = r.purpose; svc.appendChild(p); }
      if (r.note) { var n = document.createElement('div'); n.className = 'svc-note'; n.textContent = r.note; svc.appendChild(n); }
      var plan = document.createElement('td'); plan.textContent = r.plan || '';
      tr.append(svc, plan);
      if (editing) {
        tr.append(inputCell(r, 'monthly_cost'), inputCell(r, 'yearly_cost'), inputCell(r, 'one_time_cost'), inputCell(r, 'renews_on', 'date'));
      } else {
        var renews = document.createElement('td');
        renews.textContent = r.renews_on ? new Date(r.renews_on + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        var none = r.monthly_cost === null && r.yearly_cost === null && r.one_time_cost === null;
        tr.append(costCell(r.monthly_cost), costCell(r.yearly_cost, none), costCell(r.one_time_cost), renews);
      }
      body.appendChild(tr);
    });
    renderTotals();
  }

  function nextItem(r) {
    var li = document.createElement('li');
    var box = document.createElement('input'); box.type = 'checkbox'; box.checked = r.done;
    box.setAttribute('aria-label', 'Done: ' + r.title);
    box.addEventListener('change', function () {
      db.from('admin_next').update({ done: box.checked, updated_at: new Date().toISOString() }).eq('id', r.id)
        .then(function (res) { if (!res.error) { r.done = box.checked; loadNext(); } });
    });
    var text = document.createElement('div');
    var t = document.createElement('p'); t.className = 'next-title'; t.textContent = r.title; text.appendChild(t);
    if (r.detail) { var d = document.createElement('p'); d.className = 'next-detail'; d.textContent = r.detail; text.appendChild(d); }
    if (r.link) {
      var a = document.createElement('a'); a.className = 'next-link'; a.href = r.link; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = r.link_label || 'Open'; text.appendChild(a);
    }
    li.append(box, text);
    return li;
  }
  function loadNext() {
    return db.from('admin_next').select('*').order('sort').then(function (r) {
      var rows = r.data || [];
      var todo = rows.filter(function (x) { return !x.done; }), done = rows.filter(function (x) { return x.done; });
      $('next').innerHTML = ''; todo.forEach(function (x) { $('next').appendChild(nextItem(x)); });
      $('done').innerHTML = ''; done.forEach(function (x) { $('done').appendChild(nextItem(x)); });
      $('next-count').textContent = todo.length + ' to do';
      $('done-count').textContent = done.length; $('done-wrap').hidden = !done.length;
    });
  }

  // ---------- Business money ----------
  function loadMoney() {
    return db.from('admin_money').select('*').order('happened_on', { ascending: false }).order('id', { ascending: false }).then(function (r) {
      var rows = r.data || [], have = 0, planned = 0;
      var list = $('money-list'); list.innerHTML = '';
      rows.forEach(function (m) {
        var amt = Number(m.amount);
        if (m.planned) planned += amt; else have += amt;
        var li = document.createElement('li');
        var d = document.createElement('span'); d.textContent = m.description;
        var a = document.createElement('span'); a.className = 'amt' + (amt > 0 ? ' in' : '');
        a.textContent = (amt < 0 ? '\u2212' : '+') + money(Math.abs(amt));
        var sub = document.createElement('span'); sub.className = 'sub';
        var when = document.createElement('span');
        when.textContent = new Date(m.happened_on + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' + m.account;
        sub.appendChild(when);
        if (m.planned) {
          var tag = document.createElement('span'); tag.className = 'planned'; tag.textContent = 'Planned';
          var done = document.createElement('button'); done.type = 'button'; done.className = 'linkbtn'; done.textContent = 'Mark as done today';
          done.addEventListener('click', function () {
            db.from('admin_money').update({ planned: false, happened_on: new Date().toISOString().slice(0, 10) }).eq('id', m.id).then(loadMoney);
          });
          sub.append(tag, done);
        }
        var del = document.createElement('button'); del.type = 'button'; del.className = 'linkbtn'; del.textContent = 'Remove';
        del.addEventListener('click', function () {
          if (window.confirm('Remove "' + m.description + '"?')) db.from('admin_money').delete().eq('id', m.id).then(loadMoney);
        });
        sub.appendChild(del);
        li.append(d, a, sub);
        list.appendChild(li);
      });
      $('money-balance').textContent = (have < 0 ? '\u2212' : '') + money(Math.abs(have));
      $('money-planned').hidden = !planned;
      $('money-planned').textContent = money(Math.abs(planned)) + (planned >= 0 ? ' planned to come in' : ' planned to go out');
    });
  }
  $('money-form').happened_on.value = new Date().toISOString().slice(0, 10);
  $('money-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, amt = Number(f.amount.value);
    if (!amt) { $('money-hint').textContent = 'Enter an amount (negative for spending).'; return; }
    db.from('admin_money').insert({ description: f.description.value.trim(), amount: amt, happened_on: f.happened_on.value })
      .then(function (r) {
        if (r.error) { $('money-hint').textContent = 'Couldn\u2019t save: ' + r.error.message; return; }
        f.description.value = ''; f.amount.value = '';
        $('money-hint').textContent = 'Added.'; loadMoney();
      });
  });

  // ---------- Invoices (sent from PayPal, tracked here) ----------
  function fmtDate(d) {
    return d ? new Date(d + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }
  function linkBtn(text, fn) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'linkbtn'; b.textContent = text;
    b.addEventListener('click', fn); return b;
  }
  function loadInvoices() {
    return db.from('admin_invoices').select('*').order('sent_on', { ascending: false }).order('id', { ascending: false }).then(function (r) {
      var rows = r.data || [], body = $('inv-list'), today = new Date().toISOString().slice(0, 10), year = today.slice(0, 4);
      var open = 0, paid = 0, fees = 0;
      body.innerHTML = '';
      rows.forEach(function (v) {
        var amt = Number(v.amount);
        if (v.status === 'sent') open += amt;
        if (v.status === 'paid' && (v.paid_on || '').slice(0, 4) === year) { paid += amt; fees += Number(v.fee || 0); }
        var tr = document.createElement('tr');
        var who = document.createElement('td');
        var name = document.createElement('div'); name.className = 'svc-name'; name.textContent = v.customer; who.appendChild(name);
        if (v.customer_email) { var em = document.createElement('div'); em.className = 'inv-sub'; em.textContent = v.customer_email; who.appendChild(em); }
        var what = document.createElement('td'); what.textContent = v.description || '';
        if (v.recurring) { var rc = document.createElement('div'); rc.className = 'inv-sub'; rc.textContent = 'Monthly'; what.appendChild(rc); }
        var am = document.createElement('td'); am.className = 'num'; am.textContent = money(amt);
        if (v.status === 'paid' && v.fee) { var fe = document.createElement('div'); fe.className = 'inv-sub'; fe.textContent = money(v.fee) + ' fee'; am.appendChild(fe); }
        var sent = document.createElement('td'); sent.textContent = fmtDate(v.sent_on);
        var due = document.createElement('td'); due.textContent = fmtDate(v.due_on);
        var st = document.createElement('td'), tag = document.createElement('span');
        var overdue = v.status === 'sent' && v.due_on && v.due_on < today;
        tag.className = 'inv-status ' + (overdue ? 'overdue' : v.status);
        tag.textContent = overdue ? 'Overdue' : v.status === 'paid' ? 'Paid ' + fmtDate(v.paid_on) : v.status.charAt(0).toUpperCase() + v.status.slice(1);
        st.appendChild(tag);
        var act = document.createElement('td'); act.className = 'inv-actions';
        if (v.paypal_url) { var a = document.createElement('a'); a.href = v.paypal_url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'PayPal'; act.appendChild(a); }
        if (v.status === 'sent' || v.status === 'draft') {
          act.appendChild(linkBtn('Mark paid', function () { markPaid(v); }));
          act.appendChild(linkBtn('Void', function () {
            if (window.confirm('Void the invoice to ' + v.customer + '?')) db.from('admin_invoices').update({ status: 'void' }).eq('id', v.id).then(loadInvoices);
          }));
        }
        tr.append(who, what, am, sent, due, st, act);
        body.appendChild(tr);
      });
      $('inv-empty').hidden = rows.length > 0;
      $('inv-open').textContent = money(open);
      $('inv-paid').textContent = money(paid);
      $('inv-paid-label').textContent = 'paid in ' + year;
      $('inv-fees').textContent = money(Math.round(fees * 100) / 100);
    });
  }
  // Paid: record it, and add the money in and PayPal's fee out to Business money.
  function markPaid(v) {
    var amt = Number(v.amount);
    var guess = (Math.round((amt * 0.0299 + 0.49) * 100) / 100).toFixed(2);
    var feeText = window.prompt('PayPal fee for this payment? (card payments: 2.99% + $0.49 = $' + guess + '; PayPal/Venmo: 3.49% + $0.49; bank: 1%, max $10). Check the amount in PayPal.', guess);
    if (feeText === null) return;
    var fee = Math.max(0, Number(feeText) || 0), today = new Date().toISOString().slice(0, 10);
    db.from('admin_invoices').update({ status: 'paid', paid_on: today, fee: fee }).eq('id', v.id).then(function (r) {
      if (r.error) { $('inv-hint').textContent = 'Couldn\u2019t save: ' + r.error.message; return; }
      var entries = [{ description: 'Invoice paid: ' + v.customer + (v.description ? ' (' + v.description + ')' : ''), amount: amt, happened_on: today }];
      if (fee) entries.push({ description: 'PayPal fee: ' + v.customer, amount: -fee, happened_on: today });
      db.from('admin_money').insert(entries).then(function () {
        $('inv-hint').textContent = 'Marked paid and added to Business money.';
        loadInvoices(); loadMoney();
      });
    });
  }
  $('inv-form').sent_on.value = new Date().toISOString().slice(0, 10);
  $('inv-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var row = {
      customer: f.customer.value.trim(), customer_email: f.customer_email.value.trim() || null,
      description: f.description.value.trim() || null, amount: Number(f.amount.value),
      sent_on: f.sent_on.value, due_on: f.due_on.value || null,
      paypal_url: /^https:\/\//.test(f.paypal_url.value.trim()) ? f.paypal_url.value.trim() : null,
      recurring: f.recurring.checked
    };
    db.from('admin_invoices').insert(row).then(function (r) {
      if (r.error) { $('inv-hint').textContent = 'Couldn\u2019t save: ' + r.error.message; return; }
      f.reset(); f.sent_on.value = new Date().toISOString().slice(0, 10);
      $('inv-hint').textContent = 'Invoice recorded.'; loadInvoices();
    });
  });

  function stat(label, value, meter) {
    var d = document.createElement('div'); d.className = 'stat';
    var n = document.createElement('p'); n.className = 'stat-num'; n.textContent = value;
    var l = document.createElement('p'); l.className = 'stat-label'; l.textContent = label;
    d.append(n, l);
    if (meter !== undefined) {
      var m = document.createElement('div'); m.className = 'meter' + (meter > 0.8 ? ' high' : '');
      var s = document.createElement('span'); s.style.width = Math.min(100, Math.round(meter * 100)) + '%';
      m.appendChild(s); d.appendChild(m);
    }
    return d;
  }
  function loadStats() {
    return db.rpc('admin_stats').then(function (r) {
      var s = r.data; if (!s) return;
      var box = $('stats'); box.innerHTML = '';
      var mb = function (b) { return Math.round(b / 1048576) + ' MB'; };
      box.append(
        stat('Members', s.members.toLocaleString()),
        stat('Member pages', s.member_pages.toLocaleString()),
        stat('Forum posts and replies', (s.posts + s.replies).toLocaleString()),
        stat('Businesses (' + s.business_emails.toLocaleString() + ' with email)', s.businesses.toLocaleString()),
        stat('Database: ' + mb(s.db_bytes) + ' of ' + mb(s.db_limit_bytes) + ' free', Math.round(100 * s.db_bytes / s.db_limit_bytes) + '%', s.db_bytes / s.db_limit_bytes),
        stat('Event searches this month (of ' + s.serpapi_limit + ' free)', s.serpapi_month.toLocaleString(), s.serpapi_month / s.serpapi_limit)
      );
    });
  }

  function start() {
    $('loading').hidden = false;
    db.rpc('am_i_admin').then(function (r) {
      $('loading').hidden = true;
      if (r.data !== true) { $('not-admin').hidden = false; return; }
      $('app').hidden = false;
      return Promise.all([
        db.from('admin_ledger').select('*').order('sort').then(function (res) { ledger = res.data || []; renderLedger(); }),
        loadNext(), loadStats(), loadMoney(), loadInvoices()
      ]);
    });
  }

  $('edit-costs').addEventListener('click', function () {
    editing = !editing;
    this.setAttribute('aria-pressed', String(editing));
    this.textContent = editing ? 'Done editing' : 'Edit costs';
    $('ledger-hint').textContent = editing ? 'Changes save as you go. Leave a box empty for "Not entered"; type 0 for free.' : '';
    renderLedger();
  });

  $('signin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    $('signin-hint').textContent = 'Signing in…';
    db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value }).then(function (r) {
      if (r.error) { $('signin-hint').textContent = r.error.message; return; }
      f.password.value = '';
    });
  });
  // Sign out here first (no network needed), then end the session on the server too.
  $('signout').addEventListener('click', function () {
    var btn = this; btn.disabled = true;
    db.auth.signOut({ scope: 'local' }).catch(function () {}).then(function () {
      try {
        Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); });
      } catch (e) { /* storage blocked */ }
      showSignedOut();
      btn.disabled = false;
    });
  });

  var last;
  function showSignedOut() {
    last = null;
    $('signin').hidden = false; $('who').hidden = true;
    $('app').hidden = true; $('not-admin').hidden = true; $('loading').hidden = true;
    ledger = []; $('ledger').innerHTML = ''; $('next').innerHTML = ''; $('stats').innerHTML = ''; $('money-list').innerHTML = ''; $('inv-list').innerHTML = '';
  }
  db.auth.onAuthStateChange(function (_e, session) {
    var id = session ? session.user.id : null;
    if (id === last && last !== undefined) return;
    if (!session) { showSignedOut(); return; }
    last = id;
    $('signin').hidden = true; $('who').hidden = false;
    $('app').hidden = true; $('not-admin').hidden = true; $('loading').hidden = true;
    $('who-email').textContent = session.user.email; start();
  });
})();
