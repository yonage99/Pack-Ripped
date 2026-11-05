/*
 * Pokémon TCG packs, using card data from TCGdex (https://tcgdex.dev, free and open source).
 *
 * The Pokémon Company doesn't publish pull rates. The odds below are approximate,
 * based on widely cited community pull-rate studies for modern English booster packs:
 *
 * Scarlet & Violet / Mega Evolution booster (10 cards):
 *   4 commons, 3 uncommons, 1 reverse holo (common/uncommon/rare),
 *   1 "hit" slot: Illustration Rare ~1 in 13, Special Illustration Rare ~1 in 58,
 *     Hyper Rare ~1 in 140, ACE SPEC ~1 in 20 (sets that have them), Shiny ~1 in 8
 *     (shiny sets), otherwise another reverse holo,
 *   1 rare slot: Double Rare ~1 in 6, Ultra Rare ~1 in 15, otherwise Rare.
 * Sword & Shield booster (10 cards):
 *   5 commons, 3 uncommons, 1 reverse holo,
 *   1 rare slot: V/VMAX/VSTAR/Ultra ~1 in 7, Secret ~1 in 40, Radiant/Amazing ~1 in 20,
 *     Holo Rare ~1 in 3, otherwise Rare.
 */
(function (root) {
  'use strict';

  const API = 'https://api.tcgdex.net/v2/en';
  const SERIES = [
    { id: 'me', name: 'Mega Evolution', era: 'sv' },
    { id: 'sv', name: 'Scarlet & Violet', era: 'sv' },
    { id: 'swsh', name: 'Sword & Shield', era: 'swsh' },
  ];
  // Sub-sets and products that aren't sold as regular booster packs.
  const SKIP = /promo|energy|trainer gallery|galarian gallery|classic collection|futsal|my first battle|shiny vault|celebrations/i;
  const SETS_KEY = 'packripped:pksets2';
  const POOL_PREFIX = 'packripped:pkpool:';

  // Rarity names used by TCGdex for modern sets, grouped by how rare they are.
  const RARITY = {
    'Common': 'common',
    'Uncommon': 'uncommon',
    'Rare': 'rare',
    'Holo Rare': 'holo',
    'Double rare': 'double',
    'Ultra Rare': 'ultra',
    'Holo Rare V': 'ultra',
    'Holo Rare VMAX': 'ultra',
    'Holo Rare VSTAR': 'ultra',
    'Illustration rare': 'illus',
    'Special illustration rare': 'sir',
    'Hyper rare': 'hyper',
    'Mega Hyper Rare': 'hyper',
    'Secret Rare': 'secret',
    'ACE SPEC Rare': 'ace',
    'Radiant Rare': 'radiant',
    'Amazing Rare': 'radiant',
    'Shiny rare': 'shiny',
    'Shiny rare V': 'shiny',
    'Shiny rare VMAX': 'shiny',
    'Shiny Ultra Rare': 'sir',
  };
  // For the app's color coding (glow, sorting): common / uncommon / rare / mythic.
  const APP_RARITY = { common: 'common', uncommon: 'uncommon', rare: 'rare', holo: 'rare' };

  const SLOTS = {
    sv: [
      ['4', 'Commons'],
      ['3', 'Uncommons'],
      ['1', 'Reverse holo (common, uncommon or rare)'],
      ['1', 'Hit or reverse holo: Illustration Rare ~1 in 13, Special Illustration Rare ~1 in 58, Hyper Rare ~1 in 140 (plus ACE SPEC ~1 in 20 and shinies where the set has them)'],
      ['1', 'Rare slot: Double Rare ~1 in 6, Ultra Rare ~1 in 15, otherwise Rare'],
    ],
    swsh: [
      ['5', 'Commons'],
      ['3', 'Uncommons'],
      ['1', 'Reverse holo'],
      ['1', 'Rare slot: V / VMAX / VSTAR ~1 in 7, Secret Rare ~1 in 40, Radiant or Amazing Rare ~1 in 20, Holo Rare ~1 in 3, otherwise Rare'],
    ],
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lsGet = (k) => {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  };
  const lsSet = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
  };

  // TCGdex sometimes answers "no available server"; retry a few times.
  async function get(url) {
    let last;
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        const text = await r.text();
        if (r.ok) return JSON.parse(text);
        last = new Error(`TCGdex ${r.status}`);
        if (r.status === 404) throw last;
      } catch (e) {
        last = e;
        if (/404/.test(String(e && e.message))) throw e;
      }
      await sleep(400 * (i + 1));
    }
    throw last;
  }

  /** Sets that sell booster packs, newest first. */
  async function loadSets() {
    const cached = lsGet(SETS_KEY);
    if (cached && Date.now() - cached.at < 86400000) return cached.sets;
    const out = [];
    for (const s of SERIES) {
      const series = await get(`${API}/series/${s.id}`);
      const sets = (series.sets || [])
        .filter((x) => !SKIP.test(x.name) && ((x.cardCount && x.cardCount.official) || 0) >= 60)
        .reverse();
      for (const x of sets)
        out.push({
          game: 'pokemon', code: x.id, name: x.name, series: s.name, era: s.era,
          // TCGdex has set logos (set symbols mostly 404), so the logo doubles as the icon.
          icon: x.logo ? x.logo + '.png' : '', logo: x.logo ? x.logo + '.png' : '',
        });
    }
    lsSet(SETS_KEY, { at: Date.now(), sets: out });
    return out;
  }

  function slim(brief, rarityName, set) {
    const tier = RARITY[rarityName];
    return {
      id: brief.id,
      game: 'pokemon',
      name: brief.name,
      set: set.code,
      setName: set.name,
      num: brief.localId,
      rarity: APP_RARITY[tier] || 'mythic',
      rarityLabel: rarityName,
      tier,
      type: '',
      img: brief.image ? brief.image + '/high.webp' : '',
      usd: 0,
      usdFoil: 0,
      basic: false,
      ci: '', // not a Magic card: keeps Magic-only features from trying to look it up
      uri: '',
    };
  }

  /** All cards in a set, grouped by rarity tier. */
  async function loadPool(set, onProgress) {
    const cached = lsGet(POOL_PREFIX + set.code);
    if (cached && Date.now() - cached.at < 7 * 86400000) return cached.pool;
    const names = Object.keys(RARITY);
    const found = {}; // card id -> { brief, rarityName }
    let done = 0;
    const queue = names.slice();
    const worker = async () => {
      while (queue.length) {
        const r = queue.shift();
        const url = `${API}/cards?set.id=${encodeURIComponent(set.code)}&rarity=${encodeURIComponent('eq:' + r)}`;
        let list = [];
        try {
          list = await get(url);
        } catch {}
        for (const c of list || []) {
          // A search can also match similar names; keep the most specific rarity.
          const prev = found[c.id];
          if (!prev || r.length > prev.rarityName.length) found[c.id] = { brief: c, rarityName: r };
        }
        onProgress && onProgress(++done, names.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const pool = {};
    for (const { brief, rarityName } of Object.values(found)) {
      const card = slim(brief, rarityName, set);
      (pool[card.tier] = pool[card.tier] || []).push(card);
    }
    if (!(pool.common || []).length || !((pool.rare || []).length + (pool.holo || []).length + (pool.double || []).length)) return null;
    // Keep the 4 most recent Pokémon pools to save space.
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(POOL_PREFIX));
      keys
        .map((k) => [k, (lsGet(k) || {}).at || 0])
        .sort((a, b) => a[1] - b[1])
        .slice(0, Math.max(0, keys.length - 3))
        .forEach(([k]) => localStorage.removeItem(k));
    } catch {}
    lsSet(POOL_PREFIX + set.code, { at: Date.now(), pool });
    return pool;
  }

  /** Open one pack. Returns [{ card, foil, slot }] with the best card last. */
  function openPack(pool, era, rand) {
    rand = rand || Math.random;
    const has = (t) => (pool[t] || []).length > 0;
    const used = new Set();
    const pickFrom = (tiers, avoidDupes) => {
      const list = tiers.flatMap((t) => pool[t] || []);
      const fresh = avoidDupes ? list.filter((c) => !used.has(c.id)) : list;
      const src = fresh.length ? fresh : list;
      if (!src.length) return null;
      const c = src[Math.floor(rand() * src.length)];
      used.add(c.id);
      return c;
    };
    const out = [];
    const push = (card, foil, slot) => card && out.push({ card, foil: !!foil, slot });
    const roll = (table) => {
      // table: [[tier, chance]] -> first tier whose roll hits and that the set has
      let x = rand();
      for (const [t, p] of table) {
        if (!has(t)) continue;
        if ((x -= p) < 0) return t;
      }
      return null;
    };

    const commons = era === 'swsh' ? 5 : 4;
    for (let i = 0; i < commons; i++) push(pickFrom(['common'], true), false, 'common');
    for (let i = 0; i < 3; i++) push(pickFrom(['uncommon'], true), false, 'uncommon');
    push(pickFrom(['common', 'uncommon', 'rare', 'holo'], false), true, 'reverse');

    if (era === 'swsh') {
      const t = roll([['ultra', 1 / 7], ['secret', 1 / 40], ['radiant', 1 / 20], ['holo', 1 / 3]]) || (has('rare') ? 'rare' : 'holo');
      push(pickFrom([t], true), t !== 'rare', 'rare');
    } else {
      const hit = roll([['illus', 1 / 13], ['sir', 1 / 58], ['hyper', 1 / 140], ['ace', 1 / 20], ['shiny', 1 / 8], ['radiant', 1 / 20]]);
      if (hit) push(pickFrom([hit], true), true, 'hit');
      else push(pickFrom(['common', 'uncommon', 'rare'], false), true, 'reverse');
      const t = roll([['double', 1 / 6], ['ultra', 1 / 15]]) || (has('rare') ? 'rare' : 'double');
      push(pickFrom([t], true), t !== 'rare', 'rare');
    }
    // Reveal the hit slot last if it beat the rare slot.
    const order = { common: 0, uncommon: 1, reverse: 2, rare: 3, hit: 4 };
    return out.sort((a, b) => order[a.slot] - order[b.slot]);
  }

  /** Fill in prices and card type for pulled cards (TCGplayer market prices via TCGdex). */
  async function fillDetails(cards, timeoutMs) {
    const todo = cards.filter((c) => !c.detailed);
    const work = Promise.all(
      todo.map(async (c, i) => {
        await sleep(i * 60);
        try {
          const d = await get(`${API}/cards/${encodeURIComponent(c.id)}`);
          const tp = (d.pricing && d.pricing.tcgplayer) || {};
          const m = (k) => (tp[k] && (tp[k].marketPrice || tp[k].midPrice)) || 0;
          c.usd = m('normal') || m('holofoil') || m('unlimited-holofoil') || 0;
          c.usdFoil = m('reverse-holofoil') || m('holofoil') || c.usd;
          c.type = [d.category, d.stage, (d.types || []).join('/')].filter(Boolean).join(' · ');
          const pid = (tp.normal || tp.holofoil || tp['reverse-holofoil'] || {}).productId;
          if (pid) c.uri = `https://www.tcgplayer.com/product/${pid}`;
          c.detailed = true;
        } catch {}
      })
    );
    await Promise.race([work, sleep(timeoutMs || 8000)]);
  }

  // Register the pack type so shared screens (odds, wrapper, summary) can name it.
  if (root.PackOdds) root.PackOdds.ODDS.pokemon = { name: 'Booster Pack', cards: 10, slots: SLOTS.sv };

  const api = { loadSets, loadPool, openPack, fillDetails, SLOTS, RARITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pokemon = api;
})(typeof self !== 'undefined' ? self : this);
