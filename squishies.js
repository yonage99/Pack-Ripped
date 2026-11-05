/*
 * Pack Ripped: Squishies. Real brands, names only: you keep the list of brands and
 * items yourself (no official photos). Each brand has a blind bag that gives a random
 * item: common 70%, rare 25%, super rare 5%.
 */
(function () {
  'use strict';

  const PR = window.PR;
  const { esc, toast, dialog } = PR;
  const ODDS = { common: 0.7, rare: 0.25, super: 0.05 };
  const LABEL = { common: 'Common', rare: 'Rare', super: 'Super rare' };
  const APP_RARITY = { common: 'common', rare: 'rare', super: 'mythic' };
  const root = () => document.getElementById('squishRoot');
  let editing = null; // brand id being edited

  function data() {
    const s = PR.state;
    if (!s.squish) s.squish = { bagCost: 50, brands: [] };
    if (!s.squish.seeded) {
      // Starting brands; add the items you collect.
      for (const name of ['Nee-Doh', 'RMS'])
        if (!s.squish.brands.some((b) => b.name.toLowerCase() === name.toLowerCase())) s.squish.brands.push({ id: uid(), name, items: [] });
      s.squish.seeded = true;
    }
    return s.squish;
  }
  const uid = () => Math.random().toString(36).slice(2, 9);

  // A simple, original squishy tile (not brand art), colored from the item's name.
  function tile(name, rarity) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = h % 360;
    const body = `hsl(${hue},70%,72%)`;
    const shade = `hsl(${hue},60%,58%)`;
    const bg = rarity === 'super' ? '#2a1d55' : rarity === 'rare' ? '#1d2f55' : '#241f38';
    const sparkle = rarity === 'super' ? '<text x="40" y="70" font-size="30">✨</text><text x="180" y="120" font-size="22">✨</text>' : rarity === 'rare' ? '<text x="185" y="80" font-size="24">✨</text>' : '';
    const words = name.length > 18 ? name.slice(0, 17) + '…' : name;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 244 340">
      <rect width="244" height="340" rx="16" fill="${bg}"/>
      <ellipse cx="122" cy="270" rx="78" ry="12" fill="rgba(0,0,0,.35)"/>
      <path d="M44 200 C40 120 80 80 122 80 C164 80 204 120 200 200 C198 250 160 268 122 268 C84 268 46 250 44 200 Z" fill="${body}" stroke="${shade}" stroke-width="6"/>
      <ellipse cx="96" cy="128" rx="18" ry="10" fill="rgba(255,255,255,.55)"/>
      <circle cx="98" cy="190" r="8" fill="#2a2140"/><circle cx="146" cy="190" r="8" fill="#2a2140"/>
      <path d="M110 210 Q122 222 134 210" stroke="#2a2140" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="82" cy="208" r="9" fill="rgba(255,120,150,.45)"/><circle cx="162" cy="208" r="9" fill="rgba(255,120,150,.45)"/>
      ${sparkle}
      <text x="122" y="314" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="20" font-weight="700" fill="#f1edff">${esc(words)}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function cardFor(brand, item) {
    return {
      id: `sq:${brand.id}:${item.id}`,
      game: 'squishy',
      name: item.name,
      set: 'sq-' + brand.id,
      setName: brand.name,
      num: '',
      rarity: APP_RARITY[item.rarity] || 'common',
      rarityLabel: LABEL[item.rarity] || 'Common',
      type: `${brand.name} squishy`,
      img: tile(item.name, item.rarity),
      usd: 0,
      usdFoil: 0,
      basic: false,
      ci: '', // not a Magic card
      uri: '',
    };
  }

  function pick(brand) {
    let x = Math.random();
    let tier = 'common';
    for (const [t, p] of Object.entries(ODDS)) {
      if ((x -= p) < 0) {
        tier = t;
        break;
      }
    }
    // If the brand has no items of that rarity, fall back to the nearest one it has.
    const order = tier === 'super' ? ['super', 'rare', 'common'] : tier === 'rare' ? ['rare', 'common', 'super'] : ['common', 'rare', 'super'];
    for (const t of order) {
      const list = brand.items.filter((i) => i.rarity === t);
      if (list.length) return list[Math.floor(Math.random() * list.length)];
    }
    return null;
  }

  function openBag(brand) {
    const d = data();
    if (!brand.items.length) return toast('Add some items to this brand first');
    if (PR.state.points < d.bagCost) return toast(`You need ${d.bagCost} ◆ for a blind bag`);
    const item = pick(brand);
    const card = cardFor(brand, item);
    // Pay & record first, so closing the app mid-reveal doesn't lose it.
    PR.state.points -= d.bagCost;
    const c = PR.state.collection;
    const isNew = !c[card.id];
    const e = c[card.id] || (c[card.id] = { n: 0, f: 0, firstAt: Date.now(), card });
    e.card = card;
    e.n += 1;
    e.lastAt = Date.now();
    PR.state.history.unshift({ at: Date.now(), set: card.set, setName: `${brand.name} blind bag`, type: 'squishy', game: 'squishy', value: 0, best: card.name, cards: [[card.id, 0]] });
    PR.state.history = PR.state.history.slice(0, 30);
    PR.save();
    PR.renderPoints(true);
    dialog(
      `<div class="bag" id="sqBag"><div class="bag-top"></div><div class="bag-body"><span>?</span><b>${esc(brand.name)}</b><small>Blind bag</small></div></div>
      <p class="hint" id="sqHint">Tap the bag to open it</p>
      <div id="sqReveal" class="hidden">
        <div class="mini squish-big ${card.rarity}"><img src="${card.img}" alt="${esc(card.name)}"></div>
        <h3>${esc(card.name)} ${isNew ? '<span class="new-tag">NEW</span>' : ''}</h3>
        <p class="muted small"><span class="rarity-dot ${card.rarity}"></span>${card.rarityLabel} · ${esc(brand.name)}</p>
        <div class="row"><button class="btn" id="sqDone">Done</button><button class="btn primary" id="sqAgain" ${PR.state.points >= d.bagCost ? '' : 'disabled'}>Another (${d.bagCost} ◆)</button></div>
      </div>`,
      (close) => {
        document.getElementById('sqBag').onclick = () => {
          const bag = document.getElementById('sqBag');
          bag.classList.add('opening');
          if (window.PRSound) window.PRSound.shake();
          if (navigator.vibrate) navigator.vibrate(item.rarity === 'super' ? [40, 60, 80] : 25);
          setTimeout(() => {
            bag.remove();
            document.getElementById('sqHint').remove();
            document.getElementById('sqReveal').classList.remove('hidden');
            if (window.PRSound) window.PRSound.forCard(card, 0);
          }, 550);
        };
        document.getElementById('sqDone').onclick = () => {
          close();
          render();
        };
        document.getElementById('sqAgain').onclick = () => {
          close();
          openBag(brand);
        };
      }
    );
  }

  function render() {
    const el = root();
    if (!el) return;
    const d = data();
    const owned = (brand) => brand.items.filter((i) => PR.state.collection[`sq:${brand.id}:${i.id}`]).length;
    el.innerHTML = `
      <div class="card-panel">
        <h2>Squishies</h2>
        <p class="muted small">Real brands, names only: add the brands and items you collect, then open blind bags with your ◆. Each bag gives a random item from that brand: common 70%, rare 25%, super rare 5%. The pictures are simple stand-ins, not official photos.</p>
      </div>
      ${d.brands
        .map((b) => {
          const isEdit = editing === b.id;
          return `<div class="card-panel squish-brand" data-id="${esc(b.id)}">
            <div class="panel-head"><h2>${esc(b.name)}</h2><button class="link-btn" data-a="edit">${isEdit ? 'Done' : 'Edit'}</button></div>
            <p class="muted small">${b.items.length} item${b.items.length === 1 ? '' : 's'} · you own ${owned(b)}</p>
            ${
              isEdit
                ? `<ul class="sq-items">${b.items
                    .map(
                      (i) => `<li data-item="${esc(i.id)}"><span>${esc(i.name)}</span>
                      <select data-a="rarity">${Object.entries(LABEL).map(([k, l]) => `<option value="${k}" ${i.rarity === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
                      <button class="task-del" data-a="del" aria-label="Delete">✕</button></li>`
                    )
                    .join('') || '<li class="muted small">No items yet.</li>'}</ul>
                  <form class="add-task" data-a="add">
                    <input name="n" placeholder="Item name" maxlength="40" required>
                    <select name="r">${Object.entries(LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
                    <button class="btn" type="submit">Add</button>
                  </form>
                  <div class="row"><button class="btn" data-a="rename">Rename brand</button><button class="btn danger" data-a="remove">Delete brand</button></div>`
                : `<div class="sq-strip">${b.items
                    .slice(0, 8)
                    .map((i) => `<img src="${tile(i.name, i.rarity)}" alt="${esc(i.name)}" class="${PR.state.collection[`sq:${b.id}:${i.id}`] ? '' : 'unowned'}">`)
                    .join('')}</div>
                  <button class="btn primary wide" data-a="open" ${b.items.length && PR.state.points >= d.bagCost ? '' : 'disabled'}>${
                    b.items.length ? `Open a blind bag (${d.bagCost} ◆)` : 'Tap Edit to add items'
                  }</button>`
            }
          </div>`;
        })
        .join('')}
      <div class="card-panel">
        <form class="row" id="sqAddBrand" style="margin-top:0">
          <input id="sqBrandName" placeholder="Add a brand" maxlength="30" required>
          <button class="btn" type="submit" style="flex:none">Add</button>
        </form>
      </div>`;

    el.querySelectorAll('.squish-brand').forEach((box) => {
      const brand = d.brands.find((b) => b.id === box.dataset.id);
      const on = (a, ev, fn) => box.querySelectorAll(`[data-a=${a}]`).forEach((x) => x.addEventListener(ev, fn));
      on('edit', 'click', () => {
        editing = editing === brand.id ? null : brand.id;
        render();
      });
      on('open', 'click', () => openBag(brand));
      on('add', 'submit', (e) => {
        e.preventDefault();
        const f = e.target;
        const name = f.n.value.trim();
        if (!name) return;
        if (brand.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) return toast(`${brand.name} already has ${name}`);
        brand.items.push({ id: uid(), name, rarity: f.r.value });
        PR.save();
        render();
        const again = root().querySelector(`.squish-brand[data-id="${brand.id}"] input[name=n]`);
        if (again) again.focus();
      });
      box.querySelectorAll('.sq-items li[data-item]').forEach((li) => {
        const item = brand.items.find((i) => i.id === li.dataset.item);
        li.querySelector('[data-a=rarity]').onchange = (e) => {
          item.rarity = e.target.value;
          PR.save();
        };
        li.querySelector('[data-a=del]').onclick = () => {
          brand.items = brand.items.filter((i) => i !== item);
          PR.save();
          render();
        };
      });
      on('rename', 'click', () =>
        dialog(
          `<h3>Rename brand</h3><form id="rnForm" class="col"><input id="rnName" maxlength="30" value="${esc(brand.name)}" required>
          <div class="row"><button type="button" class="btn" id="rnNo">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`,
          (close) => {
            document.getElementById('rnNo').onclick = close;
            document.getElementById('rnForm').onsubmit = (e) => {
              e.preventDefault();
              brand.name = document.getElementById('rnName').value.trim() || brand.name;
              PR.save();
              close();
              render();
            };
          }
        )
      );
      on('remove', 'click', () =>
        dialog(
          `<h3>Delete ${esc(brand.name)}?</h3><p class="muted small">Its list goes away. Squishies you already opened stay in your collection.</p>
          <div class="row"><button class="btn" id="dbNo">Cancel</button><button class="btn danger" id="dbYes">Delete</button></div>`,
          (close) => {
            document.getElementById('dbNo').onclick = close;
            document.getElementById('dbYes').onclick = () => {
              d.brands = d.brands.filter((b) => b !== brand);
              editing = null;
              PR.save();
              close();
              render();
            };
          }
        )
      );
    });
    document.getElementById('sqAddBrand').onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById('sqBrandName').value.trim();
      if (!name) return;
      if (d.brands.some((b) => b.name.toLowerCase() === name.toLowerCase())) return toast(`You already have ${name}`);
      const b = { id: uid(), name, items: [] };
      d.brands.push(b);
      editing = b.id;
      PR.save();
      render();
    };
  }

  window.PRSquish = { render };
})();
