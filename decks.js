/* Pack Ripped: Commander deck builder. Uses only cards you own, plus unlimited basic lands. */
(function () {
  'use strict';

  const PR = window.PR;
  const C = window.Commander;
  const { esc, toast, dialog, money, cardPrice } = PR;
  const BASIC_KEY = 'packripped:basics';
  const root = () => document.getElementById('decksRoot');

  let view = { mode: 'list', deckId: null, tab: 'list', q: '', type: '' };
  let basicsArt = (() => {
    try { return JSON.parse(localStorage.getItem(BASIC_KEY)) || {}; } catch { return {}; }
  })();

  // ---------- data helpers ----------
  const decks = () => PR.state.decks || (PR.state.decks = []);
  const findDeck = (id) => decks().find((d) => d.id === id);
  const getCard = (id) => (PR.state.collection[id] || {}).card || null;

  function ownedByNameMap() {
    const m = {};
    for (const e of Object.values(PR.state.collection)) m[e.card.name] = (m[e.card.name] || 0) + e.n + e.f;
    return m;
  }

  // One entry per card name: the most valuable printing you own.
  function uniqueOwned() {
    const best = {};
    for (const e of Object.values(PR.state.collection)) {
      const c = e.card;
      if ((c.game || 'magic') !== 'magic') continue; // Commander decks use Magic cards only
      const v = Math.max(e.n ? cardPrice(c, false) : 0, e.f ? cardPrice(c, true) : 0);
      if (!best[c.name] || v > best[c.name].v) best[c.name] = { card: c, v, foil: !!e.f && (!e.n || cardPrice(c, true) >= cardPrice(c, false)) };
    }
    return Object.values(best);
  }

  function deckNameCounts(deck) {
    const m = {};
    deck.commanders.forEach((id) => {
      const c = getCard(id);
      if (c) m[c.name] = (m[c.name] || 0) + 1;
    });
    for (const [id, n] of Object.entries(deck.cards)) {
      const c = getCard(id);
      if (c) m[c.name] = (m[c.name] || 0) + n;
    }
    return m;
  }

  const validate = (deck) => {
    const owned = ownedByNameMap();
    return C.validate(deck, getCard, (n) => owned[n] || 0);
  };
  const commandersOf = (deck) => deck.commanders.map(getCard).filter(Boolean);

  // Older saves don't have Commander info on their cards. Fetch it from Scryfall in batches.
  let backfill = null;
  function ensureCardData() {
    const missing = Object.values(PR.state.collection).filter((e) => e.card.ci === undefined && (e.card.game || 'magic') === 'magic');
    if (!missing.length) return Promise.resolve(true);
    if (backfill) return backfill;
    backfill = (async () => {
      for (let i = 0; i < missing.length; i += 75) {
        const batch = missing.slice(i, i + 75);
        const res = await fetch(PR.API + '/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ identifiers: batch.map((e) => ({ id: e.card.id })) }),
        }).then((r) => r.json());
        for (const raw of res.data || []) {
          const e = PR.state.collection[raw.id];
          if (e) e.card = PR.slimCard(raw);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      PR.save();
      return true;
    })()
      .catch(() => false)
      .finally(() => (backfill = null));
    return backfill;
  }

  async function ensureBasicsArt() {
    const need = C.BASICS.filter((b) => !basicsArt[b.name]);
    if (!need.length) return;
    for (const b of need) {
      try {
        const set = b.name === 'Wastes' ? '' : '&set=fdn';
        const r = await fetch(`${PR.API}/cards/named?exact=${encodeURIComponent(b.name)}${set}`).then((x) => x.json());
        const img = r.image_uris || {};
        if (img.normal) basicsArt[b.name] = img.normal;
      } catch {}
      await new Promise((r) => setTimeout(r, 110));
    }
    try { localStorage.setItem(BASIC_KEY, JSON.stringify(basicsArt)); } catch {}
  }

  // ---------- rendering bits ----------
  const PIP = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const pips = (identity) =>
    identity ? identity.split('').map((x) => `<span class="pip pip-${x}">${x}</span>`).join('') : '<span class="pip pip-C">C</span>';

  function manaCost(m) {
    if (!m) return '';
    return (m.match(/\{[^}]+\}/g) || [])
      .map((t) => {
        const v = t.slice(1, -1);
        const cls = /^[WUBRG]$/.test(v) ? 'pip-' + v : /^\d+$|^X$/.test(v) ? 'pip-N' : 'pip-H';
        return `<span class="pip sm ${cls}">${esc(v.replace('/', ''))}</span>`;
      })
      .join('');
  }

  function render() {
    const r = root();
    if (!r) return;
    const needs = Object.values(PR.state.collection).some((e) => e.card.ci === undefined && (e.card.game || 'magic') === 'magic');
    if (needs) {
      r.innerHTML = `<div class="card-panel"><div class="spinner"></div><p class="muted center-text">Getting deck info for your cards…</p></div>`;
      ensureCardData().then((ok) => {
        if (ok && !Object.values(PR.state.collection).some((e) => e.card.ci === undefined && (e.card.game || 'magic') === 'magic')) return render();
        r.innerHTML = `<div class="card-panel"><p>Couldn't load card info. Check your connection.</p>
          <button class="btn" id="dkRetry">Retry</button></div>`;
        document.getElementById('dkRetry').onclick = render;
      });
      return;
    }
    if (view.mode === 'edit' && findDeck(view.deckId)) renderEditor(findDeck(view.deckId));
    else if (view.mode === 'pick') renderCommanderPicker();
    else renderList();
  }

  // ---------- deck list ----------
  function renderList() {
    view.mode = 'list';
    const list = decks();
    root().innerHTML = `
      <div class="card-panel">
        <div class="panel-head"><h2>Commander decks</h2><span class="muted small">${list.length} deck${list.length === 1 ? '' : 's'}</span></div>
        <p class="muted small">Build 100-card Commander decks with cards from your collection. Basic lands are free and unlimited.</p>
        <button class="btn primary wide" id="dkNew">+ New deck</button>
      </div>
      ${list
        .map((d) => {
          const v = validate(d);
          const cm = commandersOf(d);
          return `<button class="deck-item" data-id="${esc(d.id)}">
            <div class="deck-art">${cm.map((c) => `<img src="${esc(PR.thumb(c.img))}" alt="">`).join('')}</div>
            <div class="deck-meta">
              <b>${esc(d.name)}</b>
              <span>${pips(v.identity)}</span>
              <small>${v.count}/100 · ${
                v.ok ? '<span class="ok">Legal ✓</span>' : v.problems.length ? `<span class="bad">${v.problems.length} issue${v.problems.length === 1 ? '' : 's'}</span>` : 'In progress'
              }</small>
            </div>
          </button>`;
        })
        .join('')}`;
    document.getElementById('dkNew').onclick = () => {
      view = { ...view, mode: 'pick', pickFor: null, q: '' };
      render();
    };
    root().querySelectorAll('.deck-item').forEach(
      (b) => (b.onclick = () => {
        view = { mode: 'edit', deckId: b.dataset.id, tab: 'list', q: '', type: '' };
        render();
        window.scrollTo(0, 0);
      })
    );
  }

  // ---------- commander picker (new deck or partner) ----------
  function renderCommanderPicker() {
    const partnerFor = view.pickFor ? findDeck(view.pickFor) : null;
    const first = partnerFor ? getCard(partnerFor.commanders[0]) : null;
    const q = (view.q || '').toLowerCase();
    let options = uniqueOwned()
      .map((o) => o.card)
      .filter((c) => (first ? C.canPair(first, c) : C.isCommander(c)))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));

    root().innerHTML = `
      <div class="card-panel">
        <button class="link-btn" id="pkBack">‹ Back</button>
        <h2>${first ? `Choose a partner for ${esc(first.name)}` : 'Choose your commander'}</h2>
        <p class="muted small">${
          first
            ? 'These are the cards you own that can be its second commander.'
            : 'Legendary creatures you own, plus cards that say they can be your commander.'
        }</p>
        <input type="search" id="pkSearch" placeholder="Search…" value="${esc(view.q || '')}">
      </div>
      <div class="grid" id="pkGrid">
        ${
          options.length
            ? options
                .map(
                  (c) => `<div class="mini pick ${c.rarity}" data-id="${esc(c.id)}">
              <img src="${esc(PR.thumb(c.img))}" alt="${esc(c.name)}" loading="lazy">
              <span class="qty">${pips(c.ci)}</span>
            </div>`
                )
                .join('')
            : `<div class="empty"><p>${first ? 'No matching partner in your collection yet.' : "You don't own a commander yet."}</p>
               <p class="muted">${first ? 'Keep opening packs!' : 'Open packs to find a legendary creature. Every Play Booster and Collector Booster can have one.'}</p></div>`
        }
      </div>`;
    document.getElementById('pkBack').onclick = () => {
      view = partnerFor ? { mode: 'edit', deckId: partnerFor.id, tab: 'list', q: '', type: '' } : { mode: 'list' };
      render();
    };
    const s = document.getElementById('pkSearch');
    s.oninput = () => {
      view.q = s.value;
      const pos = s.selectionStart;
      renderCommanderPicker();
      const s2 = document.getElementById('pkSearch');
      s2.focus();
      s2.setSelectionRange(pos, pos);
    };
    root().querySelectorAll('.pick').forEach(
      (m) => (m.onclick = () => {
        const id = m.dataset.id;
        if (partnerFor) {
          // If the partner was already in the 99, move it to the command zone.
          delete partnerFor.cards[id];
          partnerFor.commanders = [partnerFor.commanders[0], id];
          PR.save();
          view = { mode: 'edit', deckId: partnerFor.id, tab: 'list', q: '', type: '' };
        } else {
          const c = getCard(id);
          const d = { id: 'd' + Date.now(), name: c.name, commanders: [id], cards: {}, basics: {}, createdAt: Date.now() };
          decks().unshift(d);
          PR.save();
          view = { mode: 'edit', deckId: d.id, tab: 'add', q: '', type: '' };
          toast(`New deck: ${c.name}`);
        }
        render();
        window.scrollTo(0, 0);
      })
    );
  }

  // ---------- editor ----------
  function renderEditor(deck) {
    const v = validate(deck);
    const cmdrs = commandersOf(deck);
    const first = cmdrs[0];
    const pct = Math.min(100, v.count);
    root().innerHTML = `
      <div class="card-panel">
        <div class="panel-head">
          <button class="link-btn" id="edBack">‹ Decks</button>
          <button class="link-btn" id="edMenu">•••</button>
        </div>
        <input class="deck-name" id="edName" value="${esc(deck.name)}" maxlength="60" aria-label="Deck name">
        <div class="cmdr-row">
          ${cmdrs.map((c) => `<div class="cmdr" data-id="${esc(c.id)}"><img src="${esc(c.img)}" alt="${esc(c.name)}"></div>`).join('')}
          ${
            first && C.wantsPartner(first) && cmdrs.length < 2
              ? `<button class="cmdr add-partner" id="edPartner">+<small>${first.pair === 'chooseBg' ? 'Add Background' : 'Add partner'}</small></button>`
              : ''
          }
        </div>
        <div class="identity">${pips(v.identity)} <span class="muted small">Color identity</span></div>
        <div class="count-row"><b class="${v.count === 100 ? 'ok' : v.count > 100 ? 'bad' : ''}">${v.count}</b><span class="muted">/ 100 cards</span></div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        ${
          v.ok
            ? '<p class="ok">✓ Legal Commander deck. Ready to play!</p>'
            : (v.problems.length ? `<ul class="problems">${v.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '') +
              v.warnings.map((w) => `<p class="muted small">${esc(w)}</p>`).join('')
        }
      </div>
      <button class="btn wide mx-btn" id="edExport">⇪ Export to Moxfield</button>
      <div class="seg tabs-seg">
        <button data-tab="list" class="${view.tab === 'list' ? 'on' : ''}">Deck list</button>
        <button data-tab="add" class="${view.tab === 'add' ? 'on' : ''}">Add cards</button>
      </div>
      <div id="edBody"></div>`;

    document.getElementById('edBack').onclick = () => {
      view = { mode: 'list' };
      render();
    };
    const nameIn = document.getElementById('edName');
    nameIn.onchange = () => {
      deck.name = nameIn.value.trim() || (first ? first.name : 'Untitled deck');
      PR.save();
    };
    document.getElementById('edMenu').onclick = () => deckMenu(deck);
    document.getElementById('edExport').onclick = () => exportToMoxfield(deck);
    root().querySelectorAll('.cmdr[data-id]').forEach((el) => (el.onclick = () => commanderMenu(deck, el.dataset.id)));
    const pb = document.getElementById('edPartner');
    if (pb) pb.onclick = () => {
      view = { ...view, mode: 'pick', pickFor: deck.id, q: '' };
      render();
    };
    root().querySelectorAll('.tabs-seg button').forEach(
      (b) => (b.onclick = () => {
        view.tab = b.dataset.tab;
        renderEditor(deck);
      })
    );
    if (view.tab === 'add') renderAdd(deck, v);
    else renderDeckList(deck, v);
  }

  function renderDeckList(deck, v) {
    const groups = {};
    let nonLand = 0, cmcSum = 0, lands = 0;
    for (const [id, n] of Object.entries(deck.cards)) {
      const c = getCard(id);
      if (!c) continue;
      const g = C.typeGroup(c.front || c.type);
      (groups[g] = groups[g] || []).push({ c, n, id });
      if (g === 'Lands') lands += n;
      else {
        nonLand += n;
        cmcSum += (c.cmc || 0) * n;
      }
    }
    const basicTotal = C.BASICS.reduce((s, b) => s + (deck.basics[b.name] || 0), 0);
    lands += basicTotal;
    const order = ['Creatures', 'Planeswalkers', 'Battles', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Other'];
    const allowedBasics = C.BASICS.filter((b) => C.fitsIdentity(b.color, v.identity) || deck.basics[b.name]);
    const body = document.getElementById('edBody');
    body.innerHTML = `
      <div class="card-panel stats-row">
        <div><b>${lands}</b><small>lands</small></div>
        <div><b>${(groups.Creatures || []).reduce((s, x) => s + x.n, 0)}</b><small>creatures</small></div>
        <div><b>${nonLand ? (cmcSum / nonLand).toFixed(2) : '–'}</b><small>avg mana value</small></div>
        <div><b>${money(deckValue(deck))}</b><small>value</small></div>
      </div>
      ${order
        .filter((g) => groups[g])
        .map(
          (g) => `<div class="card-panel">
          <div class="panel-head"><h2>${g}</h2><span class="muted">${groups[g].reduce((s, x) => s + x.n, 0)}</span></div>
          <ul class="dl">${groups[g]
            .sort((a, b) => (a.c.cmc || 0) - (b.c.cmc || 0) || a.c.name.localeCompare(b.c.name))
            .map(
              ({ c, n, id }) => `<li data-id="${esc(id)}">
                <span class="dl-n">${n}</span>
                <span class="dl-name"><span class="rarity-dot ${c.rarity}"></span>${esc(c.name)}</span>
                <span class="dl-cost">${manaCost(c.mana)}</span>
                <button class="dl-minus" aria-label="Remove one">−</button>
              </li>`
            )
            .join('')}</ul>
        </div>`
        )
        .join('')}
      <div class="card-panel">
        <div class="panel-head"><h2>Basic lands</h2><span class="muted">${basicTotal} · free & unlimited</span></div>
        <div class="basics">
          ${allowedBasics
            .map(
              (b) => `<div class="basic" data-name="${b.name}">
              <div class="basic-art">${basicsArt[b.name] ? `<img src="${esc(basicsArt[b.name])}" alt="">` : `<span>${b.name[0]}</span>`}</div>
              <div class="basic-name">${b.name}</div>
              <div class="stepper"><button data-d="-1">−</button><b>${deck.basics[b.name] || 0}</b><button data-d="1">+</button></div>
            </div>`
            )
            .join('')}
        </div>
        <button class="btn wide" id="edFill" ${v.count >= 100 ? 'disabled' : ''}>Fill the rest with basic lands</button>
      </div>`;

    body.querySelectorAll('.dl li').forEach((li) => {
      li.querySelector('.dl-name').onclick = () => PR.showCard(li.dataset.id);
      li.querySelector('.dl-minus').onclick = () => {
        const id = li.dataset.id;
        deck.cards[id] -= 1;
        if (deck.cards[id] <= 0) delete deck.cards[id];
        PR.save();
        renderEditor(deck);
      };
    });
    body.querySelectorAll('.basic').forEach((el) =>
      el.querySelectorAll('button').forEach(
        (b) => (b.onclick = () => {
          const n = Math.max(0, (deck.basics[el.dataset.name] || 0) + parseInt(b.dataset.d, 10));
          if (n) deck.basics[el.dataset.name] = n;
          else delete deck.basics[el.dataset.name];
          PR.save();
          renderEditor(deck);
        })
      )
    );
    document.getElementById('edFill').onclick = () => {
      const left = 100 - v.count;
      if (left <= 0) return;
      const colors = v.identity ? v.identity.split('').map((x) => PIP[x]) : ['Wastes'];
      colors.forEach((name, i) => {
        const share = Math.floor(left / colors.length) + (i < left % colors.length ? 1 : 0);
        if (share) deck.basics[name] = (deck.basics[name] || 0) + share;
      });
      PR.save();
      toast(`Added ${left} basic land${left === 1 ? '' : 's'}`);
      renderEditor(deck);
    };
    if (C.BASICS.some((b) => !basicsArt[b.name])) ensureBasicsArt().then(() => view.tab === 'list' && view.deckId === deck.id && view.mode === 'edit' && renderEditor(deck));
  }

  function deckValue(deck) {
    let s = 0;
    deck.commanders.concat(Object.keys(deck.cards)).forEach((id) => {
      const e = PR.state.collection[id];
      if (!e) return;
      const n = deck.cards[id] || 1;
      s += cardPrice(e.card, !e.n && e.f > 0) * n;
    });
    return s;
  }

  function renderAdd(deck, v) {
    const owned = ownedByNameMap();
    const inDeck = deckNameCounts(deck);
    const q = (view.q || '').toLowerCase();
    const all = uniqueOwned()
      .map((o) => o.card)
      .filter((c) => !c.basic && C.fitsIdentity(c.ci, v.identity))
      .filter((c) => !commandersOf(deck).some((k) => k.name === c.name));
    const list = all
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.type || '').toLowerCase().includes(q))
      .filter((c) => !view.type || C.typeGroup(c.front || c.type) === view.type)
      .map((c) => {
        const max = Math.min(c.copies || 1, owned[c.name] || 0);
        const used = inDeck[c.name] || 0;
        return { c, used, max, banned: c.legal && c.legal !== 'legal' };
      })
      .sort((a, b) => (a.used >= a.max) - (b.used >= b.max) || a.banned - b.banned || a.c.name.localeCompare(b.c.name));

    const body = document.getElementById('edBody');
    const types = ['Creatures', 'Planeswalkers', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Battles'];
    body.innerHTML = `
      <div class="card-panel">
        <p class="muted small">Showing ${all.length} cards you own that fit ${pips(v.identity)}. Tap a card to add it, or tap ⓘ for a closer look.</p>
        <div class="filters two">
          <input type="search" id="adSearch" placeholder="Search name or type…" value="${esc(view.q || '')}">
          <select id="adType"><option value="">All types</option>${types
            .map((t) => `<option ${view.type === t ? 'selected' : ''}>${t}</option>`)
            .join('')}</select>
        </div>
      </div>
      <div class="grid" id="adGrid">
        ${
          list.length
            ? list
                .map(
                  ({ c, used, max, banned }) => `<div class="mini addable ${c.rarity} ${used >= max || banned ? 'maxed' : ''}" data-id="${esc(c.id)}">
              <img src="${esc(PR.thumb(c.img))}" alt="${esc(c.name)}" loading="lazy">
              <button class="info" aria-label="Details">ⓘ</button>
              ${banned ? '<span class="tag bad-tag">Banned</span>' : used ? `<span class="tag">${used >= max ? 'In deck ✓' : `${used}/${max}`}</span>` : ''}
            </div>`
                )
                .join('')
            : `<div class="empty"><p class="muted">${all.length ? 'No cards match.' : 'None of your cards fit this commander yet. Open more packs!'}</p></div>`
        }
      </div>`;

    const s = document.getElementById('adSearch');
    s.oninput = () => {
      view.q = s.value;
      const pos = s.selectionStart;
      renderAdd(deck, v);
      const s2 = document.getElementById('adSearch');
      s2.focus();
      s2.setSelectionRange(pos, pos);
    };
    document.getElementById('adType').onchange = (e) => {
      view.type = e.target.value;
      renderAdd(deck, v);
    };
    body.querySelectorAll('.addable').forEach((m) => {
      m.querySelector('.info').onclick = (e) => {
        e.stopPropagation();
        PR.showCard(m.dataset.id);
      };
      m.onclick = () => {
        const c = getCard(m.dataset.id);
        const item = list.find((x) => x.c.id === c.id);
        if (item.banned) return toast(`${c.name} is banned in Commander`);
        if (item.used >= item.max)
          return toast(item.max > 1 ? `You've used all ${item.max} copies you own` : `${c.name} is already in this deck`);
        if (deck.commanders.includes(c.id)) return toast(`${c.name} is your commander`);
        // Reuse the printing already in the deck if there is one.
        const existing = Object.keys(deck.cards).find((id) => (getCard(id) || {}).name === c.name);
        const id = existing || c.id;
        deck.cards[id] = (deck.cards[id] || 0) + 1;
        PR.save();
        if (navigator.vibrate) navigator.vibrate(10);
        toast(`Added ${c.name} · ${validate(deck).count}/100`);
        const scroll = window.scrollY;
        renderEditor(deck);
        window.scrollTo(0, scroll);
      };
    });
  }

  // ---------- menus ----------
  function commanderMenu(deck, id) {
    const c = getCard(id);
    const isFirst = deck.commanders[0] === id;
    dialog(
      `<h3>${esc(c.name)}</h3>
      <div class="col">
        <button class="btn" data-a="view">View card</button>
        ${!isFirst ? '<button class="btn" data-a="remove">Remove partner</button>' : ''}
        ${isFirst ? '<button class="btn" data-a="change">Change commander…</button>' : ''}
        <button class="btn primary" data-a="close">Close</button>
      </div>`,
      (close) => {
        const box = document.getElementById('dialogBox');
        box.querySelector('[data-a=view]').onclick = () => {
          close();
          PR.showCard(id);
        };
        box.querySelector('[data-a=close]').onclick = close;
        const rm = box.querySelector('[data-a=remove]');
        if (rm) rm.onclick = () => {
          deck.commanders = [deck.commanders[0]];
          PR.save();
          close();
          renderEditor(deck);
        };
        const ch = box.querySelector('[data-a=change]');
        if (ch) ch.onclick = () => {
          close();
          // Start a picker; keep the 99 and just swap who leads.
          view = { ...view, mode: 'pick', pickFor: null, q: '', swapFor: deck.id };
          renderSwapPicker(deck);
        };
      }
    );
  }

  function renderSwapPicker(deck) {
    const options = uniqueOwned()
      .map((o) => o.card)
      .filter((c) => C.isCommander(c))
      .sort((a, b) => a.name.localeCompare(b.name));
    root().innerHTML = `
      <div class="card-panel">
        <button class="link-btn" id="swBack">‹ Back</button>
        <h2>New commander for “${esc(deck.name)}”</h2>
        <p class="muted small">Your other cards stay in the deck. Any that no longer fit the colors will be flagged.</p>
      </div>
      <div class="grid">${options
        .map((c) => `<div class="mini pick ${c.rarity}" data-id="${esc(c.id)}"><img src="${esc(PR.thumb(c.img))}" alt="${esc(c.name)}" loading="lazy"></div>`)
        .join('')}</div>`;
    const back = () => {
      view = { mode: 'edit', deckId: deck.id, tab: 'list', q: '', type: '' };
      render();
    };
    document.getElementById('swBack').onclick = back;
    root().querySelectorAll('.pick').forEach(
      (m) => (m.onclick = () => {
        delete deck.cards[m.dataset.id];
        deck.commanders = [m.dataset.id];
        PR.save();
        back();
      })
    );
  }

  // Moxfield import format: "1 Card Name (SET) 123 *F*". Set/number/foil keep the exact printing you pulled.
  function cardLine(id, n, exact) {
    const e = PR.state.collection[id];
    const c = e && e.card;
    if (!c) return null;
    if (!exact) return `${n} ${c.name}`;
    const foil = e.f > 0 && e.n === 0 ? ' *F*' : '';
    return `${n} ${c.name} (${String(c.set).toUpperCase()}) ${c.num}${foil}`;
  }

  function decklistText(deck, exact) {
    const lines = ['Commander'];
    deck.commanders.forEach((id) => {
      const l = cardLine(id, 1, exact);
      if (l) lines.push(l);
    });
    lines.push('', 'Deck');
    for (const [id, n] of Object.entries(deck.cards)) {
      const l = cardLine(id, n, exact);
      if (l) lines.push(l);
    }
    C.BASICS.forEach((b) => deck.basics[b.name] && lines.push(`${deck.basics[b.name]} ${b.name}`));
    return lines.join('\n');
  }

  // Copy text inside a tap handler. Falls back to selecting a textarea for older browsers.
  function copyText(text, ta) {
    let ok = false;
    try {
      if (ta) {
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = document.execCommand && document.execCommand('copy');
      }
    } catch {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => ok);
    }
    return Promise.resolve(ok);
  }

  let exactPrintings = true;
  function exportToMoxfield(deck) {
    const v = validate(deck);
    const draw = () => {
      const text = decklistText(deck, exactPrintings);
      dialog(
        `<h3>Export to Moxfield</h3>
        ${v.ok ? '<p class="ok small">✓ Legal 100-card Commander deck</p>' : `<p class="bad small">Heads up: this deck isn't legal yet (${v.count}/100${v.problems.length ? `, ${v.problems.length} issue${v.problems.length === 1 ? '' : 's'}` : ''}). You can still export it.</p>`}
        <textarea class="backup" id="mxText" readonly>${esc(text)}</textarea>
        <label class="check"><input type="checkbox" id="mxExact" ${exactPrintings ? 'checked' : ''}> Keep my exact printings (set, number, foil)</label>
        <div class="col">
          <a class="btn primary" id="mxGo" href="https://moxfield.com/" target="_blank" rel="noopener">Copy list &amp; open Moxfield</a>
          <div class="row" style="margin-top:0">
            <button class="btn" id="mxCopy">Copy only</button>
            ${navigator.share ? '<button class="btn" id="mxShare">Share…</button>' : ''}
          </div>
        </div>
        <ol class="steps">
          <li>Tap <b>Copy list &amp; open Moxfield</b> and sign in.</li>
          <li>Tap <b>Create Deck</b> (or <b>Import</b>), set the format to <b>Commander</b>.</li>
          <li>Paste into the import box and save.</li>
          <li>If the commander isn't set automatically, tap it in Moxfield and choose <b>Set as Commander</b>.</li>
        </ol>
        <button class="btn wide" id="mxClose">Close</button>`,
        (close) => {
          const ta = document.getElementById('mxText');
          document.getElementById('mxClose').onclick = close;
          document.getElementById('mxExact').onchange = (e) => {
            exactPrintings = e.target.checked;
            draw();
          };
          document.getElementById('mxGo').onclick = () => {
            // Don't block the link: copy runs during the same tap, then Moxfield opens.
            copyText(text, ta).then((ok) => toast(ok ? 'Decklist copied. Paste it in Moxfield' : 'Copy the list above, then paste it in Moxfield'));
          };
          document.getElementById('mxCopy').onclick = () =>
            copyText(text, ta).then((ok) => toast(ok ? 'Decklist copied' : 'Select the text above and copy it'));
          const sh = document.getElementById('mxShare');
          if (sh) sh.onclick = () => navigator.share({ title: deck.name, text }).catch(() => {});
        }
      );
    };
    draw();
  }

  function deckMenu(deck) {
    dialog(
      `<h3>${esc(deck.name)}</h3>
      <div class="col">
        <button class="btn" data-a="copy">Export to Moxfield</button>
        <button class="btn" data-a="dup">Duplicate deck</button>
        <button class="btn danger" data-a="del">Delete deck</button>
        <button class="btn primary" data-a="close">Close</button>
      </div>
      `,
      (close) => {
        const box = document.getElementById('dialogBox');
        box.querySelector('[data-a=close]').onclick = close;
        box.querySelector('[data-a=copy]').onclick = () => exportToMoxfield(deck);
        box.querySelector('[data-a=dup]').onclick = () => {
          const copy = JSON.parse(JSON.stringify(deck));
          copy.id = 'd' + Date.now();
          copy.name = deck.name + ' (copy)';
          decks().unshift(copy);
          PR.save();
          close();
          view = { mode: 'edit', deckId: copy.id, tab: 'list', q: '', type: '' };
          render();
        };
        box.querySelector('[data-a=del]').onclick = () => {
          box.innerHTML = `<h3>Delete “${esc(deck.name)}”?</h3><p class="muted">Your cards stay in your collection.</p>
            <div class="row"><button class="btn" id="delNo">Cancel</button><button class="btn danger" id="delYes">Delete</button></div>`;
          document.getElementById('delNo').onclick = close;
          document.getElementById('delYes').onclick = () => {
            PR.state.decks = decks().filter((d) => d !== deck);
            PR.save();
            close();
            view = { mode: 'list' };
            render();
          };
        };
      }
    );
  }

  window.PRDecks = { render, ensureCardData };
})();
