/*
 * Pack Ripped: Pack Wars, following the official "Mini-Master" minigame rules
 * (Commander Legends: Battle for Baldur's Gate / Dominaria United minigame cards):
 *
 *  - Each player opens a pack, trying not to look at the cards, adds three of each
 *    basic land (Plains, Island, Swamp, Mountain, Forest) and shuffles: that's the deck.
 *  - Randomly determine who goes first, then play a game of Magic.
 *  - The first player to win two games wins the match.
 *  - Official variants between games: add another pack, look at it and cut the deck to
 *    30 cards; or replace the whole deck with a new pack. Optional land rule: if you have
 *    two or more copies of a basic land, your other lands can tap as that type.
 *
 * Normal Magic rules apply (20 life, 7-card hand, London mulligan). The app is the table:
 * it doesn't enforce rules, and each player moves only their own cards.
 */
(function () {
  'use strict';

  const PR = window.PR;
  const E = window.PackWarsEngine;
  const { esc, toast, dialog } = PR;
  const ODDS = window.PackOdds.ODDS;
  const boosterTypeFor = window.PackOdds.boosterTypeFor;
  const LOCAL_KEY = 'packripped:pwlocal2';
  const PENDING_KEY = 'packripped:pwpending:';
  const LAND_RULE = 'Land rule: if you have two or more copies of a basic land, you can tap your other lands as though they were that type.';
  const root = () => document.getElementById('pwRoot');
  const social = () => window.PRSocial || {};
  const online = () => !!(social().configured && social().me);
  const rpc = (fn, args) => social().rpc(fn, args);

  let ui = { screen: 'home' };
  let game = null;
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
  const basicArt = () => lsGet('packripped:basics') || {};
  const packCost = (set) => PR.costFor((set && set.type) || 'play');
  const deckSize = (d) => d.cards.length + Object.values(d.basics || {}).reduce((a, b) => a + b, 0);
  const slimPulls = (pulls) => pulls.map((p) => ({ card: p.card, foil: p.foil }));

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

  function render() {
    if (!root()) return;
    const screens = { home: renderHome, pickSet: renderPickSet, pickFriend: renderPickFriend, ready: renderReady, between: renderBetween, cut: renderCut, table: renderTable, pass: renderPass };
    (screens[ui.screen] || renderHome)();
  }

  // ======================= HOME =======================
  function renderHome() {
    const local = lsGet(LOCAL_KEY);
    const s = social();
    root().innerHTML = `
      <div class="card-panel">
        <button class="link-btn" id="pwBack">‹ Open packs</button>
        <h2 style="margin-top:6px">⚔ Pack Wars</h2>
        <details class="manual" open><summary>How to play (official rules)</summary>
          <ol class="steps">
            <li>Each player opens a pack <b>without looking at it</b> and adds <b>three of each basic land</b> (Plains, Island, Swamp, Mountain, Forest). Shuffle: that's your deck.</li>
            <li>Randomly decide who goes first, then play a game of Magic: 20 life, draw 7.</li>
            <li><b>Best of three:</b> the first player to win two games wins the match. The loser of each game goes first in the next.</li>
            <li>Between games you can keep your deck, <b>add another pack</b> (look at it and cut your deck to 30 cards), or <b>replace your deck</b> with a fresh pack.</li>
          </ol>
          <p class="muted small">From Wizards of the Coast's "Mini-Master" minigame card. The app is your table: it doesn't check the rules, and each player moves their own cards.</p>
        </details>
        <p class="muted small">Each pack costs ${PR.costFor('play')} ◆ and goes into your collection.</p>
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
            ? `<p class="small">${esc(local.players[0].name)} ${local.wins[0]}–${local.wins[1]} ${esc(local.players[1].name)} · ${esc(local.set.name)} · ${
                local.status === 'done' ? `${esc(local.players[local.winner].name)} won the match` : `game ${local.gameNumber}`
              }</p>
              <div class="row"><button class="btn" id="pwLocalQuit">${local.status === 'done' ? 'Clear' : 'Abandon'}</button>
              ${local.status !== 'done' ? '<button class="btn primary" id="pwLocalGo">Continue</button>' : ''}</div>`
            : `<p class="muted small">Pass the phone back and forth. Packs are paid for from this phone and go into this phone's collection.</p>
              <button class="btn wide" id="pwLocalNew">Start a match on this phone</button>`
        }
      </div>`;
    const on = (id, fn) => document.getElementById(id) && (document.getElementById(id).onclick = fn);
    on('pwBack', () => PR.showView('open'));
    on('pwSignIn', () => PR.showView('friends'));
    on('pwChallenge', () => go('pickFriend'));
    on('pwLocalNew', () => go('pickSet', { mode: 'local' }));
    on('pwLocalGo', () => resumeLocal());
    on('pwLocalQuit', () => {
      lsDel(LOCAL_KEY);
      renderHome();
    });
    if (online()) loadGames();
  }

  async function loadGames() {
    const box = document.getElementById('pwGames');
    if (!box) return;
    let list = [];
    try {
      list = (await rpc('pw_list')) || [];
    } catch {
      box.innerHTML = `<p class="bad small">Couldn't load matches.</p>`;
      return;
    }
    const done = list.filter((g) => g.status === 'done');
    const wins = done.filter((g) => g.winner === 'me').length;
    const score = (g) => `${g.my_wins || 0}–${g.opp_wins || 0}`;
    const row = (g, label, btns) => `<li data-id="${esc(g.id)}">
        <span class="avatar">${esc((g.opponent || '?')[0].toUpperCase())}</span>
        <span class="pmeta"><b>@${esc(g.opponent)}</b><small>${esc((g.set && g.set.name) || '')} · ${label}</small></span>${btns}</li>`;
    const active = list.filter((g) => g.status !== 'done');
    box.innerHTML = `
      ${done.length ? `<p class="small" style="margin-top:12px">Match record: <b class="ok">${wins} W</b> · <b class="bad">${done.length - wins} L</b></p>` : ''}
      <ul class="people">${
        active
          .map((g) => {
            if (g.status === 'invited' && !g.host)
              return row(g, 'challenged you!', '<button class="btn small-btn primary" data-a="accept">Accept</button><button class="btn small-btn" data-a="decline">✕</button>');
            if (g.status === 'between')
              return row(g, `${score(g)} · ${g.my_ready ? 'waiting for their deck' : `pick your deck for game ${g.game_number + 1}`}`, `<button class="btn small-btn ${g.my_ready ? '' : 'primary'}" data-a="play">${g.my_ready ? 'View' : 'Next game'}</button>`);
            if (!g.my_ready) return row(g, 'open your pack', '<button class="btn small-btn primary" data-a="play">Open pack</button>');
            if (g.status === 'invited') return row(g, 'waiting for them to accept', '<button class="btn small-btn" data-a="cancel">Cancel</button>');
            if (g.status === 'building') return row(g, 'waiting for their pack', '<button class="btn small-btn" data-a="play">View</button>');
            return row(g, `game ${g.game_number} · ${score(g)} · ${g.my_turn ? '<b class="ok">your turn</b>' : 'their turn'}`, '<button class="btn small-btn primary" data-a="play">Play</button>');
          })
          .join('') || '<li class="muted small">No matches yet. Challenge a friend!</li>'
      }</ul>
      ${
        done.length
          ? `<details class="manual"><summary>Recent results</summary><ul class="people">${done
              .slice(0, 10)
              .map((g) => row(g, g.winner === 'me' ? `<b class="ok">You won ${score(g)}</b>` : `<b class="bad">You lost ${score(g)}</b>`, ''))
              .join('')}</ul></details>`
          : ''
      }`;
    box.querySelectorAll('li[data-id]').forEach((li) => {
      const g = list.find((x) => x.id === li.dataset.id);
      const on = (a, fn) => li.querySelector(`[data-a=${a}]`) && (li.querySelector(`[data-a=${a}]`).onclick = fn);
      on('accept', async () => {
        try {
          await rpc('pw_respond', { p_game: g.id, p_accept: true });
          openOnline(g.id);
        } catch (e) {
          toast((e && e.message) || "Couldn't accept");
        }
      });
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
      <p class="muted small">${ui.mode === 'online' ? `You and @${esc(ui.friend)} each open` : 'Each player opens'} one pack from this set.</p>
      <input type="search" id="psSearch" placeholder="Search sets…"></div>
      <div id="psList" class="card-panel"><div class="spinner"></div></div>`;
    document.getElementById('psBack').onclick = () => go(ui.mode === 'online' ? 'pickFriend' : 'home');
    const sets = await PR.getSets();
    const draw = () => {
      const q = document.getElementById('psSearch').value.trim().toLowerCase();
      document.getElementById('psList').innerHTML = sets
        .filter((s) => !q || s.name.toLowerCase().includes(q))
        .map(
          (s) => `<button class="set-item" data-code="${esc(s.code)}"><img class="set-icon" src="${esc(s.icon)}" alt="" loading="lazy">
          <span class="set-meta"><b>${esc(s.name)}</b><small>${esc(s.released.slice(0, 4))} · ${ODDS[boosterTypeFor(s.released)].name}</small></span></button>`
        )
        .join('');
      document.querySelectorAll('#psList .set-item').forEach((b) => (b.onclick = () => chooseSet(sets.find((s) => s.code === b.dataset.code))));
    };
    document.getElementById('psSearch').oninput = draw;
    draw();
  }

  function chooseSet(set) {
    const type = boosterTypeFor(set.released);
    const cost = PR.costFor(type);
    const local = ui.mode === 'local';
    const need = local ? cost * 2 : cost;
    const have = PR.state.points;
    dialog(
      `<img class="set-icon big" src="${esc(set.icon)}" alt=""><h3>${esc(set.name)}</h3>
      <p>${local ? `Each player opens a ${ODDS[type].name} (${cost} ◆ each, ${need} ◆ to start).` : `Challenge @${esc(ui.friend)} to a best-of-three match. Your ${ODDS[type].name} costs ${cost} ◆.`}</p>
      ${local ? `<div class="col"><input id="p1n" placeholder="Player 1 name" maxlength="16" value="Player 1"><input id="p2n" placeholder="Player 2 name" maxlength="16" value="Player 2"></div>` : ''}
      <label class="check"><input type="checkbox" id="csLand"> Use the optional land rule: with two or more of a basic land, your other lands can tap as that type</label>
      <div class="row"><button class="btn" id="csNo">Cancel</button>
      <button class="btn primary" id="csYes" ${have >= need ? '' : 'disabled'}>${have >= need ? (local ? 'Start' : 'Send challenge') : `Need ${need - have} more ◆`}</button></div>`,
      (close) => {
        document.getElementById('csNo').onclick = close;
        document.getElementById('csYes').onclick = async () => {
          const info = { code: set.code, name: set.name, icon: set.icon, released: set.released, type, rules: { landRule: document.getElementById('csLand').checked } };
          if (local) {
            const names = [document.getElementById('p1n').value.trim() || 'Player 1', document.getElementById('p2n').value.trim() || 'Player 2'];
            close();
            lsSet(LOCAL_KEY, {
              id: 'local', set: info, status: 'building', turn: 0, turnNumber: 0, gameNumber: 1, wins: [0, 0], lastLoser: null, winner: null, log: [],
              players: names.map((name) => ({ name, deck: null, state: null, ready: false, pending: null })),
            });
            return resumeLocal();
          }
          close();
          try {
            const gid = await rpc('pw_create', { p_friend: ui.friend, p_set: info });
            toast(`Challenge sent to @${ui.friend}`);
            openOnline(gid);
          } catch (e) {
            toast((e && e.message) || "Couldn't create the match");
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

  // ======================= DECKS =======================
  // ctx: { mode: 'online', gameId } or { mode: 'local', player }
  const setObj = (info) => ({ code: info.code, name: info.name, icon: info.icon, released: info.released });

  function pendingGet(ctx) {
    if (ctx.mode === 'online') return lsGet(PENDING_KEY + ctx.gameId);
    return lsGet(LOCAL_KEY).players[ctx.player].pending;
  }
  function pendingSet(ctx, v) {
    if (ctx.mode === 'online') return v ? lsSet(PENDING_KEY + ctx.gameId, v) : lsDel(PENDING_KEY + ctx.gameId);
    const g = lsGet(LOCAL_KEY);
    g.players[ctx.player].pending = v;
    lsSet(LOCAL_KEY, g);
  }

  /** Rip a pack. blind: the cards go into the deck face down (official rule for a new deck). */
  function rip(ctx, set, blind, then) {
    const cost = packCost(set);
    if (PR.state.points < cost) {
      toast(`You need ${cost} ◆ for a pack`);
      return go('home');
    }
    PR.ripPack(setObj(set), set.type || boosterTypeFor(set.released), (pulls) => (pulls ? then(slimPulls(pulls)) : go('home')), { blind });
  }

  /** New deck from a fresh, unseen pack. */
  function newDeckFromPack(ctx, set) {
    rip(ctx, set, true, (pulls) => {
      const deck = { cards: pulls, basics: { ...E.PACK_WARS_BASICS } };
      pendingSet(ctx, { kind: 'ready', deck });
      go('ready', { ctx, set, deck });
    });
  }

  function renderReady() {
    const { deck, set, ctx } = ui;
    const who = ctx.mode === 'local' ? lsGet(LOCAL_KEY).players[ctx.player].name + "'s" : 'Your';
    root().innerHTML = `
      <div class="card-panel center-text">
        <h2>${esc(who)} deck is ready</h2>
        <div class="deck-stack"><div class="cardback"></div><div class="cardback"></div><div class="cardback"></div><span>${deckSize(deck)}</span></div>
        <p>${deck.cards.length} cards from your ${esc(set.name)} pack, <b>face down</b>, plus 3 Plains, 3 Islands, 3 Swamps, 3 Mountains and 3 Forests.</p>
        <p class="muted small">No peeking! You'll see your cards as you draw them. They're already in your collection for after the match.</p>
        <button class="btn primary wide" id="rdGo">Shuffle up and play</button>
      </div>`;
    document.getElementById('rdGo').onclick = () => finalizeDeck(ctx, deck);
  }

  async function finalizeDeck(ctx, deck) {
    const state = E.newPlayer(deck.cards, deck.basics, basicArt());
    state.deck = deck;
    if (ctx.mode === 'local') {
      const g = lsGet(LOCAL_KEY);
      Object.assign(g.players[ctx.player], { deck, state, ready: true, pending: null });
      lsSet(LOCAL_KEY, g);
      return resumeLocal();
    }
    try {
      await rpc('pw_ready', { p_game: ctx.gameId, p_pub: E.publicView(state), p_priv: state });
      pendingSet(ctx, null);
      openOnline(ctx.gameId);
    } catch (e) {
      toast((e && e.message) || "Couldn't save your deck");
    }
  }

  // Between games: keep the deck, add a pack and cut to 30, or replace with a new pack.
  function renderBetween() {
    const { ctx, set, deck, score, nextGame, lastResult } = ui;
    const cost = packCost(set);
    const who = ctx.mode === 'local' ? lsGet(LOCAL_KEY).players[ctx.player].name : null;
    root().innerHTML = `
      <div class="card-panel center-text">
        <button class="link-btn" id="bwHome" style="float:left">‹ Pack Wars</button><div style="clear:both"></div>
        ${lastResult ? `<p class="small">${esc(lastResult)}</p>` : ''}
        <h2>${esc(score)}</h2>
        <p>${who ? `${esc(who)}, choose` : 'Choose'} your deck for game ${nextGame}.</p>
      </div>
      <div class="card-panel col" style="margin-top:0">
        <button class="btn wide" id="bwSame">Keep my deck (${deckSize(deck)} cards)<small class="block muted">Shuffle it up again</small></button>
        <button class="btn wide" id="bwAdd" ${PR.state.points >= cost ? '' : 'disabled'}>Add another pack (${cost} ◆)<small class="block muted">Look at it, then cut your deck to 30 cards</small></button>
        <button class="btn wide" id="bwNew" ${PR.state.points >= cost ? '' : 'disabled'}>Replace my deck with a new pack (${cost} ◆)<small class="block muted">Fresh pack + 15 basic lands, face down</small></button>
      </div>`;
    document.getElementById('bwHome').onclick = () => go('home');
    document.getElementById('bwSame').onclick = () => finalizeDeck(ctx, deck);
    document.getElementById('bwNew').onclick = () => newDeckFromPack(ctx, set);
    document.getElementById('bwAdd').onclick = () =>
      rip(ctx, set, false, (pulls) => {
        // Official variant: add the new pack, look at everything, cut down to 30.
        const all = { cards: deck.cards.concat(pulls), basics: { ...deck.basics } };
        pendingSet(ctx, { kind: 'cut', deck: all });
        go('cut', { ctx, set, deck: all, cut: {} });
      });
  }

  function renderCut() {
    const { deck, cut, ctx } = ui;
    const keptCards = deck.cards.filter((_, i) => !cut[i]);
    const total = keptCards.length + Object.values(deck.basics).reduce((a, b) => a + b, 0);
    const over = total - E.DECK_TARGET;
    const art = basicArt();
    root().innerHTML = `
      <div class="card-panel">
        <h2>Cut your deck to 30</h2>
        <p class="muted small">You added a second pack. Tap cards to cut them (and lower basic lands if you like) until you have exactly 30.</p>
        <div class="count-row"><b class="${over === 0 ? 'ok' : 'bad'}">${total}</b><span class="muted">/ 30 · ${over > 0 ? `cut ${over} more` : over < 0 ? `${-over} too few` : 'ready!'}</span></div>
      </div>
      <div class="grid small-grid">${deck.cards
        .map(
          (p, i) => `<div class="mini ${p.card.rarity} ${p.foil ? 'is-foil' : ''} ${cut[i] ? 'maxed' : ''}" data-i="${i}">
          <img src="${esc(p.card.img)}" alt="${esc(p.card.name)}" loading="lazy">${cut[i] ? '<span class="tag bad-tag">Cut</span>' : ''}</div>`
        )
        .join('')}</div>
      <div class="card-panel">
        <div class="panel-head"><h2>Basic lands</h2></div>
        <div class="basics">${Object.keys(E.PACK_WARS_BASICS)
          .map(
            (b) => `<div class="basic" data-name="${b}"><div class="basic-art">${art[b] ? `<img src="${esc(art[b])}" alt="">` : `<span>${b[0]}</span>`}</div>
            <div class="basic-name">${b}</div><div class="stepper"><button data-d="-1">−</button><b>${deck.basics[b] || 0}</b><button data-d="1" ${(deck.basics[b] || 0) >= 3 ? 'disabled' : ''}>+</button></div></div>`
          )
          .join('')}</div>
        <button class="btn primary wide" id="ctGo" ${over === 0 ? '' : 'disabled'}>Lock in my 30 cards</button>
      </div>`;
    root().querySelectorAll('.mini[data-i]').forEach(
      (m) => (m.onclick = () => {
        const i = Number(m.dataset.i);
        ui.cut[i] = !ui.cut[i];
        const y = window.scrollY;
        renderCut();
        window.scrollTo(0, y);
      })
    );
    root().querySelectorAll('.basic').forEach((el) =>
      el.querySelectorAll('button').forEach(
        (b) => (b.onclick = () => {
          const n = Math.min(3, Math.max(0, (deck.basics[el.dataset.name] || 0) + Number(b.dataset.d)));
          deck.basics[el.dataset.name] = n;
          const y = window.scrollY;
          renderCut();
          window.scrollTo(0, y);
        })
      )
    );
    document.getElementById('ctGo').onclick = () => finalizeDeck(ctx, { cards: keptCards, basics: { ...deck.basics } });
  }

  // ======================= LOCAL MATCH =======================
  function resumeLocal() {
    const g = lsGet(LOCAL_KEY);
    if (!g) return go('home');
    if (g.status === 'building' || g.status === 'between') {
      const idx = g.players.findIndex((p) => !p.ready);
      if (idx === -1) return startLocalGame(g);
      const p = g.players[idx];
      const ctx = { mode: 'local', player: idx };
      const step = () => {
        const pend = p.pending;
        if (pend && pend.kind === 'ready') return go('ready', { ctx, set: g.set, deck: pend.deck });
        if (pend && pend.kind === 'cut') return go('cut', { ctx, set: g.set, deck: pend.deck, cut: {} });
        if (g.status === 'building') return newDeckFromPack(ctx, g.set);
        go('between', {
          ctx, set: g.set, deck: p.deck, nextGame: g.gameNumber + 1,
          score: `${g.players[0].name} ${g.wins[0]} – ${g.wins[1]} ${g.players[1].name}`,
          lastResult: `${g.players[1 - g.lastLoser].name} won game ${g.gameNumber}.`,
        });
      };
      // Hand the phone over before each player's private step (except the very first).
      const first = g.status === 'building' && idx === 0 && !p.pending;
      return first ? step() : go('pass', { to: p.name, why: g.status === 'building' ? `${p.name}, rip your pack.` : `${p.name}, choose your deck for the next game.`, then: step });
    }
    game = localModel(g);
    go('table');
  }

  function startLocalGame(g) {
    if (g.status === 'building') {
      g.turn = Math.random() < 0.5 ? 0 : 1;
      g.log.push({ who: g.players[g.turn].name, msg: 'won the coin flip and goes first' });
    } else {
      g.turn = g.lastLoser;
      g.gameNumber += 1;
      g.log.push({ who: g.players[g.turn].name, msg: `lost the last game, so they go first in game ${g.gameNumber}` });
    }
    g.status = 'playing';
    g.turnNumber = 1;
    lsSet(LOCAL_KEY, g);
    game = localModel(g);
    const name = g.players[g.turn].name;
    go('pass', { to: name, why: `Game ${g.gameNumber}: ${name} goes first.`, then: () => go('table') });
  }

  function localModel(g) {
    const v = g.turn;
    const o = 1 - v;
    return {
      mode: 'local', id: 'local', set: g.set, status: g.status, myTurn: true, turnNumber: g.turnNumber, gameNumber: g.gameNumber,
      myWins: g.wins[v], oppWins: g.wins[o],
      scoreLine: `${g.players[0].name} ${g.wins[0]} – ${g.wins[1]} ${g.players[1].name}`, winner: g.winner == null ? null : g.winner === v ? 'me' : 'opp', winnerName: g.winner == null ? null : g.players[g.winner].name,
      log: g.log, me: { name: g.players[v].name, state: g.players[v].state, ready: true }, opp: { name: g.players[o].name, pub: g.players[o].state ? E.publicView(g.players[o].state) : null, ready: true },
    };
  }

  // ======================= ONLINE MATCH =======================
  function onlineModel(d) {
    return {
      mode: 'online', id: d.id, set: d.set, status: d.status, myTurn: !!d.my_turn, turnNumber: d.turn_number, gameNumber: d.game_number || 1,
      myWins: d.my_wins || 0, oppWins: d.opp_wins || 0, winner: d.winner, log: d.log || [], version: d.version, isHost: d.host,
      me: { name: social().me.username, state: d.me ? d.me.priv : null, ready: !!(d.me && d.me.ready) },
      opp: { name: d.opp ? d.opp.username : '?', pub: d.opp ? d.opp.pub : null, ready: !!(d.opp && d.opp.ready) },
    };
  }

  async function openOnline(id) {
    try {
      const d = await rpc('pw_get', { p_game: id, p_version: null });
      if (!d) return go('home');
      game = onlineModel(d);
      go('table');
    } catch {
      toast("Couldn't open the match");
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
        if (game.status === 'playing' && !before.myTurn && game.myTurn) {
          if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
          toast("It's your turn!");
        }
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
        const w = 1 - g.turn;
        g.wins[w] += 1;
        g.lastLoser = g.turn;
        if (g.wins[w] >= 2) {
          g.status = 'done';
          g.winner = w;
          g.log.push({ who: g.players[w].name, msg: `wins the match ${g.wins[w]}–${g.wins[1 - w]}!` });
        } else {
          g.status = 'between';
          g.log.push({ who: g.players[w].name, msg: `wins game ${g.gameNumber}` });
          g.players.forEach((p) => (p.ready = false));
        }
      }
      if (opts.pass) {
        g.turn = 1 - g.turn;
        g.turnNumber += 1;
      }
      g.log = g.log.slice(-150);
      lsSet(LOCAL_KEY, g);
      if (g.status === 'between') return renderLocalGameOver(g);
      game = localModel(g);
      if (opts.pass) return go('pass', { to: g.players[g.turn].name, why: `Turn ${g.turnNumber}: ${g.players[g.turn].name}'s turn.`, then: () => go('table') });
      return renderTable(true);
    }
    busy = true;
    renderTable(true);
    try {
      await rpc('pw_update', { p_game: game.id, p_pub: E.publicView(s), p_priv: s, p_log: text || '', p_pass: !!opts.pass, p_lost: !!opts.lost });
      const d = await rpc('pw_get', { p_game: game.id, p_version: null });
      if (d) game = onlineModel(d);
    } catch {
      toast("Couldn't reach the server. Try again.");
    } finally {
      busy = false;
      renderTable(true);
    }
  }

  function renderLocalGameOver(g) {
    const w = 1 - g.lastLoser;
    root().innerHTML = `<div class="pass-screen"><h2>🏆 ${esc(g.players[w].name)} wins game ${g.gameNumber}</h2>
      <p class="big-score">${esc(g.players[0].name)} ${g.wins[0]} – ${g.wins[1]} ${esc(g.players[1].name)}</p>
      <p class="muted">First to two wins takes the match. Next up: game ${g.gameNumber + 1}.</p>
      <button class="btn primary" id="lgNext">Choose decks for the next game</button></div>`;
    document.getElementById('lgNext').onclick = () => resumeLocal();
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

  function waitingScreen(text, extra) {
    root().innerHTML = `<div class="card-panel"><button class="link-btn" id="tbHome">‹ Pack Wars</button>
      <h2 style="margin-top:6px">@${esc(game.opp.name)} vs you · ${esc(game.set.name)}</h2>
      ${game.myWins || game.oppWins ? `<p class="big-score">You ${game.myWins} – ${game.oppWins} @${esc(game.opp.name)}</p>` : ''}
      <p>${text}</p>${extra || '<div class="spinner"></div>'}</div>`;
    document.getElementById('tbHome').onclick = () => go('home');
  }

  function renderTable(keepScroll) {
    const y = window.scrollY;
    const g = game;
    if (!g) return go('home');

    if (g.mode === 'online' && g.status !== 'playing' && g.status !== 'done') {
      const ctx = { mode: 'online', gameId: g.id };
      if (!g.me.ready) {
        const pend = pendingGet(ctx);
        if (pend && pend.kind === 'ready') return go('ready', { ctx, set: g.set, deck: pend.deck });
        if (pend && pend.kind === 'cut') return go('cut', { ctx, set: g.set, deck: pend.deck, cut: {} });
        if (g.status === 'between') {
          return go('between', {
            ctx, set: g.set, deck: g.me.state && g.me.state.deck, nextGame: g.gameNumber + 1,
            score: `You ${g.myWins} – ${g.oppWins} @${g.opp.name}`,
            lastResult: lastWinLine(g),
          });
        }
        waitingScreen(
          g.status === 'invited' && !g.isHost ? `@${esc(g.opp.name)} challenged you.` : `Open your ${esc(g.set.name)} pack to make your deck.`,
          `<button class="btn primary wide" id="wtOpen">Rip my pack (${packCost(g.set)} ◆)</button>`
        );
        document.getElementById('wtOpen').onclick = () => newDeckFromPack(ctx, g.set);
        return;
      }
      waitingScreen(
        g.status === 'invited'
          ? `Waiting for @${esc(g.opp.name)} to accept…`
          : g.status === 'between'
          ? `${esc(lastWinLine(g))} Waiting for @${esc(g.opp.name)} to choose their deck for game ${g.gameNumber + 1}…`
          : `Waiting for @${esc(g.opp.name)} to rip their pack…`
      );
      return startPolling();
    }

    const me = g.me.state;
    const opp = g.opp.pub;
    if (!me || !opp || !opp.battlefield) return waitingScreen('Loading the table…');
    const meView = E.publicView(me);
    const last = g.log.slice(-3).reverse();
    const oppLabel = g.mode === 'local' ? esc(g.opp.name) : '@' + esc(g.opp.name);
    const doneBanner =
      g.status === 'done'
        ? `<div class="result ${g.winner === 'me' ? 'win' : 'lose'}"><h2>${
            g.mode === 'local' ? `🏆 ${esc(g.winnerName)} wins the match!` : g.winner === 'me' ? '🏆 You win the match!' : `@${esc(g.opp.name)} wins the match`
          }</h2><p class="big-score">${g.mode === 'local' ? esc(g.scoreLine) : `You ${g.myWins} – ${g.oppWins} @${esc(g.opp.name)}`}</p><button class="btn" id="tbDoneHome">Back to Pack Wars</button></div>`
        : '';
    const turnText =
      g.status !== 'playing'
        ? 'Match over'
        : g.mode === 'local'
        ? `Turn ${g.turnNumber} · ${esc(g.me.name)}'s turn`
        : g.myTurn
        ? `Turn ${g.turnNumber} · <b class="ok">Your turn</b>`
        : `Turn ${g.turnNumber} · ${oppLabel}'s turn`;
    const owe = me.bottomOwed || 0;

    root().innerHTML = `
      <div class="pw-table ${busy ? 'busy' : ''}">
        <div class="pw-score"><button class="link-btn" id="tbHome">‹</button>
          <span>Game ${g.gameNumber} · <b>${g.mode === 'local' ? esc(g.me.name) : 'You'} ${g.myWins} – ${g.oppWins} ${oppLabel}</b> · best of 3</span>
          ${g.set.rules && g.set.rules.landRule ? '<button class="chip" id="tbRule">Land rule</button>' : ''}
        </div>
        <div class="pw-bar opp">
          <b class="pw-name">${oppLabel}</b>
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
            ? `${owe ? `<div class="owe">Mulligan: tap ${owe} card${owe === 1 ? '' : 's'} in your hand to put on the bottom of your library.</div>` : ''}
          <div class="pw-actions">
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

  function lastWinLine(g) {
    const l = g.log.slice().reverse().find((x) => /wins game/.test(x.msg));
    return l ? `${l.who === g.me.name ? 'You' : '@' + l.who} won game ${g.gameNumber}.` : '';
  }

  function wireTable() {
    const g = game;
    const s = g.me.state;
    const $ = (id) => document.getElementById(id);
    $('tbHome').onclick = () => go('home');
    if ($('tbDoneHome')) $('tbDoneHome').onclick = () => go('home');
    if ($('tbRule')) $('tbRule').onclick = () => toast(LAND_RULE);
    $('tbLog').onclick = () =>
      dialog(
        `<h3>Game log</h3><div class="log-full">${g.log
          .slice()
          .reverse()
          .map((l) => `<div><b>${esc(l.who)}</b> ${esc(l.msg)}</div>`)
          .join('')}</div><button class="btn wide" id="lgClose">Close</button>`,
        (close) => ($('lgClose').onclick = close)
      );
    root().querySelectorAll('.pwc').forEach((el) => (el.onclick = () => cardMenu(el.dataset.id, el.dataset.zone, el.dataset.mine === '1')));
    root().querySelectorAll('[data-pile]').forEach((b) => (b.onclick = () => pileView(b.dataset.pile)));
    if (g.status !== 'playing') return;
    root().querySelectorAll('[data-life]').forEach(
      (b) => (b.onclick = () => {
        const d = Number(b.dataset.life);
        const before = s.life;
        act((st) => E.changeLife(st, d), `life ${before} → ${before + d}`).then(() => {
          if (game.status === 'playing' && game.me.state.life <= 0) zeroLife();
        });
      })
    );
    $('tbLib').onclick = libraryMenu;
    $('tbDraw').onclick = () => act((st) => E.draw(st, 1), (n) => (n ? 'drew a card' : 'tried to draw from an empty library'));
    $('tbUntap').onclick = () => act((st) => E.untapAll(st), 'untapped everything');
    $('tbPass').onclick = () => act(null, 'ended their turn', { pass: true });
    $('tbMore').onclick = moreMenu;
  }

  function zeroLife() {
    dialog(
      `<h3>You're at ${game.me.state.life} life</h3><p class="muted">In Magic you lose the game at 0 life. Admit defeat for this game?</p>
      <div class="row"><button class="btn" id="zlNo">Not yet</button><button class="btn danger" id="zlYes">I lose this game</button></div>`,
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
      (close) =>
        document.querySelectorAll('#dialogBox [data-i]').forEach(
          (el) => (el.onclick = () => {
            close();
            if (el.dataset.i !== 'x') buttons[Number(el.dataset.i)].fn();
          })
        )
    );
  }

  const verbLog = (to, where) =>
    ({
      graveyard: 'put into graveyard:',
      exile: 'exiled',
      hand: 'returned to hand:',
      battlefield: 'put onto the battlefield:',
      library: where === 'bottom' ? 'put on the bottom of their library:' : 'put on top of their library:',
    }[to]);

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
    if (g.status !== 'playing') return showBig(card);
    const mv = (to, where, verb) => ({ label: verb, fn: () => act((st) => E.move(st, id, to, where), `${verbLog(to, where)} ${name}`) });
    const view = { label: 'View card', fn: () => showBig(card) };
    let btns;
    if (zone === 'hand') {
      if (s.bottomOwed > 0) {
        // London mulligan: don't reveal which card went to the bottom.
        btns = [{ label: 'Put on the bottom (mulligan)', cls: 'primary', fn: () => act((st) => E.move(st, id, 'library', 'bottom'), 'put a card on the bottom (mulligan)') }, view];
      } else
        btns = [
          { label: E.isLand(card.c) ? 'Play land' : 'Cast / play', cls: 'primary', fn: () => act((st) => E.move(st, id, 'battlefield'), `played ${name}`) },
          mv('graveyard', null, 'Discard'),
          mv('exile', null, 'Exile'),
          { label: 'Put on top of library', fn: () => act((st) => E.move(st, id, 'library', 'top'), 'put a card from their hand on top of their library') },
          { label: 'Put on bottom of library', fn: () => act((st) => E.move(st, id, 'library', 'bottom'), 'put a card from their hand on the bottom of their library') },
          view,
        ];
    } else if (zone === 'battlefield')
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
      `<h3>Search your library</h3><p class="muted small">Only when a card tells you to. Tap a card to take it; your library is shuffled afterwards.</p>
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
    const canMull = game.turnNumber <= 2 && s.zones.battlefield.length === 0 && s.zones.graveyard.length === 0;
    sheet('More', null, [
      ...(canMull
        ? [{ label: `Mulligan (draw 7, then put ${s.mulligans + 1} on the bottom)`, fn: () => act((st) => E.mulligan(st), `took a mulligan (${s.mulligans + 1})`) }]
        : []),
      { label: 'Untap all & draw (start of turn)', fn: () => act((st) => (E.untapAll(st), E.draw(st, 1)), 'untapped and drew for the turn') },
      { label: 'Search library…', fn: searchLibrary },
      { label: 'Shuffle library', fn: () => act((st) => E.shuffle(st), 'shuffled their library') },
      { label: 'Concede this game', cls: 'danger', fn: confirmConcede },
    ]);
  }

  function confirmConcede() {
    dialog(
      `<h3>Concede this game?</h3><p class="muted">The match is best of three, so it may not be over.</p>
      <div class="row"><button class="btn" id="ccNo">Keep playing</button><button class="btn danger" id="ccYes">Concede</button></div>`,
      (close) => {
        document.getElementById('ccNo').onclick = close;
        document.getElementById('ccYes').onclick = () => {
          close();
          act(null, 'conceded the game', { lost: true });
        };
      }
    );
  }

  window.PRPackWars = { render: () => go(ui.screen === 'table' && game ? 'table' : 'home') };
})();
