/* Pack Ripped: Pack Wars. Rip a pack, add basic lands, battle a friend online or on one phone. */
(function () {
  'use strict';

  const PR = window.PR;
  const E = window.PackWarsEngine;
  const { esc, toast, dialog } = PR;
  const ODDS = window.PackOdds.ODDS;
  const boosterTypeFor = window.PackOdds.boosterTypeFor;
  const LOCAL_KEY = 'packripped:pwlocal';
  const PULLS_KEY = 'packripped:pwpulls:';
  const root = () => document.getElementById('pwRoot');
  const social = () => window.PRSocial || {};
  const online = () => !!(social().configured && social().me);
  const rpc = (fn, args) => social().rpc(fn, args);

  let ui = { screen: 'home' };
  let game = null; // current game model (see toModel)
  let poll = null;
  let busy = false;

  const lsGet = (k) => {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  };
  const lsSet = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };
  const lsDel = (k) => {
    try { localStorage.removeItem(k); } catch {}
  };

  function basicArt() {
    try { return JSON.parse(localStorage.getItem('packripped:basics')) || {}; } catch { return {}; }
  }

  function stopPoll() {
    clearInterval(poll);
    poll = null;
  }

  function go(screen, extra) {
    stopPoll();
    ui = { screen, ...(extra || {}) };
    render();
    window.scrollTo(0, 0);
  }

  // ======================= HOME =======================
  async function render() {
    if (!root()) return;
    if (ui.screen === 'home') return renderHome();
    if (ui.screen === 'pickSet') return renderPickSet();
    if (ui.screen === 'pickFriend') return renderPickFriend();
    if (ui.screen === 'build') return renderBuild();
    if (ui.screen === 'table') return renderTable();
    if (ui.screen === 'pass') return renderPass();
  }

  async function renderHome() {
    const local = lsGet(LOCAL_KEY);
    const s = social();
    root().innerHTML = `
      <div class="card-panel">
        <button class="link-btn" id="pwBack">‹ Open packs</button>
        <h2 style="margin-top:6px">⚔ Pack Wars</h2>
        <p class="small">Each player rips a fresh pack, adds basic lands to make a 30-card deck, shuffles, and draws 7. Everyone starts at 20 life. Play by normal Magic rules: the app is your table and moves only your own cards.</p>
        <p class="muted small">Every pack costs ${PR.costFor('play')} ◆ and goes into your collection.</p>
      </div>
      <div class="card-panel">
        <div class="panel-head"><h2>Online vs. a friend</h2></div>
        ${
          !s.configured
            ? '<p class="muted small">Needs the Friends server, which isn\'t connected yet (see SETUP-FRIENDS.md). You can still play on one phone below.</p>'
            : !s.me
            ? '<p class="muted small">Sign in on the Friends tab to challenge friends.</p><button class="btn wide" id="pwSignIn">Go to Friends</button>'
            : '<button class="btn primary wide" id="pwChallenge">Challenge a friend</button><div id="pwGames"><div class="spinner"></div></div>'
        }
      </div>
      <div class="card-panel">
        <div class="panel-head"><h2>Two players, one phone</h2></div>
        ${
          local
            ? `<p class="small">${esc(local.players[0].name)} vs ${esc(local.players[1].name)} · ${esc(local.set.name)} · ${
                local.status === 'done' ? `${esc(local.players[local.winner].name)} won` : local.status === 'playing' ? `turn ${local.turnNumber}` : 'building decks'
              }</p>
              <div class="row"><button class="btn" id="pwLocalQuit">${local.status === 'done' ? 'Clear' : 'Abandon'}</button>
              ${local.status !== 'done' ? '<button class="btn primary" id="pwLocalGo">Continue</button>' : ''}</div>`
            : `<p class="muted small">Pass the phone back and forth. Both packs are paid for from this phone and go into this phone's collection.</p>
              <button class="btn wide" id="pwLocalNew">Start a game on this phone</button>`
        }
      </div>`;
    document.getElementById('pwBack').onclick = () => PR.showView('open');
    const si = document.getElementById('pwSignIn');
    if (si) si.onclick = () => PR.showView('friends');
    const ch = document.getElementById('pwChallenge');
    if (ch) ch.onclick = () => go('pickFriend');
    const ln = document.getElementById('pwLocalNew');
    if (ln) ln.onclick = () => go('pickSet', { mode: 'local' });
    const lg = document.getElementById('pwLocalGo');
    if (lg) lg.onclick = () => resumeLocal();
    const lq = document.getElementById('pwLocalQuit');
    if (lq) lq.onclick = () => {
      lsDel(LOCAL_KEY);
      renderHome();
    };
    if (online()) loadGames();
  }

  async function loadGames() {
    const box = document.getElementById('pwGames');
    if (!box) return;
    let list = [];
    try {
      list = (await rpc('pw_list')) || [];
    } catch (e) {
      box.innerHTML = `<p class="bad small">Couldn't load games.</p>`;
      return;
    }
    const done = list.filter((g) => g.status === 'done');
    const wins = done.filter((g) => g.winner === 'me').length;
    const row = (g, label, btns) => `<li data-id="${esc(g.id)}">
        <span class="avatar">${esc((g.opponent || '?')[0].toUpperCase())}</span>
        <span class="pmeta"><b>@${esc(g.opponent)}</b><small>${esc((g.set && g.set.name) || '')} · ${label}</small></span>${btns}</li>`;
    const active = list.filter((g) => g.status !== 'done');
    box.innerHTML = `
      ${done.length ? `<p class="small" style="margin-top:12px">Your record: <b class="ok">${wins} W</b> · <b class="bad">${done.length - wins} L</b></p>` : ''}
      <ul class="people">${
        active
          .map((g) => {
            if (g.status === 'invited' && !g.host)
              return row(g, 'challenged you!', '<button class="btn small-btn primary" data-a="accept">Accept</button><button class="btn small-btn" data-a="decline">✕</button>');
            if (!g.my_ready) return row(g, g.status === 'invited' ? 'waiting for them to accept' : 'open your pack', '<button class="btn small-btn primary" data-a="open">Open pack</button>');
            if (g.status === 'invited') return row(g, 'waiting for them to accept', '<button class="btn small-btn" data-a="cancel">Cancel</button>');
            if (g.status === 'building') return row(g, 'waiting for them to build', '<button class="btn small-btn" data-a="play">View</button>');
            return row(g, g.my_turn ? `<b class="ok">your turn</b> · turn ${g.turn_number}` : `their turn · turn ${g.turn_number}`, '<button class="btn small-btn primary" data-a="play">Play</button>');
          })
          .join('') || '<li class="muted small">No games yet. Challenge a friend!</li>'
      }</ul>
      ${
        done.length
          ? `<details class="manual"><summary>Recent results</summary><ul class="people">${done
              .slice(0, 10)
              .map((g) => row(g, g.winner === 'me' ? '<b class="ok">You won</b>' : '<b class="bad">You lost</b>', ''))
              .join('')}</ul></details>`
          : ''
      }`;
    box.querySelectorAll('li[data-id]').forEach((li) => {
      const g = list.find((x) => x.id === li.dataset.id);
      const on = (a, fn) => {
        const b = li.querySelector(`[data-a=${a}]`);
        if (b) b.onclick = fn;
      };
      on('accept', () => payAndOpen(g, true));
      on('open', () => payAndOpen(g, false));
      on('decline', async () => {
        await rpc('pw_respond', { p_game: g.id, p_accept: false }).catch(() => {});
        loadGames();
      });
      on('cancel', async () => {
        await rpc('pw_leave', { p_game: g.id }).catch(() => {});
        loadGames();
      });
      on('play', () => openOnline(g.id));
    });
  }

  // ======================= SET / FRIEND PICKERS =======================
  async function renderPickSet() {
    root().innerHTML = `<div class="card-panel"><button class="link-btn" id="psBack">‹ Back</button>
      <h2 style="margin-top:6px">Pick the set</h2>
      <p class="muted small">${ui.mode === 'online' ? `You and @${esc(ui.friend)} will each open` : 'Both players open'} one regular pack from this set.</p>
      <input type="search" id="psSearch" placeholder="Search sets…"></div>
      <div id="psList" class="card-panel"><div class="spinner"></div></div>`;
    document.getElementById('psBack').onclick = () => go(ui.mode === 'online' ? 'pickFriend' : 'home');
    const sets = await PR.getSets();
    const draw = () => {
      const q = document.getElementById('psSearch').value.trim().toLowerCase();
      const list = sets.filter((s) => !q || s.name.toLowerCase().includes(q));
      document.getElementById('psList').innerHTML = list
        .map(
          (s) => `<button class="set-item" data-code="${esc(s.code)}"><img class="set-icon" src="${esc(s.icon)}" alt="" loading="lazy">
          <span class="set-meta"><b>${esc(s.name)}</b><small>${esc(s.released.slice(0, 4))} · ${ODDS[boosterTypeFor(s.released)].name}</small></span></button>`
        )
        .join('');
      document.querySelectorAll('#psList .set-item').forEach(
        (b) => (b.onclick = () => chooseSet(sets.find((s) => s.code === b.dataset.code)))
      );
    };
    document.getElementById('psSearch').oninput = draw;
    draw();
  }

  function chooseSet(set) {
    const type = boosterTypeFor(set.released);
    const cost = PR.costFor(type);
    const info = { code: set.code, name: set.name, icon: set.icon, released: set.released, type };
    const have = PR.state.points;
    const need = ui.mode === 'local' ? cost * 2 : cost;
    dialog(
      `<img class="set-icon big" src="${esc(set.icon)}" alt=""><h3>${esc(set.name)}</h3>
      <p>${ui.mode === 'local' ? `Two ${ODDS[type].name}s, ${cost} ◆ each (${need} ◆ total).` : `Challenge @${esc(ui.friend)}. Your ${ODDS[type].name} costs ${cost} ◆.`}</p>
      ${ui.mode === 'local' ? `<div class="col"><input id="p1n" placeholder="Player 1 name" maxlength="16" value="Player 1"><input id="p2n" placeholder="Player 2 name" maxlength="16" value="Player 2"></div>` : ''}
      <div class="row"><button class="btn" id="csNo">Cancel</button>
      <button class="btn primary" id="csYes" ${have >= need ? '' : 'disabled'}>${have >= need ? (ui.mode === 'local' ? 'Start' : 'Send challenge') : `Need ${need - have} more ◆`}</button></div>`,
      (close) => {
        document.getElementById('csNo').onclick = close;
        document.getElementById('csYes').onclick = async () => {
          close();
          if (ui.mode === 'local') {
            const names = [document.getElementById('p1n').value.trim() || 'Player 1', document.getElementById('p2n').value.trim() || 'Player 2'];
            const g = { id: 'local', set: info, players: names.map((name) => ({ name, state: null, pulls: null })), status: 'building', turn: 0, turnNumber: 0, log: [], winner: null };
            lsSet(LOCAL_KEY, g);
            resumeLocal();
          } else {
            try {
              const gid = await rpc('pw_create', { p_friend: ui.friend, p_set: info });
              toast(`Challenge sent to @${ui.friend}`);
              payAndOpen({ id: gid, set: info, host: true, status: 'invited' }, false);
            } catch (e) {
              toast((e && e.message) || "Couldn't create the game");
            }
          }
        };
      }
    );
  }

  async function renderPickFriend() {
    root().innerHTML = `<div class="card-panel"><button class="link-btn" id="pfBack">‹ Back</button>
      <h2 style="margin-top:6px">Challenge who?</h2><ul class="people" id="pfList"><li><div class="spinner"></div></li></ul></div>`;
    document.getElementById('pfBack').onclick = () => go('home');
    let o;
    try {
      o = await rpc('friends_overview', { p_day: new Date().toISOString().slice(0, 10) });
    } catch {
      o = { friends: [] };
    }
    const list = document.getElementById('pfList');
    list.innerHTML =
      (o.friends || [])
        .map((f) => `<li class="friend" data-u="${esc(f.username)}"><span class="avatar">${esc(f.username[0].toUpperCase())}</span><b>@${esc(f.username)}</b><span class="chev">›</span></li>`)
        .join('') || '<li class="muted small">Add friends on the Friends tab first.</li>';
    list.querySelectorAll('li[data-u]').forEach((li) => (li.onclick = () => go('pickSet', { mode: 'online', friend: li.dataset.u })));
  }

  // ======================= OPENING + DECK BUILDING =======================
  function setObj(info) {
    return { code: info.code, name: info.name, icon: info.icon, released: info.released };
  }

  /** Pay for and rip a pack for an online game (or reuse one already ripped for it). */
  async function payAndOpen(g, accept) {
    if (accept) {
      try {
        await rpc('pw_respond', { p_game: g.id, p_accept: true });
      } catch (e) {
        return toast((e && e.message) || "Couldn't accept");
      }
    }
    const saved = lsGet(PULLS_KEY + g.id);
    if (saved) return go('build', { mode: 'online', gameId: g.id, set: g.set, pulls: saved });
    const type = g.set.type || boosterTypeFor(g.set.released);
    if (PR.state.points < PR.costFor(type)) {
      toast(`You need ${PR.costFor(type)} ◆ to open your pack`);
      return go('home');
    }
    PR.ripPack(setObj(g.set), type, (pulls) => {
      if (!pulls) return go('home');
      const slim = pulls.map((p) => ({ card: p.card, foil: p.foil }));
      lsSet(PULLS_KEY + g.id, slim);
      go('build', { mode: 'online', gameId: g.id, set: g.set, pulls: slim });
    });
  }

  function resumeLocal() {
    const g = lsGet(LOCAL_KEY);
    if (!g) return go('home');
    if (g.status === 'building') {
      const idx = g.players.findIndex((p) => !p.state);
      if (idx === -1) return startLocalGame(g);
      const p = g.players[idx];
      if (p.pulls) return go('build', { mode: 'local', set: g.set, pulls: p.pulls, player: idx });
      const type = g.set.type || boosterTypeFor(g.set.released);
      if (PR.state.points < PR.costFor(type)) {
        toast(`You need ${PR.costFor(type)} ◆ to open ${p.name}'s pack`);
        return go('home');
      }
      const open = () =>
        PR.ripPack(setObj(g.set), type, (pulls) => {
          if (!pulls) return go('home');
          const cur = lsGet(LOCAL_KEY);
          cur.players[idx].pulls = pulls.map((x) => ({ card: x.card, foil: x.foil }));
          lsSet(LOCAL_KEY, cur);
          go('build', { mode: 'local', set: cur.set, pulls: cur.players[idx].pulls, player: idx });
        });
      if (idx === 1) return go('pass', { to: p.name, why: `${p.name}, it's your turn to rip a pack.`, then: open });
      return open();
    }
    game = localModel(g);
    go('table');
  }

  function renderBuild() {
    const pulls = ui.pulls;
    if (!ui.basics) ui.basics = E.suggestBasics(pulls.map((p) => p.card));
    const nBasics = Object.values(ui.basics).reduce((a, b) => a + b, 0);
    const total = pulls.length + nBasics;
    const who = ui.mode === 'local' ? lsGet(LOCAL_KEY).players[ui.player].name : 'Your';
    const art = basicArt();
    root().innerHTML = `
      <div class="card-panel">
        <h2>${esc(who === 'Your' ? 'Your' : who + "'s")} Pack Wars deck</h2>
        <p class="muted small">All ${pulls.length} cards from the pack, plus basic lands. Suggested lands match your pack's colors.</p>
        <div class="count-row"><b class="${total === E.DECK_TARGET ? 'ok' : ''}">${total}</b><span class="muted">cards · ${pulls.length} from the pack + ${nBasics} lands (30 recommended)</span></div>
      </div>
      <div class="grid small-grid">${pulls
        .map((p) => `<div class="mini ${p.card.rarity} ${p.foil ? 'is-foil' : ''}"><img src="${esc(p.card.img)}" alt="${esc(p.card.name)}" loading="lazy">${p.foil ? '<div class="foil-sheen"></div>' : ''}</div>`)
        .join('')}</div>
      <div class="card-panel">
        <div class="panel-head"><h2>Basic lands</h2><button class="link-btn" id="bdSuggest">Suggest</button></div>
        <div class="basics">${['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']
          .map(
            (b) => `<div class="basic" data-name="${b}"><div class="basic-art">${art[b] ? `<img src="${esc(art[b])}" alt="">` : `<span>${b[0]}</span>`}</div>
            <div class="basic-name">${b}</div><div class="stepper"><button data-d="-1">−</button><b>${ui.basics[b] || 0}</b><button data-d="1">+</button></div></div>`
          )
          .join('')}</div>
        <button class="btn primary wide" id="bdReady">Shuffle up & get ready</button>
      </div>`;
    root().querySelectorAll('.basic').forEach((el) =>
      el.querySelectorAll('button').forEach(
        (b) => (b.onclick = () => {
          const n = Math.max(0, (ui.basics[el.dataset.name] || 0) + Number(b.dataset.d));
          if (n) ui.basics[el.dataset.name] = n;
          else delete ui.basics[el.dataset.name];
          renderBuild();
        })
      )
    );
    document.getElementById('bdSuggest').onclick = () => {
      ui.basics = E.suggestBasics(pulls.map((p) => p.card));
      renderBuild();
    };
    document.getElementById('bdReady').onclick = async () => {
      if (total < 15) return toast('Add some lands first');
      const state = E.newPlayer(pulls, ui.basics, basicArt());
      if (ui.mode === 'local') {
        const g = lsGet(LOCAL_KEY);
        g.players[ui.player].state = state;
        lsSet(LOCAL_KEY, g);
        return resumeLocal();
      }
      try {
        await rpc('pw_ready', { p_game: ui.gameId, p_pub: E.publicView(state), p_priv: state });
        lsDel(PULLS_KEY + ui.gameId);
        openOnline(ui.gameId);
      } catch (e) {
        toast((e && e.message) || "Couldn't save your deck");
      }
    };
    // Basic land pictures come from the deck builder's cache; fetch them if missing.
    if (Object.keys(art).length < 5 && window.PRDecks && !ui.artTried) {
      ui.artTried = true;
      fetchBasicArt().then(() => ui.screen === 'build' && renderBuild());
    }
  }

  async function fetchBasicArt() {
    const art = basicArt();
    for (const b of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) {
      if (art[b]) continue;
      try {
        const r = await fetch(`${PR.API}/cards/named?exact=${b}&set=fdn`).then((x) => x.json());
        if (r.image_uris) art[b] = r.image_uris.normal;
      } catch {}
      await new Promise((r) => setTimeout(r, 110));
    }
    lsSet('packripped:basics', art);
  }

  // ======================= GAME MODELS =======================
  // Model: { mode, id, set, status, myTurn, turnNumber, winner: 'me'|'opp'|null, log,
  //          me: { name, state }, opp: { name, pub, ready }, version }
  function onlineModel(d) {
    return {
      mode: 'online', id: d.id, set: d.set, status: d.status, myTurn: !!d.my_turn, turnNumber: d.turn_number,
      winner: d.winner, log: d.log || [], version: d.version,
      me: { name: social().me.username, state: d.me && d.me.ready ? d.me.priv : null },
      opp: { name: d.opp ? d.opp.username : '?', pub: d.opp && d.opp.ready ? d.opp.pub : null, ready: d.opp && d.opp.ready },
    };
  }

  function localModel(g) {
    const v = g.turn; // the player holding the phone is the one whose turn it is
    const o = 1 - v;
    return {
      mode: 'local', id: 'local', set: g.set, status: g.status, myTurn: true, turnNumber: g.turnNumber,
      winner: g.winner == null ? null : g.winner === v ? 'me' : 'opp', winnerName: g.winner == null ? null : g.players[g.winner].name,
      log: g.log, me: { name: g.players[v].name, state: g.players[v].state }, opp: { name: g.players[o].name, pub: E.publicView(g.players[o].state), ready: true },
    };
  }

  function startLocalGame(g) {
    g.status = 'playing';
    g.turn = Math.random() < 0.5 ? 0 : 1;
    g.turnNumber = 1;
    g.log.push({ who: g.players[g.turn].name, msg: 'won the coin flip and goes first' });
    lsSet(LOCAL_KEY, g);
    game = localModel(g);
    go('pass', { to: g.players[g.turn].name, why: `${g.players[g.turn].name} won the coin flip and goes first.`, then: () => go('table') });
  }

  async function openOnline(id) {
    try {
      const d = await rpc('pw_get', { p_game: id, p_version: null });
      if (!d) return go('home');
      game = onlineModel(d);
      go('table');
    } catch (e) {
      toast("Couldn't open the game");
    }
  }

  function startPolling() {
    stopPoll();
    if (!game || game.mode !== 'online' || game.status === 'done') return;
    poll = setInterval(async () => {
      if (busy || ui.screen !== 'table' || document.visibilityState !== 'visible') return;
      try {
        const d = await rpc('pw_get', { p_game: game.id, p_version: game.version });
        if (!d || busy) return;
        const before = game;
        game = onlineModel(d);
        if (!before.myTurn && game.myTurn && navigator.vibrate) navigator.vibrate([30, 40, 30]);
        if (!before.myTurn && game.myTurn) toast("It's your turn!");
        renderTable(true);
      } catch {}
    }, 1500);
  }

  /** Change my half of the table, log it, and send it. */
  async function act(mutate, msg, opts) {
    opts = opts || {};
    if (!game || game.status !== 'playing' || busy) return;
    const s = game.me.state;
    const extra = mutate ? mutate(s) : null;
    const text = typeof msg === 'function' ? msg(extra) : msg;
    if (game.mode === 'local') {
      const g = lsGet(LOCAL_KEY);
      g.players[g.turn].state = s;
      if (text) g.log.push({ who: g.players[g.turn].name, msg: text });
      if (opts.lost) {
        g.winner = 1 - g.turn;
        g.status = 'done';
        g.log.push({ who: g.players[g.winner].name, msg: 'wins!' });
      }
      if (opts.pass) {
        g.turn = 1 - g.turn;
        g.turnNumber += 1;
      }
      g.log = g.log.slice(-150);
      lsSet(LOCAL_KEY, g);
      game = localModel(g);
      if (opts.pass) return go('pass', { to: g.players[g.turn].name, why: `Turn ${g.turnNumber}: ${g.players[g.turn].name}'s turn.`, then: () => go('table') });
      return renderTable(true);
    }
    busy = true;
    renderTable(true);
    try {
      await rpc('pw_update', {
        p_game: game.id, p_pub: E.publicView(s), p_priv: s, p_log: text || '', p_pass: !!opts.pass, p_lost: !!opts.lost,
      });
      const d = await rpc('pw_get', { p_game: game.id, p_version: null });
      if (d) game = onlineModel(d);
    } catch (e) {
      toast("Couldn't reach the server. Try again.");
    } finally {
      busy = false;
      renderTable(true);
    }
  }

  // ======================= TABLE =======================
  function renderPass() {
    root().innerHTML = `<div class="pass-screen"><div class="avatar big">${esc((ui.to || '?')[0].toUpperCase())}</div>
      <h2>Pass the phone to ${esc(ui.to)}</h2><p class="muted">${esc(ui.why || '')}</p>
      <button class="btn primary" id="passGo">I'm ${esc(ui.to)}, continue</button></div>`;
    const then = ui.then;
    document.getElementById('passGo').onclick = () => then();
  }

  const cardEl = (x, zone, mine) => `<div class="pwc ${x.tapped ? 'tapped' : ''} ${x.foil ? 'is-foil' : ''}" data-id="${esc(x.id)}" data-zone="${zone}" data-mine="${mine ? 1 : 0}">
      ${x.c.img ? `<img src="${esc(x.c.img)}" alt="${esc(x.c.name)}" loading="lazy">` : `<span class="pwc-name">${esc(x.c.name)}</span>`}
      ${x.counters ? `<span class="ctr">${x.counters > 0 ? '+' : ''}${x.counters}/${x.counters > 0 ? '+' : ''}${x.counters}</span>` : ''}
    </div>`;

  function rowsOf(list, zone, mine) {
    const lands = list.filter((x) => E.isLand(x.c));
    const other = list.filter((x) => !E.isLand(x.c));
    const row = (l, cls) => `<div class="bf-row ${cls}">${l.map((x) => cardEl(x, zone, mine)).join('') || '<span class="bf-empty"></span>'}</div>`;
    return mine ? row(other, 'spells') + row(lands, 'lands') : row(lands, 'lands') + row(other, 'spells');
  }

  function renderTable(keepScroll) {
    const y = window.scrollY;
    const g = game;
    if (!g) return go('home');
    const me = g.me.state;
    const opp = g.opp.pub;
    const meView = me ? E.publicView(me) : null;

    if (!me || !opp) {
      // Waiting for decks.
      root().innerHTML = `<div class="card-panel"><button class="link-btn" id="tbHome">‹ Pack Wars</button>
        <h2 style="margin-top:6px">@${esc(g.opp.name)} vs you · ${esc(g.set.name)}</h2>
        <p>${!me ? 'Open your pack to build your deck.' : g.status === 'invited' ? `Waiting for @${esc(g.opp.name)} to accept…` : `Waiting for @${esc(g.opp.name)} to open their pack and build…`}</p>
        <div class="spinner"></div></div>`;
      document.getElementById('tbHome').onclick = () => go('home');
      startPolling();
      return;
    }

    const last = g.log.slice(-3).reverse();
    const doneBanner =
      g.status === 'done'
        ? `<div class="result ${g.winner === 'me' ? 'win' : 'lose'}"><h2>${
            g.mode === 'local' ? `🏆 ${esc(g.winnerName)} wins!` : g.winner === 'me' ? '🏆 You win!' : `@${esc(g.opp.name)} wins`
          }</h2><button class="btn" id="tbDoneHome">Back to Pack Wars</button></div>`
        : '';
    const turnText =
      g.status !== 'playing' ? 'Game over' : g.mode === 'local' ? `Turn ${g.turnNumber} · ${esc(g.me.name)}'s turn` : g.myTurn ? `Turn ${g.turnNumber} · <b class="ok">Your turn</b>` : `Turn ${g.turnNumber} · @${esc(g.opp.name)}'s turn`;

    root().innerHTML = `
      <div class="pw-table ${busy ? 'busy' : ''}">
        <div class="pw-bar opp">
          <button class="link-btn" id="tbHome">‹</button>
          <b class="pw-name">${g.mode === 'local' ? esc(g.opp.name) : '@' + esc(g.opp.name)}</b>
          <span class="pw-life">❤ ${opp.life}</span>
          <span class="pw-stat">✋${opp.hand}</span><span class="pw-stat">📚${opp.library}</span>
          <button class="pw-stat btnlike" data-pile="opp-graveyard">🪦${opp.graveyard.length}</button>
          <button class="pw-stat btnlike" data-pile="opp-exile">✨${opp.exile.length}</button>
        </div>
        <div class="bf opp">${rowsOf(opp.battlefield, 'battlefield', false)}</div>
        <div class="pw-mid">
          <div class="pw-turn">${turnText}</div>
          <button class="pw-log" id="tbLog">${last.map((l) => `<div><b>${esc(l.who)}</b> ${esc(l.msg)}</div>`).join('')}</button>
        </div>
        ${doneBanner}
        <div class="bf mine">${rowsOf(meView.battlefield, 'battlefield', true)}</div>
        <div class="pw-bar mine">
          <b class="pw-name">${g.mode === 'local' ? esc(g.me.name) : 'You'}</b>
          <span class="life-ctl"><button data-life="-1">−</button><span class="pw-life">❤ ${me.life}</span><button data-life="1">+</button></span>
          <button class="pw-stat btnlike" id="tbLib">📚${meView.library}</button>
          <button class="pw-stat btnlike" data-pile="me-graveyard">🪦${meView.graveyard.length}</button>
          <button class="pw-stat btnlike" data-pile="me-exile">✨${meView.exile.length}</button>
        </div>
        ${
          g.status === 'playing'
            ? `<div class="pw-actions">
          <button class="btn" id="tbDraw">Draw</button>
          <button class="btn" id="tbUntap">Untap all</button>
          <button class="btn primary" id="tbPass" ${g.myTurn ? '' : 'disabled'}>${g.myTurn ? 'End turn' : 'Their turn'}</button>
          <button class="btn" id="tbMore">•••</button>
        </div>`
            : ''
        }
        <div class="hand">${me.zones.hand.map((id) => cardEl({ id, ...me.cards[id] }, 'hand', true)).join('') || '<span class="muted small">No cards in hand</span>'}</div>
      </div>`;
    if (keepScroll) window.scrollTo(0, y);
    wireTable();
    startPolling();
  }

  function wireTable() {
    const g = game;
    const s = g.me.state;
    const $ = (id) => document.getElementById(id);
    $('tbHome').onclick = () => go('home');
    if ($('tbDoneHome')) $('tbDoneHome').onclick = () => go('home');
    $('tbLog').onclick = () =>
      dialog(`<h3>Game log</h3><div class="log-full">${g.log
        .slice()
        .reverse()
        .map((l) => `<div><b>${esc(l.who)}</b> ${esc(l.msg)}</div>`)
        .join('')}</div><button class="btn wide" id="lgClose">Close</button>`, (close) => ($('lgClose').onclick = close));
    root().querySelectorAll('[data-life]').forEach(
      (b) => (b.onclick = () => {
        const d = Number(b.dataset.life);
        const before = s.life;
        act((st) => E.changeLife(st, d), `life ${before} → ${before + d}`).then(() => {
          if (game.me.state.life <= 0 && game.status === 'playing') zeroLife();
        });
      })
    );
    root().querySelectorAll('.pwc').forEach((el) => (el.onclick = () => cardMenu(el.dataset.id, el.dataset.zone, el.dataset.mine === '1')));
    root().querySelectorAll('[data-pile]').forEach((b) => (b.onclick = () => pileView(b.dataset.pile)));
    if (g.status !== 'playing') return;
    $('tbLib').onclick = libraryMenu;
    $('tbDraw').onclick = () => act((st) => E.draw(st, 1), (n) => (n ? 'drew a card' : 'tried to draw from an empty library'));
    $('tbUntap').onclick = () => act((st) => E.untapAll(st), 'untapped everything');
    $('tbPass').onclick = () => act(null, 'ended their turn', { pass: true });
    $('tbMore').onclick = moreMenu;
  }

  function zeroLife() {
    dialog(
      `<h3>You're at ${game.me.state.life} life</h3><p class="muted">In Magic you lose at 0 life. Admit defeat?</p>
      <div class="row"><button class="btn" id="zlNo">Not yet</button><button class="btn danger" id="zlYes">I lose</button></div>`,
      (close) => {
        document.getElementById('zlNo').onclick = close;
        document.getElementById('zlYes').onclick = () => {
          close();
          act(null, 'is out of life', { lost: true });
        };
      }
    );
  }

  function showBig(card) {
    const m = document.getElementById('cardModal');
    document.getElementById('cardModalInner').innerHTML = `<div class="detail"><img src="${esc(card.c.img)}" alt="${esc(card.c.name)}"></div>
      <h3>${esc(card.c.name)}</h3><p class="muted small">${esc(card.c.type)}</p>
      <div class="row center"><button class="btn primary" id="bigClose">Close</button></div>`;
    m.classList.remove('hidden');
    const close = () => m.classList.add('hidden');
    document.getElementById('bigClose').onclick = close;
    m.onclick = (e) => {
      if (e.target === m) close();
    };
  }

  function sheet(title, img, buttons) {
    dialog(
      `${img ? `<img class="sheet-img" src="${esc(img)}" alt="">` : ''}<h3>${esc(title)}</h3>
      <div class="col">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}
      <button class="btn" data-i="x">Close</button></div>`,
      (close) => {
        document.querySelectorAll('#dialogBox [data-i]').forEach(
          (el) => (el.onclick = () => {
            close();
            if (el.dataset.i !== 'x') buttons[Number(el.dataset.i)].fn();
          })
        );
      }
    );
  }

  function cardMenu(id, zone, mine) {
    const g = game;
    if (!mine) {
      const opp = g.opp.pub;
      const c = [...opp.battlefield, ...opp.graveyard, ...opp.exile].find((x) => x.id === id);
      if (c) showBig(c);
      return;
    }
    const s = g.me.state;
    const card = s.cards[id];
    const name = card.c.name;
    const mv = (to, where, verb) => ({ label: verb, fn: () => act((st) => E.move(st, id, to, where), `${verbLog(to, where)} ${name}`) });
    const view = { label: 'View card', fn: () => showBig(card) };
    if (g.status !== 'playing') return showBig(card);
    let btns;
    if (zone === 'hand')
      btns = [
        { label: E.isLand(card.c) ? 'Play land' : 'Cast / play', cls: 'primary', fn: () => act((st) => E.move(st, id, 'battlefield'), `played ${name}`) },
        mv('graveyard', null, 'Discard'),
        mv('exile', null, 'Exile'),
        mv('library', 'top', 'Put on top of library'),
        mv('library', 'bottom', 'Put on bottom of library'),
        view,
      ];
    else if (zone === 'battlefield')
      btns = [
        { label: card.tapped ? 'Untap' : 'Tap', cls: 'primary', fn: () => act((st) => E.toggleTap(st, id), (t) => `${t ? 'tapped' : 'untapped'} ${name}`) },
        { label: 'Add +1/+1 counter', fn: () => act((st) => E.addCounter(st, id, 1), (n) => `put a counter on ${name} (${n > 0 ? '+' : ''}${n})`) },
        { label: 'Add −1/−1 counter', fn: () => act((st) => E.addCounter(st, id, -1), (n) => `put a −1/−1 counter on ${name} (${n})`) },
        mv('graveyard', null, 'To graveyard (dies / destroyed)'),
        mv('exile', null, 'Exile'),
        mv('hand', null, 'Return to hand'),
        mv('library', 'top', 'Put on top of library'),
        view,
      ];
    else
      btns = [
        mv('hand', null, 'Return to hand'),
        mv('battlefield', null, 'Put onto battlefield'),
        mv(zone === 'graveyard' ? 'exile' : 'graveyard', null, zone === 'graveyard' ? 'Exile' : 'To graveyard'),
        mv('library', 'top', 'Put on top of library'),
        view,
      ];
    sheet(name, card.c.img, btns);
  }

  function verbLog(to, where) {
    return {
      graveyard: 'put into graveyard:',
      exile: 'exiled',
      hand: 'returned to hand:',
      battlefield: 'put onto the battlefield:',
      library: where === 'bottom' ? 'put on the bottom of their library:' : 'put on top of their library:',
    }[to];
  }

  function pileView(which) {
    const [owner, zone] = which.split('-');
    const g = game;
    const list = owner === 'me' ? g.me.state.zones[zone].map((id) => ({ id, ...g.me.state.cards[id] })) : g.opp.pub[zone];
    const title = `${owner === 'me' ? 'Your' : (g.mode === 'local' ? g.opp.name : '@' + g.opp.name) + "'s"} ${zone}`;
    dialog(
      `<h3>${esc(title)} (${list.length})</h3>
      <div class="grid small-grid">${list
        .slice()
        .reverse()
        .map((x) => `<div class="mini" data-id="${esc(x.id)}">${x.c.img ? `<img src="${esc(x.c.img)}" alt="">` : esc(x.c.name)}</div>`)
        .join('') || '<p class="muted">Empty</p>'}</div>
      <button class="btn wide" id="pvClose">Close</button>`,
      (close) => {
        document.getElementById('pvClose').onclick = close;
        document.querySelectorAll('#dialogBox .mini').forEach(
          (m) => (m.onclick = () => {
            close();
            if (owner === 'me') cardMenu(m.dataset.id, zone, true);
            else showBig(list.find((x) => x.id === m.dataset.id));
          })
        );
      }
    );
  }

  function libraryMenu() {
    sheet(`Your library (${game.me.state.zones.library.length})`, null, [
      { label: 'Draw a card', cls: 'primary', fn: () => act((st) => E.draw(st, 1), 'drew a card') },
      { label: 'Search library…', fn: searchLibrary },
      { label: 'Shuffle', fn: () => act((st) => E.shuffle(st), 'shuffled their library') },
      { label: 'Mill 1 (top card to graveyard)', fn: () => act((st) => E.mill(st, 1), 'milled a card') },
    ]);
  }

  function searchLibrary() {
    const s = game.me.state;
    const list = s.zones.library.map((id) => ({ id, ...s.cards[id] })).sort((a, b) => a.c.name.localeCompare(b.c.name));
    dialog(
      `<h3>Search your library</h3><p class="muted small">Tap a card to take it. Your library is shuffled afterwards.</p>
      <div class="grid small-grid">${list.map((x) => `<div class="mini" data-id="${esc(x.id)}">${x.c.img ? `<img src="${esc(x.c.img)}" alt="">` : esc(x.c.name)}</div>`).join('')}</div>
      <button class="btn wide" id="slClose">Done (shuffle)</button>`,
      (close) => {
        document.getElementById('slClose').onclick = () => {
          close();
          act((st) => E.shuffle(st), 'searched and shuffled their library');
        };
        document.querySelectorAll('#dialogBox .mini').forEach(
          (m) => (m.onclick = () => {
            close();
            const id = m.dataset.id;
            const name = s.cards[id].c.name;
            sheet(name, s.cards[id].c.img, [
              { label: 'Put into hand', cls: 'primary', fn: () => act((st) => (E.move(st, id, 'hand'), E.shuffle(st)), `searched for ${name} (to hand) and shuffled`) },
              { label: 'Put onto battlefield', fn: () => act((st) => (E.move(st, id, 'battlefield'), E.shuffle(st)), `searched for ${name} (to battlefield) and shuffled`) },
            ]);
          })
        );
      }
    );
  }

  function moreMenu() {
    const s = game.me.state;
    sheet('More', null, [
      ...(game.turnNumber <= 2 && s.zones.battlefield.length === 0
        ? [{ label: `Mulligan (draw ${Math.max(0, E.HAND - s.mulligans - 1)})`, fn: () => act((st) => E.mulligan(st), `mulliganed to ${Math.max(0, E.HAND - s.mulligans - 1)}`) }]
        : []),
      { label: 'Untap all & draw (start of turn)', fn: () => act((st) => (E.untapAll(st), E.draw(st, 1)), 'untapped and drew for the turn') },
      { label: 'Search library…', fn: searchLibrary },
      { label: 'Shuffle library', fn: () => act((st) => E.shuffle(st), 'shuffled their library') },
      { label: 'Concede', cls: 'danger', fn: confirmConcede },
    ]);
  }

  function confirmConcede() {
    dialog(
      `<h3>Concede this game?</h3><div class="row"><button class="btn" id="ccNo">Keep playing</button><button class="btn danger" id="ccYes">Concede</button></div>`,
      (close) => {
        document.getElementById('ccNo').onclick = close;
        document.getElementById('ccYes').onclick = () => {
          close();
          act(null, 'conceded', { lost: true });
        };
      }
    );
  }

  window.PRPackWars = { render: () => go(ui.screen === 'table' && game ? 'table' : 'home') };
})();
