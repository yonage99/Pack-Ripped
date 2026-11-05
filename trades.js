/* Pack Ripped: trading cards with friends. */
(function () {
  'use strict';

  const PR = window.PR;
  const { esc, toast, dialog, money, cardPrice } = PR;
  const social = () => window.PRSocial || {};
  const rpc = (fn, args) => social().rpc(fn, args);
  const root = () => document.getElementById('friendsRoot');
  const coll = () => PR.state.collection;

  // ---------- applying completed trades on this phone ----------
  let applying = null;

  /** Fetch trades that finished since last time and apply them. Returns true if anything changed. */
  function applyEvents() {
    if (applying) return applying;
    applying = (async () => {
      const events = (await rpc('trade_events_since', { p_after: PR.state.tradeSeen || 0 })) || [];
      if (!events.length) return false;
      rememberNames();
      const summaries = [];
      for (const ev of events) {
        for (const r of ev.removes || []) change(r.id, r.foil, -r.qty, null);
        for (const a of ev.adds || []) change(a.id, a.foil, a.qty, a.card);
        PR.state.tradeSeen = Math.max(PR.state.tradeSeen || 0, ev.id);
        summaries.push(`With @${ev.other}: you gave ${listNames(ev.removes)} and got ${listNames(ev.adds)}.`);
      }
      const deckNotes = fixDecks();
      PR.save();
      showTradeDone(summaries, deckNotes);
      return true;
    })().finally(() => (applying = null));
    return applying;
  }

  function change(id, foil, delta, card) {
    const c = coll();
    let e = c[id];
    if (!e) {
      if (delta <= 0) return;
      // Card details travel with the trade; Commander info is refreshed from Scryfall later.
      const fresh = { ...(card || {}), id };
      if ((fresh.game || 'magic') === 'magic') delete fresh.ci; // Magic: refresh Commander info from Scryfall
      e = c[id] = { n: 0, f: 0, firstAt: Date.now(), card: fresh };
    }
    const k = foil ? 'f' : 'n';
    e[k] = Math.max(0, (e[k] || 0) + delta);
    e.lastAt = Date.now();
    if (e.n + e.f === 0) delete c[id];
  }

  const listNames = (items) =>
    (items || []).length ? items.map((i) => `${i.qty > 1 ? i.qty + '× ' : ''}${(i.card && i.card.name) || 'a card'}${i.foil ? ' (foil)' : ''}`).join(', ') : 'nothing';

  /**
   * After cards leave the collection, make every deck fit what you still own:
   * swap in another printing of the same card if you have one, otherwise take it out.
   */
  function fixDecks() {
    const notes = [];
    for (const deck of PR.state.decks || []) {
      const used = {};
      const avail = (id) => (coll()[id] ? coll()[id].n + coll()[id].f : 0) - (used[id] || 0);
      const otherPrinting = (name) =>
        Object.keys(coll()).find((id) => coll()[id].card.name === name && !coll()[id].card.basic && avail(id) > 0);
      const keepCmdrs = [];
      for (const id of deck.commanders) {
        if (avail(id) > 0) {
          used[id] = (used[id] || 0) + 1;
          keepCmdrs.push(id);
          continue;
        }
        const name = cardName(id, deck);
        const alt = name && otherPrinting(name);
        if (alt) {
          used[alt] = (used[alt] || 0) + 1;
          keepCmdrs.push(alt);
          notes.push(`“${deck.name}”: switched your commander ${name} to another copy you own.`);
        } else notes.push(`“${deck.name}”: your commander ${name || ''} was traded away. Pick a new commander.`);
      }
      deck.commanders = keepCmdrs;
      const next = {};
      for (const [id, qty] of Object.entries(deck.cards)) {
        let need = qty;
        const name = cardName(id, deck);
        const here = Math.min(need, Math.max(0, avail(id)));
        if (here) {
          next[id] = (next[id] || 0) + here;
          used[id] = (used[id] || 0) + here;
          need -= here;
        }
        while (need > 0) {
          const alt = name && otherPrinting(name);
          if (!alt) break;
          next[alt] = (next[alt] || 0) + 1;
          used[alt] = (used[alt] || 0) + 1;
          need -= 1;
        }
        if (need > 0) notes.push(`“${deck.name}”: ${name || 'a card'} ${need > 1 ? `×${need} ` : ''}left the deck (traded away), freeing ${need === 1 ? 'a slot' : need + ' slots'}.`);
        else if (here < qty) notes.push(`“${deck.name}”: switched ${name} to another copy you own.`);
      }
      deck.cards = next;
    }
    return notes;
  }

  // Remember names for cards that may already be gone from the collection.
  function cardName(id, deck) {
    if (coll()[id]) return coll()[id].card.name;
    return (deck._names && deck._names[id]) || null;
  }

  // Keep a small name lookup on each deck so traded-away cards can still be named.
  function rememberNames() {
    for (const deck of PR.state.decks || []) {
      deck._names = deck._names || {};
      for (const id of deck.commanders.concat(Object.keys(deck.cards))) if (coll()[id]) deck._names[id] = coll()[id].card.name;
    }
  }

  function showTradeDone(summaries, deckNotes) {
    dialog(
      `<h3>⇄ Trade complete</h3>
      ${summaries.map((s) => `<p class="small">${esc(s)}</p>`).join('')}
      ${deckNotes.length ? `<h3 style="margin-top:12px">Your decks</h3><ul class="problems">${deckNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <button class="btn primary wide" id="tdOk">Nice</button>`,
      (close) => (document.getElementById('tdOk').onclick = close)
    );
  }

  // ---------- trade list panel (Friends home) ----------
  async function renderPanel(el) {
    if (!el) return;
    let t;
    try {
      t = await rpc('trades_list');
    } catch {
      return;
    }
    const thumbs = (items) =>
      `<div class="trade-thumbs">${(items || [])
        .map((i) => `<div class="mini tiny ${i.foil ? 'is-foil' : ''}" title="${esc(i.card && i.card.name)}"><img src="${esc(PR.thumb(i.card && i.card.img))}" alt="" loading="lazy">${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}</div>`)
        .join('') || '<span class="muted small">nothing</span>'}</div>`;
    const tradeCard = (x, btns) => `<div class="trade" data-id="${esc(x.id)}">
        <div class="trade-head"><b>@${esc(x.other)}</b>${x.message ? `<span class="muted small">“${esc(x.message)}”</span>` : ''}</div>
        <div class="trade-sides"><div><small class="muted">You give</small>${thumbs(x.i_give)}</div><div><small class="muted">You get</small>${thumbs(x.i_get)}</div></div>
        ${btns}</div>`;
    const inc = t.incoming || [];
    const out = t.outgoing || [];
    const recent = t.recent || [];
    el.innerHTML =
      inc.length || out.length || recent.length
        ? `<div class="card-panel">
        <div class="panel-head"><h2>⇄ Trades</h2>${inc.length ? `<span class="badge">${inc.length}</span>` : ''}</div>
        ${inc.map((x) => tradeCard(x, '<div class="row"><button class="btn" data-a="no">Decline</button><button class="btn primary" data-a="yes">Accept trade</button></div>')).join('')}
        ${out.map((x) => tradeCard(x, '<div class="row"><span class="muted small" style="align-self:center">Waiting for them…</span><button class="btn" data-a="cancel" style="flex:none">Cancel</button></div>')).join('')}
        ${
          recent.length
            ? `<details class="manual"><summary>Recent trades</summary><ul class="people">${recent
                .map((x) => `<li><span class="pmeta"><b>@${esc(x.other)}</b><small>${{ accepted: '✓ traded', declined: 'declined', cancelled: 'cancelled' }[x.status] || x.status} · gave ${esc(listNames(x.i_give))} · got ${esc(listNames(x.i_get))}</small></span></li>`)
                .join('')}</ul></details>`
            : ''
        }
      </div>`
        : '';
    el.querySelectorAll('.trade').forEach((div) => {
      const id = div.dataset.id;
      const x = inc.concat(out).find((y) => y.id === id);
      const on = (a, fn) => div.querySelector(`[data-a=${a}]`) && (div.querySelector(`[data-a=${a}]`).onclick = fn);
      on('yes', () => confirmAccept(x, el));
      on('no', async () => {
        await rpc('trade_respond', { p_trade: id, p_accept: false }).catch(() => {});
        renderPanel(el);
      });
      on('cancel', async () => {
        await rpc('trade_cancel', { p_trade: id }).catch(() => {});
        renderPanel(el);
      });
      div.querySelectorAll('.mini.tiny').forEach((m, i) => {
        const items = (x.i_give || []).concat(x.i_get || []);
        m.onclick = () => bigCard(items[i]);
      });
    });
  }

  function bigCard(item) {
    if (!item || !item.card) return;
    dialog(
      `<div class="detail ${item.foil ? 'is-foil' : ''}"><img src="${esc(item.card.img)}" alt="">${item.foil ? '<div class="foil-sheen"></div>' : ''}</div>
      <h3>${esc(item.card.name)}${item.foil ? ' <span class="foil-tag">FOIL</span>' : ''}</h3>
      <p class="muted small">${esc(item.card.setName || '')} · ${money(cardPrice(item.card, item.foil))}</p>
      <button class="btn wide" id="bcClose">Close</button>`,
      (close) => (document.getElementById('bcClose').onclick = close)
    );
  }

  function confirmAccept(x, el) {
    const warn = deckWarnings(x.i_give);
    dialog(
      `<h3>Trade with @${esc(x.other)}?</h3>
      <p class="small">You give <b>${esc(listNames(x.i_give))}</b> (${money(value(x.i_give))})</p>
      <p class="small">You get <b>${esc(listNames(x.i_get))}</b> (${money(value(x.i_get))})</p>
      ${warn.length ? `<ul class="problems">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="row"><button class="btn" id="caNo">Not now</button><button class="btn primary" id="caYes">Accept</button></div>`,
      (close) => {
        document.getElementById('caNo').onclick = close;
        document.getElementById('caYes').onclick = async () => {
          close();
          try {
            rememberNames();
            await social().syncFresh(); // make sure the server sees your latest cards
            const res = await rpc('trade_respond', { p_trade: x.id, p_accept: true });
            if (res === 'unavailable') {
              toast('One of you no longer has some of those cards, so the trade can’t go through.');
            } else {
              await social().syncFresh(); // picks up the trade and updates your collection
            }
          } catch (e) {
            toast((e && e.message) || "Couldn't complete the trade");
          }
          renderPanel(el);
        };
      }
    );
  }

  const value = (items) => (items || []).reduce((s, i) => s + cardPrice(i.card || {}, i.foil) * i.qty, 0);

  /** Which of your decks lose a card if you give these away (and you have no spare copy)? */
  function deckWarnings(items) {
    const out = [];
    const leaving = {};
    for (const i of items || []) {
      const name = (coll()[i.id] && coll()[i.id].card.name) || (i.card && i.card.name);
      if (name) leaving[name] = (leaving[name] || 0) + i.qty;
    }
    const owned = {};
    for (const e of Object.values(coll())) owned[e.card.name] = (owned[e.card.name] || 0) + e.n + e.f;
    for (const deck of PR.state.decks || []) {
      const inDeck = {};
      deck.commanders.concat(Object.keys(deck.cards)).forEach((id) => {
        const c = coll()[id];
        if (c) inDeck[c.card.name] = (inDeck[c.card.name] || 0) + (deck.cards[id] || 1);
      });
      for (const [name, n] of Object.entries(leaving)) {
        const left = (owned[name] || 0) - n;
        if (inDeck[name] && left < inDeck[name]) {
          const isCmdr = deck.commanders.some((id) => coll()[id] && coll()[id].card.name === name);
          out.push(isCmdr ? `${name} is the commander of “${deck.name}”. The deck will need a new commander.` : `${name} will leave “${deck.name}”, freeing a slot.`);
        }
      }
    }
    return out;
  }

  // ---------- composing an offer ----------
  let draft = null; // { friend, theirs (collection), give: {key: qty}, get: {key: qty}, tab, q }
  const key = (id, foil) => `${id}|${foil ? 1 : 0}`;
  const unkey = (k) => ({ id: k.split('|')[0], foil: k.endsWith('|1') });

  function compose(friend, friendData) {
    draft = { friend, theirs: friendData.collection || {}, give: {}, get: {}, tab: 'get', q: '', msg: '' };
    renderCompose();
  }

  function itemsFrom(sel, source) {
    return Object.entries(sel)
      .filter(([, q]) => q > 0)
      .map(([k, qty]) => ({ ...unkey(k), qty, card: (source[unkey(k).id] || {}).card }));
  }

  function renderCompose() {
    const d = draft;
    const mine = d.tab === 'give';
    const source = mine ? coll() : d.theirs;
    const sel = mine ? d.give : d.get;
    const q = d.q.toLowerCase();
    const val = (e) => Math.max(e.n ? cardPrice(e.card, false) : 0, e.f ? cardPrice(e.card, true) : 0);
    const list = Object.values(source)
      .filter((e) => e.card && !e.card.basic && (!q || e.card.name.toLowerCase().includes(q)))
      .sort((a, b) => val(b) - val(a))
      .slice(0, 240);
    const give = itemsFrom(d.give, coll());
    const get = itemsFrom(d.get, d.theirs);
    const warn = deckWarnings(give);
    const y = window.scrollY;
    root().innerHTML = `
      <div class="card-panel">
        <button class="link-btn" id="tcBack">‹ @${esc(d.friend)}</button>
        <h2 style="margin-top:6px">⇄ Trade with @${esc(d.friend)}</h2>
        <p class="muted small">Pick cards from their collection and yours. They'll get your offer and can accept or decline.</p>
      </div>
      <div class="seg tabs-seg">
        <button data-t="get" class="${d.tab === 'get' ? 'on' : ''}">You get (${get.reduce((s, i) => s + i.qty, 0)})</button>
        <button data-t="give" class="${d.tab === 'give' ? 'on' : ''}">You give (${give.reduce((s, i) => s + i.qty, 0)})</button>
      </div>
      <div class="card-panel"><input type="search" id="tcSearch" placeholder="Search ${mine ? 'your' : `@${esc(d.friend)}'s`} cards…" value="${esc(d.q)}"></div>
      <div class="grid">${
        list
          .map((e) => {
            const n = (sel[key(e.card.id, false)] || 0) + (sel[key(e.card.id, true)] || 0);
            return `<div class="mini ${e.card.rarity} ${e.f ? 'is-foil' : ''} ${n ? 'picked' : ''}" data-id="${esc(e.card.id)}">
              <img src="${esc(PR.thumb(e.card.img))}" alt="${esc(e.card.name)}" loading="lazy">${e.f ? '<div class="foil-sheen"></div>' : ''}
              <span class="qty">${n ? `✓ ${n}/` : '×'}${e.n + e.f}</span></div>`;
          })
          .join('') || '<div class="empty"><p class="muted">No cards.</p></div>'
      }</div>
      <div class="card-panel trade-summary">
        <div class="trade-sides">
          <div><small class="muted">You give · ${money(value(give))}</small><p class="small">${esc(listNames(give))}</p></div>
          <div><small class="muted">You get · ${money(value(get))}</small><p class="small">${esc(listNames(get))}</p></div>
        </div>
        ${warn.length ? `<ul class="problems">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <input id="tcMsg" placeholder="Add a message (optional)" maxlength="200" value="${esc(d.msg)}">
        <button class="btn primary wide" id="tcSend" style="margin-top:8px" ${give.length || get.length ? '' : 'disabled'}>Send trade offer</button>
      </div>`;
    window.scrollTo(0, y);
    document.getElementById('tcBack').onclick = () => social().render();
    root().querySelectorAll('.tabs-seg button').forEach(
      (b) => (b.onclick = () => {
        d.tab = b.dataset.t;
        d.q = '';
        renderCompose();
      })
    );
    const s = document.getElementById('tcSearch');
    s.oninput = () => {
      d.q = s.value;
      const pos = s.selectionStart;
      renderCompose();
      const s2 = document.getElementById('tcSearch');
      s2.focus();
      s2.setSelectionRange(pos, pos);
    };
    document.getElementById('tcMsg').oninput = (e) => (d.msg = e.target.value);
    root().querySelectorAll('.grid .mini').forEach((m) => (m.onclick = () => pickQty(source[m.dataset.id], sel)));
    document.getElementById('tcSend').onclick = send;
  }

  function pickQty(e, sel) {
    const row = (foil, max) => {
      const k = key(e.card.id, foil);
      return max
        ? `<div class="pick-row" data-k="${k}" data-max="${max}"><span>${foil ? 'Foil' : 'Regular'} <small class="muted">(${max} owned · ${money(cardPrice(e.card, foil))})</small></span>
          <div class="stepper"><button data-d="-1">−</button><b>${sel[k] || 0}</b><button data-d="1">+</button></div></div>`
        : '';
    };
    dialog(
      `<img class="sheet-img" src="${esc(e.card.img)}" alt=""><h3>${esc(e.card.name)}</h3>
      <div class="col">${row(false, e.n)}${row(true, e.f)}</div>
      <button class="btn primary wide" id="pqDone" style="margin-top:10px">Done</button>`,
      (close) => {
        const box = document.getElementById('dialogBox');
        box.querySelectorAll('.pick-row').forEach((r) =>
          r.querySelectorAll('button').forEach(
            (b) => (b.onclick = () => {
              const k = r.dataset.k;
              sel[k] = Math.min(Number(r.dataset.max), Math.max(0, (sel[k] || 0) + Number(b.dataset.d)));
              r.querySelector('b').textContent = sel[k];
            })
          )
        );
        document.getElementById('pqDone').onclick = () => {
          close();
          renderCompose();
        };
      }
    );
  }

  async function send() {
    const d = draft;
    const strip = (items) => items.map((i) => ({ id: i.id, foil: i.foil, qty: i.qty }));
    const btn = document.getElementById('tcSend');
    btn.disabled = true;
    try {
      await social().syncFresh(); // the server checks your offer against your latest collection
      await rpc('trade_offer', { p_friend: d.friend, p_give: strip(itemsFrom(d.give, coll())), p_get: strip(itemsFrom(d.get, d.theirs)), p_message: d.msg || null });
      toast(`Trade offer sent to @${d.friend}`);
      draft = null;
      social().render();
    } catch (e) {
      toast((e && e.message) || "Couldn't send the offer");
      btn.disabled = false;
    }
  }

  window.PRTrades = { applyEvents, renderPanel, compose, fixDecks };
})();
