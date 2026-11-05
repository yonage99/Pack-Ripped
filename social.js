/* Pack Ripped: friends, shared collections/decks, steps leaderboard (Supabase). */
(function () {
  'use strict';

  const PR = window.PR;
  const C = window.Commander;
  const { esc, toast, money, cardPrice } = PR;
  const cfg = window.PACKRIPPED_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const root = () => document.getElementById('friendsRoot');

  const sb = configured
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'packripped:auth' },
      })
    : null;

  let me = null; // { username }
  let view = { mode: 'home', board: { period: 'today', scope: 'friends' }, authTab: 'signup' };
  let overview = null;
  let lastSync = null;
  let syncTimer = null;
  let syncing = false;
  let dirty = true;

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmt = (n) => Math.floor(n || 0).toLocaleString();
  const clean = (u) => String(u || '').trim().toLowerCase().replace(/^@/, '');
  const validName = (u) => /^[a-z0-9_]{3,20}$/.test(u);
  const emailFor = (u) => `${u}@${cfg.usernameEmailDomain || 'users.packripped.app'}`;
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  };

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }

  // ---------- syncing your data up ----------
  function myStepsToday() {
    const s = PR.state.steps || {};
    return s.date === today() ? Math.max(s.sensor || 0, s.manual || 0) : 0;
  }

  function snapshot() {
    const collection = {};
    let cards = 0, value = 0;
    for (const [id, e] of Object.entries(PR.state.collection)) {
      const c = e.card;
      collection[id] = {
        n: e.n, f: e.f,
        card: {
          id: c.id, name: c.name, set: c.set, setName: c.setName, num: c.num, rarity: c.rarity, type: c.type,
          front: c.front, img: c.img, usd: c.usd, usdFoil: c.usdFoil, treat: c.treat, ci: c.ci, cmc: c.cmc, mana: c.mana,
          game: c.game, rarityLabel: c.rarityLabel, uri: c.uri,
        },
      };
      cards += e.n + e.f;
      value += e.n * cardPrice(c, false) + e.f * cardPrice(c, true);
    }
    const stats = {
      packs: PR.state.packsOpened || 0,
      cards,
      unique: Object.keys(collection).length,
      value: Math.round(value * 100) / 100,
      decks: (PR.state.decks || []).length,
    };
    return { collection, decks: PR.state.decks || [], stats };
  }

  async function syncNow() {
    if (!sb || !me || syncing) return;
    syncing = true;
    try {
      const steps = myStepsToday();
      if (steps > 0) await rpc('log_steps', { p_day: today(), p_steps: steps });
      // Completed trades change this phone's collection (and can free deck slots).
      if (window.PRTrades && (await window.PRTrades.applyEvents())) dirty = true;
      if (dirty) {
        // Older cards may lack color/deck info; fill it in so friends see it correctly.
        if (window.PRDecks && window.PRDecks.ensureCardData) await window.PRDecks.ensureCardData();
        const push = () => {
          const s = snapshot();
          return rpc('push_data', { p_collection: s.collection, p_decks: s.decks, p_stats: s.stats, p_events_seen: PR.state.tradeSeen || 0 });
        };
        dirty = false;
        try {
          await push();
        } catch (e) {
          // A trade finished while we were syncing: apply it, then send again.
          if (!/TRADES_PENDING/.test((e && e.message) || '') || !window.PRTrades) throw e;
          await window.PRTrades.applyEvents();
          await push();
        }
      }
      lastSync = Date.now();
      const el = document.getElementById('frSync');
      if (el) el.textContent = 'Synced ' + ago(lastSync);
    } catch (e) {
      dirty = true;
      const el = document.getElementById('frSync');
      if (el) el.textContent = "Couldn't sync. Will retry.";
    } finally {
      syncing = false;
    }
  }

  async function syncFresh() {
    dirty = true;
    for (let i = 0; i < 20 && syncing; i++) await new Promise((r) => setTimeout(r, 150));
    await syncNow();
  }

  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, delay);
  }

  if (configured) {
    PR.onSave = () => {
      dirty = true;
      if (me) scheduleSync(8000);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && me) syncNow();
    });
    setInterval(() => me && document.visibilityState === 'visible' && syncNow(), 120000);
  }

  // ---------- auth ----------
  async function loadMe() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    if (!data.session) return (me = null);
    try {
      me = await rpc('my_profile');
    } catch {
      me = null;
    }
    if (me) {
      dirty = true;
      syncNow();
    }
    return me;
  }

  function friendlyError(e) {
    const m = String((e && (e.message || e.error_description)) || e || '');
    if (/invalid login credentials/i.test(m)) return 'Wrong username or password.';
    if (/already registered|already exists/i.test(m)) return 'That username is taken.';
    if (/password/i.test(m) && /6|characters|short/i.test(m)) return 'Password must be at least 6 characters.';
    if (/email.*invalid|invalid.*email/i.test(m)) return 'The server rejected the sign-up email format. See SETUP-FRIENDS.md, step 3.';
    if (/not confirmed/i.test(m)) return 'The server needs "Confirm email" turned off. See SETUP-FRIENDS.md.';
    if (/fetch|network/i.test(m)) return 'No connection to the server.';
    return m || 'Something went wrong.';
  }

  // ---------- rendering ----------
  async function render() {
    const r = root();
    if (!r) return;
    if (!configured) return renderNotConfigured();
    if (me === null && !view.checked) {
      r.innerHTML = `<div class="card-panel"><div class="spinner"></div></div>`;
      view.checked = true;
      await loadMe();
    }
    if (!me) return renderAuth();
    if (view.mode === 'friend') return renderFriend(view.friend);
    return renderHome();
  }

  function renderNotConfigured() {
    root().innerHTML = `
      <div class="card-panel">
        <h2>Friends &amp; leaderboard</h2>
        <p>Add friends by username, look through each other's collections and decks, and see who walks the most.</p>
        <p class="muted small">This needs a free online server that isn't connected yet. The person who runs this app sets it up once, following <b>SETUP-FRIENDS.md</b> in the project. Everything else in the app keeps working without it.</p>
      </div>`;
  }

  function renderAuth() {
    const signup = view.authTab === 'signup';
    root().innerHTML = `
      <div class="card-panel">
        <h2>Friends &amp; leaderboard</h2>
        <p class="muted small">Create an account to add friends, share your collection and decks, and get on the steps leaderboard.</p>
        <div class="seg">
          <button data-t="signup" class="${signup ? 'on' : ''}">Create account</button>
          <button data-t="login" class="${!signup ? 'on' : ''}">Log in</button>
        </div>
        <form id="authForm" class="col">
          <input id="auUser" placeholder="Username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="20" required>
          <input id="auPass" type="password" placeholder="Password (6+ characters)" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required>
          <button class="btn primary" type="submit" id="auGo">${signup ? 'Create account' : 'Log in'}</button>
        </form>
        <p class="muted small" id="auMsg">${
          signup
            ? 'Usernames: 3 to 20 letters, numbers or _. No email needed. Write your password down: it can’t be reset.'
            : ''
        }</p>
      </div>`;
    root().querySelectorAll('.seg button').forEach(
      (b) => (b.onclick = () => {
        view.authTab = b.dataset.t;
        renderAuth();
      })
    );
    document.getElementById('authForm').onsubmit = async (e) => {
      e.preventDefault();
      const u = clean(document.getElementById('auUser').value);
      const p = document.getElementById('auPass').value;
      const msg = document.getElementById('auMsg');
      const go = document.getElementById('auGo');
      msg.className = 'small bad';
      if (!validName(u)) return (msg.textContent = 'Usernames are 3 to 20 letters, numbers or _.');
      if (p.length < 6) return (msg.textContent = 'Password must be at least 6 characters.');
      go.disabled = true;
      try {
        if (signup) {
          const free = await rpc('username_available', { p_username: u });
          if (!free) throw new Error('That username is taken.');
          const { data, error } = await sb.auth.signUp({ email: emailFor(u), password: p, options: { data: { username: u } } });
          if (error) throw error;
          if (!data.session) throw new Error('not confirmed');
        } else {
          const { error } = await sb.auth.signInWithPassword({ email: emailFor(u), password: p });
          if (error) throw error;
        }
        await loadMe();
        if (!me) throw new Error('Signed in, but your profile is missing. Was supabase/setup.sql run?');
        toast(signup ? `Welcome, @${me.username}!` : `Hi @${me.username}`);
        view.mode = 'home';
        render();
      } catch (err) {
        msg.textContent = friendlyError(err);
        go.disabled = false;
      }
    };
  }

  async function renderHome() {
    const r = root();
    r.innerHTML = `
      <div class="card-panel">
        <div class="panel-head">
          <h2>@${esc(me.username)}</h2>
          <button class="link-btn" id="frLogout">Log out</button>
        </div>
        <p class="muted small" id="frSync">${lastSync ? 'Synced ' + ago(lastSync) : 'Syncing…'}</p>
        <p class="muted small">Your friends can see your collection, decks and steps.</p>
      </div>
      <div class="card-panel">
        <div class="panel-head"><h2>🏆 Steps leaderboard</h2></div>
        <div class="seg small-seg" id="lbPeriod">
          ${[['today', 'Today'], ['week', '7 days'], ['all', 'All time']]
            .map(([k, l]) => `<button data-v="${k}" class="${view.board.period === k ? 'on' : ''}">${l}</button>`)
            .join('')}
        </div>
        <div class="seg small-seg" id="lbScope">
          ${[['friends', 'Friends'], ['everyone', 'Everyone']]
            .map(([k, l]) => `<button data-v="${k}" class="${view.board.scope === k ? 'on' : ''}">${l}</button>`)
            .join('')}
        </div>
        <ol class="board" id="lbList"><li class="muted">Loading…</li></ol>
        <p class="muted small">Counts the steps you track or sync on the Earn tab.</p>
      </div>
      <div class="card-panel">
        <div class="panel-head"><h2>Add a friend</h2></div>
        <form id="addFriend" class="row" style="margin-top:0">
          <input id="afName" placeholder="Their username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="21">
          <button class="btn primary" type="submit" style="flex:none">Add</button>
        </form>
        <p class="muted small">Your username is <b>@${esc(me.username)}</b>. Share it so friends can add you.</p>
      </div>
      <div id="frTrades"></div>
      <div id="frLists"><div class="card-panel"><div class="spinner"></div></div></div>`;

    document.getElementById('frLogout').onclick = async () => {
      await syncNow();
      await sb.auth.signOut();
      me = null;
      overview = null;
      view = { mode: 'home', board: view.board, authTab: 'login', checked: true };
      render();
    };
    document.getElementById('lbPeriod').querySelectorAll('button').forEach(
      (b) => (b.onclick = () => {
        view.board.period = b.dataset.v;
        renderHome();
      })
    );
    document.getElementById('lbScope').querySelectorAll('button').forEach(
      (b) => (b.onclick = () => {
        view.board.scope = b.dataset.v;
        renderHome();
      })
    );
    document.getElementById('addFriend').onsubmit = async (e) => {
      e.preventDefault();
      const u = clean(document.getElementById('afName').value);
      if (!validName(u)) return toast('Enter a valid username');
      try {
        const res = await rpc('send_friend_request', { p_username: u });
        const msgs = {
          sent: `Friend request sent to @${u}`,
          accepted: `You and @${u} are now friends!`,
          already: `You're already friends with @${u}`,
          not_found: `No one is called @${u}`,
          self: "That's you!",
        };
        toast(msgs[res] || res);
        document.getElementById('afName').value = '';
        loadLists();
      } catch (err) {
        toast(friendlyError(err));
      }
    };

    // Make sure today's steps are on the board before loading it.
    await syncNow();
    loadBoard();
    loadLists();
    if (window.PRTrades) window.PRTrades.renderPanel(document.getElementById('frTrades'));
  }

  async function loadBoard() {
    const list = document.getElementById('lbList');
    if (!list) return;
    try {
      const rows = await rpc('leaderboard', { p_scope: view.board.scope, p_period: view.board.period, p_day: today() });
      const medal = (n) => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : n);
      list.innerHTML =
        (rows || [])
          .map(
            (r) => `<li class="${r.me ? 'me' : ''}">
              <span class="rk">${medal(Number(r.rank))}</span>
              <span class="nm">@${esc(r.username)}${r.me ? ' (you)' : ''}</span>
              <span class="st">${fmt(r.steps)}</span>
            </li>`
          )
          .join('') ||
        `<li class="muted">${view.board.scope === 'friends' ? 'Add friends to compete!' : 'No steps yet.'}</li>`;
      if (view.board.scope === 'friends' && (rows || []).length <= 1)
        list.insertAdjacentHTML('beforeend', '<li class="muted small">Add friends to see them here.</li>');
    } catch (err) {
      list.innerHTML = `<li class="bad small">${esc(friendlyError(err))}</li>`;
    }
  }

  async function loadLists() {
    const box = document.getElementById('frLists');
    if (!box) return;
    try {
      overview = await rpc('friends_overview', { p_day: today() });
    } catch (err) {
      box.innerHTML = `<div class="card-panel"><p class="bad small">${esc(friendlyError(err))}</p></div>`;
      return;
    }
    const o = overview || { friends: [], incoming: [], outgoing: [] };
    box.innerHTML = `
      ${
        o.incoming.length
          ? `<div class="card-panel"><div class="panel-head"><h2>Friend requests</h2><span class="badge">${o.incoming.length}</span></div>
            <ul class="people">${o.incoming
              .map(
                (u) => `<li data-u="${esc(u)}"><span class="avatar">${esc(u[0].toUpperCase())}</span><b>@${esc(u)}</b>
                <button class="btn small-btn primary" data-a="yes">Accept</button><button class="btn small-btn" data-a="no">✕</button></li>`
              )
              .join('')}</ul></div>`
          : ''
      }
      <div class="card-panel">
        <div class="panel-head"><h2>Friends</h2><span class="muted">${o.friends.length}</span></div>
        <ul class="people">${
          o.friends
            .map(
              (f) => `<li class="friend" data-u="${esc(f.username)}">
              <span class="avatar">${esc(f.username[0].toUpperCase())}</span>
              <span class="pmeta"><b>@${esc(f.username)}</b>
                <small>${fmt((f.stats || {}).cards)} cards · ${money((f.stats || {}).value)} · ${fmt((f.stats || {}).decks)} decks</small>
                <small>👟 ${fmt(f.steps_today)} today · updated ${ago(f.updated_at)}</small></span>
              <span class="chev">›</span>
            </li>`
            )
            .join('') || '<li class="muted">No friends yet. Add someone by username above.</li>'
        }</ul>
      </div>
      ${
        o.outgoing.length
          ? `<div class="card-panel"><div class="panel-head"><h2>Waiting for them</h2></div>
            <ul class="people">${o.outgoing
              .map(
                (u) => `<li data-u="${esc(u)}"><span class="avatar dim">${esc(u[0].toUpperCase())}</span><b>@${esc(u)}</b>
                <button class="btn small-btn" data-a="cancel">Cancel</button></li>`
              )
              .join('')}</ul></div>`
          : ''
      }`;
    box.querySelectorAll('li[data-u]').forEach((li) => {
      const u = li.dataset.u;
      const act = async (fn, args, msg) => {
        try {
          await rpc(fn, args);
          if (msg) toast(msg);
          loadLists();
          loadBoard();
        } catch (err) {
          toast(friendlyError(err));
        }
      };
      const yes = li.querySelector('[data-a=yes]');
      if (yes) yes.onclick = () => act('respond_friend_request', { p_username: u, p_accept: true }, `You and @${u} are now friends!`);
      const no = li.querySelector('[data-a=no]');
      if (no) no.onclick = () => act('respond_friend_request', { p_username: u, p_accept: false });
      const cancel = li.querySelector('[data-a=cancel]');
      if (cancel) cancel.onclick = () => act('remove_friend', { p_username: u });
      if (li.classList.contains('friend'))
        li.onclick = () => {
          view = { ...view, mode: 'friend', friend: u, ftab: 'decks', fq: '', fdeck: null };
          render();
          window.scrollTo(0, 0);
        };
    });
  }

  // ---------- a friend's profile ----------
  const friendCache = {};
  async function renderFriend(u) {
    const r = root();
    let d = friendCache[u];
    if (!d) {
      r.innerHTML = `<div class="card-panel"><div class="spinner"></div><p class="muted center-text">Loading @${esc(u)}…</p></div>`;
      try {
        d = await rpc('friend_data', { p_username: u });
      } catch (err) {
        d = null;
      }
      if (!d) {
        r.innerHTML = `<div class="card-panel"><button class="link-btn" id="fBack">‹ Friends</button>
          <p>You can only see friends' collections. Has @${esc(u)} accepted your request?</p></div>`;
        document.getElementById('fBack').onclick = backHome;
        return;
      }
      friendCache[u] = d;
      setTimeout(() => delete friendCache[u], 60000);
    }
    const st = d.stats || {};
    const decks = d.decks || [];
    r.innerHTML = `
      <div class="card-panel">
        <div class="panel-head"><button class="link-btn" id="fBack">‹ Friends</button><button class="link-btn" id="fRemove">Unfriend</button></div>
        <div class="friend-head"><span class="avatar big">${esc(u[0].toUpperCase())}</span><div><h2>@${esc(u)}</h2>
          <small class="muted">Updated ${ago(d.updated_at)}</small></div></div>
        <div class="stats-row" style="margin-top:12px">
          <div><b>${fmt(st.cards)}</b><small>cards</small></div>
          <div><b>${fmt(st.unique)}</b><small>unique</small></div>
          <div><b>${money(st.value)}</b><small>value</small></div>
          <div><b>${fmt(st.packs)}</b><small>packs</small></div>
        </div>
        <button class="btn primary wide" id="fTrade">⇄ Propose a trade</button>
      </div>
      <div class="seg tabs-seg">
        <button data-t="decks" class="${view.ftab === 'decks' ? 'on' : ''}">Decks (${decks.length})</button>
        <button data-t="collection" class="${view.ftab === 'collection' ? 'on' : ''}">Collection</button>
      </div>
      <div id="fBody"></div>`;
    document.getElementById('fBack').onclick = backHome;
    document.getElementById('fTrade').onclick = () => window.PRTrades && window.PRTrades.compose(u, d);
    document.getElementById('fRemove').onclick = () =>
      PR.dialog(
        `<h3>Unfriend @${esc(u)}?</h3><p class="muted">You'll stop seeing each other's collections and decks.</p>
        <div class="row"><button class="btn" id="unNo">Cancel</button><button class="btn danger" id="unYes">Unfriend</button></div>`,
        (close) => {
          document.getElementById('unNo').onclick = close;
          document.getElementById('unYes').onclick = async () => {
            close();
            try {
              await rpc('remove_friend', { p_username: u });
              toast(`Removed @${u}`);
            } catch (err) {
              toast(friendlyError(err));
            }
            backHome();
          };
        }
      );
    root().querySelectorAll('.tabs-seg button').forEach(
      (b) => (b.onclick = () => {
        view.ftab = b.dataset.t;
        view.fdeck = null;
        renderFriend(u);
      })
    );
    if (view.ftab === 'collection') friendCollection(d);
    else if (view.fdeck != null && decks[view.fdeck]) friendDeck(d, decks[view.fdeck]);
    else friendDecks(d);
  }

  function backHome() {
    view = { ...view, mode: 'home', friend: null };
    render();
    window.scrollTo(0, 0);
  }

  const fcard = (d, id) => ((d.collection || {})[id] || {}).card || null;

  function friendDecks(d) {
    const decks = d.decks || [];
    const body = document.getElementById('fBody');
    body.innerHTML =
      decks
        .map((deck, i) => {
          const cm = (deck.commanders || []).map((id) => fcard(d, id)).filter(Boolean);
          const count =
            (deck.commanders || []).length +
            Object.values(deck.cards || {}).reduce((s, n) => s + n, 0) +
            Object.values(deck.basics || {}).reduce((s, n) => s + n, 0);
          const ident = C.identityOf(cm);
          return `<button class="deck-item" data-i="${i}">
            <div class="deck-art">${cm.map((c) => `<img src="${esc(c.img)}" alt="">`).join('')}</div>
            <div class="deck-meta"><b>${esc(deck.name)}</b>
              <span>${ident ? ident.split('').map((x) => `<span class="pip pip-${x}">${x}</span>`).join('') : '<span class="pip pip-C">C</span>'}</span>
              <small>${count}/100 cards</small></div>
          </button>`;
        })
        .join('') || `<div class="card-panel"><p class="muted">No decks yet.</p></div>`;
    body.querySelectorAll('.deck-item').forEach(
      (b) => (b.onclick = () => {
        view.fdeck = Number(b.dataset.i);
        renderFriend(d.username);
        window.scrollTo(0, 0);
      })
    );
  }

  function friendDeck(d, deck) {
    const cm = (deck.commanders || []).map((id) => fcard(d, id)).filter(Boolean);
    const groups = {};
    for (const [id, n] of Object.entries(deck.cards || {})) {
      const c = fcard(d, id);
      if (!c) continue;
      const g = C.typeGroup(c.front || c.type);
      (groups[g] = groups[g] || []).push({ c, n, id });
    }
    const basics = C.BASICS.filter((b) => (deck.basics || {})[b.name]);
    const order = ['Creatures', 'Planeswalkers', 'Battles', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Other'];
    const text = [
      'Commander',
      ...cm.map((c) => `1 ${c.name}`),
      '',
      'Deck',
      ...Object.entries(deck.cards || {})
        .map(([id, n]) => (fcard(d, id) ? `${n} ${fcard(d, id).name}` : null))
        .filter(Boolean),
      ...basics.map((b) => `${deck.basics[b.name]} ${b.name}`),
    ].join('\n');
    const body = document.getElementById('fBody');
    body.innerHTML = `
      <div class="card-panel">
        <button class="link-btn" id="fdBack">‹ All decks</button>
        <h2 style="margin-top:6px">${esc(deck.name)}</h2>
        <div class="cmdr-row">${cm.map((c) => `<div class="cmdr" data-id="${esc(c.id)}"><img src="${esc(c.img)}" alt="${esc(c.name)}"></div>`).join('')}</div>
        <button class="btn wide" id="fdCopy">Copy decklist (for Moxfield)</button>
      </div>
      ${order
        .filter((g) => groups[g])
        .map(
          (g) => `<div class="card-panel"><div class="panel-head"><h2>${g}</h2><span class="muted">${groups[g].reduce((s, x) => s + x.n, 0)}</span></div>
          <ul class="dl">${groups[g]
            .sort((a, b) => (a.c.cmc || 0) - (b.c.cmc || 0) || a.c.name.localeCompare(b.c.name))
            .map(({ c, n, id }) => `<li data-id="${esc(id)}"><span class="dl-n">${n}</span><span class="dl-name"><span class="rarity-dot ${c.rarity}"></span>${esc(c.name)}</span></li>`)
            .join('')}</ul></div>`
        )
        .join('')}
      ${
        basics.length
          ? `<div class="card-panel"><div class="panel-head"><h2>Basic lands</h2></div><ul class="dl">${basics
              .map((b) => `<li><span class="dl-n">${deck.basics[b.name]}</span><span class="dl-name">${b.name}</span></li>`)
              .join('')}</ul></div>`
          : ''
      }`;
    document.getElementById('fdBack').onclick = () => {
      view.fdeck = null;
      renderFriend(d.username);
    };
    document.getElementById('fdCopy').onclick = () =>
      navigator.clipboard.writeText(text).then(
        () => toast('Decklist copied'),
        () => toast("Couldn't copy on this browser")
      );
    body.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => showFriendCard(d, el.dataset.id)));
  }

  function friendCollection(d) {
    const all = Object.values(d.collection || {});
    const q = (view.fq || '').toLowerCase();
    const val = (e) => Math.max(e.n ? cardPrice(e.card, false) : 0, e.f ? cardPrice(e.card, true) : 0);
    const list = all.filter((e) => !q || e.card.name.toLowerCase().includes(q)).sort((a, b) => val(b) - val(a));
    const body = document.getElementById('fBody');
    body.innerHTML = `
      <div class="card-panel"><input type="search" id="fq" placeholder="Search @${esc(d.username)}'s cards…" value="${esc(view.fq || '')}">
        <p class="muted small">Sorted by value · ${list.length} cards</p></div>
      <div class="grid">${
        list
          .slice(0, 300)
          .map(
            (e) => `<div class="mini ${e.card.rarity} ${e.f ? 'is-foil' : ''}" data-id="${esc(e.card.id)}">
            <img src="${esc(e.card.img)}" alt="${esc(e.card.name)}" loading="lazy">${e.f ? '<div class="foil-sheen"></div>' : ''}
            <span class="qty">×${e.n + e.f}</span></div>`
          )
          .join('') || '<div class="empty"><p class="muted">No cards.</p></div>'
      }</div>`;
    const s = document.getElementById('fq');
    s.oninput = () => {
      view.fq = s.value;
      const pos = s.selectionStart;
      friendCollection(d);
      const s2 = document.getElementById('fq');
      s2.focus();
      s2.setSelectionRange(pos, pos);
    };
    body.querySelectorAll('.mini').forEach((m) => (m.onclick = () => showFriendCard(d, m.dataset.id)));
  }

  function showFriendCard(d, id) {
    const e = (d.collection || {})[id];
    if (!e) return;
    const c = e.card;
    const mine = PR.state.collection[id];
    const m = document.getElementById('cardModal');
    document.getElementById('cardModalInner').innerHTML = `
      <div class="detail ${e.f ? 'is-foil' : ''}"><img src="${esc(c.img)}" alt="${esc(c.name)}">${e.f ? '<div class="foil-sheen"></div>' : ''}</div>
      <h3>${esc(c.name)}</h3>
      <p><span class="rarity-dot ${c.rarity}"></span>${PR.cap(c.rarity)}${c.treat ? ' · ' + esc(c.treat) : ''} · ${esc(c.setName)} #${esc(c.num)}</p>
      <table class="odds">
        <tr><td>@${esc(d.username)}</td><td>×${e.n} regular · ×${e.f} foil</td></tr>
        <tr><td>You</td><td>${mine ? `×${mine.n} regular · ×${mine.f} foil` : "You don't have this printing"}</td></tr>
        <tr><td>Price</td><td>${money(c.usd)} · foil ${money(c.usdFoil)}</td></tr>
      </table>
      <div class="row center"><button class="btn primary" id="fcClose">Close</button></div>`;
    m.classList.remove('hidden');
    const close = () => m.classList.add('hidden');
    document.getElementById('fcClose').onclick = close;
    m.onclick = (ev) => {
      if (ev.target === m) close();
    };
  }

  // Sign the user back in quietly on startup so syncing starts right away.
  if (configured) loadMe();

  window.PRSocial = {
    render, syncNow, syncFresh, rpc, configured,
    friendCacheClear: (u) => delete friendCache[u],
    get me() { return me; },
  };
})();
