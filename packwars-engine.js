/*
 * Pack Wars table engine. No rules are enforced: like a real table, players move
 * their own cards and keep their own life total. This file only tracks where every
 * card is, and builds the public view the opponent is allowed to see.
 *
 * state = {
 *   life, mulligans,
 *   cards: { id: { c: card, foil, tapped, counters } },
 *   zones: { library: [id], hand: [id], battlefield: [id], graveyard: [id], exile: [id] }
 * }
 */
(function (root) {
  'use strict';

  const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile'];
  const START_LIFE = 20;
  const HAND = 7;
  const DECK_TARGET = 30;
  const BASIC_COLORS = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

  const mini = (c) => ({
    name: c.name, img: c.img || '', type: c.front || c.type || '', mana: c.mana || '', rarity: c.rarity || 'common', cmc: c.cmc || 0,
  });

  function shuffleArr(a, rand) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Suggested basic lands for a pack: split by the colors of the pack's spells. */
  function suggestBasics(packCards, total) {
    total = total == null ? Math.max(0, DECK_TARGET - packCards.length) : total;
    const weight = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const c of packCards) {
      if (/Land/.test(c.front || c.type || '')) continue;
      const syms = (c.mana || '').match(/\{[^}]+\}/g) || [];
      syms.forEach((s) => 'WUBRG'.split('').forEach((x) => s.includes(x) && (weight[x] += 1)));
    }
    const sum = Object.values(weight).reduce((a, b) => a + b, 0);
    const names = Object.keys(BASIC_COLORS);
    const out = {};
    if (!sum) {
      // No colored spells: spread evenly.
      names.forEach((n, i) => (out[n] = Math.floor(total / 5) + (i < total % 5 ? 1 : 0)));
      return out;
    }
    let given = 0;
    const exact = names.map((n) => [n, (weight[BASIC_COLORS[n]] / sum) * total]);
    exact.forEach(([n, x]) => {
      out[n] = Math.floor(x);
      given += out[n];
    });
    exact
      .sort((a, b) => (b[1] % 1) - (a[1] % 1))
      .slice(0, total - given)
      .forEach(([n]) => (out[n] += 1));
    names.forEach((n) => !out[n] && delete out[n]);
    return out;
  }

  /**
   * packCards: [{ card, foil }]; basics: { Plains: n, ... }; basicArt: name -> img
   */
  function newPlayer(packCards, basics, basicArt, rand) {
    rand = rand || Math.random;
    const s = { life: START_LIFE, mulligans: 0, cards: {}, zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [] } };
    let n = 0;
    const add = (c, foil) => {
      const id = 'c' + ++n;
      s.cards[id] = { c: mini(c), foil: !!foil, tapped: false, counters: 0 };
      s.zones.library.push(id);
    };
    packCards.forEach((p) => add(p.card, p.foil));
    Object.entries(basics || {}).forEach(([name, count]) => {
      for (let i = 0; i < count; i++)
        add({ name, img: (basicArt && basicArt[name]) || '', type: 'Basic Land — ' + name, rarity: 'common' }, false);
    });
    shuffleArr(s.zones.library, rand);
    draw(s, HAND);
    return s;
  }

  function zoneOf(s, id) {
    return ZONES.find((z) => s.zones[z].includes(id)) || null;
  }

  function draw(s, n) {
    let drawn = 0;
    for (let i = 0; i < (n || 1) && s.zones.library.length; i++) {
      s.zones.hand.push(s.zones.library.shift());
      drawn++;
    }
    return drawn;
  }

  function shuffle(s, rand) {
    shuffleArr(s.zones.library, rand || Math.random);
  }

  /** Move a card. where: 'top' | 'bottom' for the library (default top). */
  function move(s, id, to, where) {
    const from = zoneOf(s, id);
    if (!from || !s.zones[to]) return false;
    s.zones[from] = s.zones[from].filter((x) => x !== id);
    const card = s.cards[id];
    if (to !== 'battlefield') {
      card.tapped = false;
      card.counters = 0;
    }
    if (to === 'library' && where !== 'bottom') s.zones.library.unshift(id);
    else s.zones[to].push(id);
    return true;
  }

  function toggleTap(s, id) {
    if (zoneOf(s, id) !== 'battlefield') return false;
    s.cards[id].tapped = !s.cards[id].tapped;
    return s.cards[id].tapped;
  }

  function untapAll(s) {
    s.zones.battlefield.forEach((id) => (s.cards[id].tapped = false));
  }

  function addCounter(s, id, d) {
    const c = s.cards[id];
    c.counters = (c.counters || 0) + d;
    return c.counters;
  }

  function changeLife(s, d) {
    s.life += d;
    return s.life;
  }

  /** Mulligan: shuffle your hand away and draw one fewer card each time. */
  function mulligan(s, rand) {
    s.zones.library.push(...s.zones.hand);
    s.zones.hand = [];
    shuffle(s, rand);
    s.mulligans += 1;
    draw(s, Math.max(0, HAND - s.mulligans));
  }

  function mill(s, n) {
    for (let i = 0; i < n && s.zones.library.length; i++) s.zones.graveyard.push(s.zones.library.shift());
  }

  /** What the opponent may see. */
  function publicView(s) {
    const show = (id) => ({ id, ...s.cards[id] });
    return {
      life: s.life,
      hand: s.zones.hand.length,
      library: s.zones.library.length,
      mulligans: s.mulligans,
      battlefield: s.zones.battlefield.map(show),
      graveyard: s.zones.graveyard.map(show),
      exile: s.zones.exile.map(show),
    };
  }

  const isLand = (card) => /Land/.test((card && card.type) || '');

  const api = {
    ZONES, START_LIFE, HAND, DECK_TARGET,
    suggestBasics, newPlayer, zoneOf, draw, shuffle, move, toggleTap, untapAll, addCounter, changeLife, mulligan, mill, publicView, isLand,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PackWarsEngine = api;
})(typeof self !== 'undefined' ? self : this);
