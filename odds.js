/*
 * Pack collation + odds.
 *
 * Numbers are based on Wizards of the Coast's published booster collation
 * articles. They are approximations: exact rates vary a little from set to set.
 *
 *  - Play Booster (sets from Murders at Karlov Manor, Feb 2024, onward): 14 cards
 *  - Draft Booster (earlier sets): 15 cards
 */
(function (root) {
  'use strict';

  const PLAY_BOOSTER_START = '2024-02-09'; // Murders at Karlov Manor

  const ODDS = {
    play: {
      name: 'Play Booster',
      cards: 14,
      mythicInRareSlot: 1 / 7.4, // about 13.5%
      landFoil: 0.2,
      // Non-foil "wildcard" slot, any rarity
      wildcard: { common: 0.417, uncommon: 0.334, rare: 0.214, mythic: 0.035 },
      // Traditional foil slot, any rarity
      foilWildcard: { common: 0.583, uncommon: 0.333, rare: 0.067, mythic: 0.017 },
      slots: [
        ['6 + 1', 'Commons'],
        ['3', 'Uncommons'],
        ['1', 'Rare (86.5%) or Mythic (13.5%)'],
        ['1', 'Basic land (20% foil)'],
        ['1', 'Wildcard: C 41.7% / U 33.4% / R 21.4% / M 3.5%'],
        ['1', 'Foil: C 58.3% / U 33.3% / R 6.7% / M 1.7%'],
      ],
    },
    draft: {
      name: 'Draft Booster',
      cards: 15,
      mythicInRareSlot: 1 / 8, // 12.5%
      foilChance: 1 / 3, // a foil replaces a common in ~1 of 3 packs
      foil: { common: 0.667, uncommon: 0.2, rare: 0.111, mythic: 0.022 },
      slots: [
        ['10', 'Commons (one is a foil of any rarity in ~1 of 3 packs)'],
        ['3', 'Uncommons'],
        ['1', 'Rare (87.5%) or Mythic (12.5%)'],
        ['1', 'Basic land'],
      ],
    },
  };

  // Collector Boosters: Throne of Eldraine (Oct 2019) onward. 15 cards, mostly foil,
  // about 5 rares/mythics, with extended-art, borderless and showcase versions.
  // Exact contents differ by set; this follows the typical layout.
  const COLLECTOR_START = '2019-10-04';
  ODDS.collector = {
    name: 'Collector Booster',
    cards: 15,
    mythicInRareSlot: 1 / 7.4,
    mythicInSpecialSlot: 0.25,
    slots: [
      ['4', 'Foil commons'],
      ['3', 'Foil uncommons'],
      ['2', 'Foil showcase / special-frame commons or uncommons'],
      ['1', 'Foil basic land'],
      ['1', 'Foil rare (86.5%) or mythic (13.5%)'],
      ['3', 'Extended-art, borderless or showcase rares/mythics (mythic 25%)'],
      ['1', 'FOIL extended-art, borderless or showcase rare/mythic (mythic 25%)'],
    ],
  };

  function boosterTypeFor(releasedAt) {
    return releasedAt >= PLAY_BOOSTER_START ? 'play' : 'draft';
  }

  function hasCollector(releasedAt) {
    return releasedAt >= COLLECTOR_START;
  }

  function weighted(table, rand, available) {
    // Drop rarities this set doesn't have, then renormalise.
    const entries = Object.entries(table).filter(([r]) => available(r));
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let x = rand() * total;
    for (const [r, w] of entries) {
      if ((x -= w) < 0) return r;
    }
    return entries[entries.length - 1][0];
  }

  function pickDistinct(list, n, rand, used) {
    const out = [];
    const pool = list.filter((c) => !used.has(c.id));
    const src = pool.length >= n ? pool : list.slice();
    for (let i = 0; i < n && src.length; i++) {
      const idx = Math.floor(rand() * src.length);
      const c = src.splice(idx, 1)[0];
      used.add(c.id);
      out.push(c);
    }
    return out;
  }

  function pickOne(list, rand) {
    return list[Math.floor(rand() * list.length)];
  }

  /**
   * pool: { common:[], uncommon:[], rare:[], mythic:[], basic:[] }
   * returns [{ card, foil, slot }] ordered for reveal (best card last).
   */
  function openPack(pool, type, rand) {
    rand = rand || Math.random;
    const o = ODDS[type];
    const has = (r) => pool[r] && pool[r].length > 0;
    const used = new Set();
    const out = [];
    const push = (card, foil, slot) => card && out.push({ card, foil: !!foil, slot });

    const rareSlotRarity = () =>
      has('mythic') && (!has('rare') || rand() < o.mythicInRareSlot) ? 'mythic' : 'rare';

    if (type === 'collector') {
      // pool.altCU / altR / altM: alternate-art versions (may be empty for some sets)
      const cu = pool.altCU && pool.altCU.length ? pool.altCU : pool.common.concat(pool.uncommon);
      const altRM = () => {
        const wantM = rand() < o.mythicInSpecialSlot;
        if (wantM && pool.altM && pool.altM.length) return pickDistinct(pool.altM, 1, rand, used)[0];
        if (pool.altR && pool.altR.length) return pickDistinct(pool.altR, 1, rand, used)[0];
        if (pool.altM && pool.altM.length) return pickDistinct(pool.altM, 1, rand, used)[0];
        return pickDistinct(pool[rareSlotRarity()], 1, rand, used)[0];
      };
      pickDistinct(pool.common, 4, rand, used).forEach((c) => push(c, true, 'common'));
      pickDistinct(pool.uncommon, 3, rand, used).forEach((c) => push(c, true, 'uncommon'));
      pickDistinct(cu, 2, rand, used).forEach((c) => push(c, true, 'special'));
      push(has('basic') ? pickOne(pool.basic, rand) : pickDistinct(pool.common, 1, rand, used)[0], true, 'land');
      push(pickDistinct(pool[rareSlotRarity()], 1, rand, used)[0], true, 'rare');
      for (let i = 0; i < 3; i++) push(altRM(), false, 'special-rare');
      push(altRM(), true, 'special-rare');
      return out;
    }

    if (type === 'play') {
      pickDistinct(pool.common, 7, rand, used).forEach((c) => push(c, false, 'common'));
      pickDistinct(pool.uncommon, 3, rand, used).forEach((c) => push(c, false, 'uncommon'));
      const land = has('basic') ? pickOne(pool.basic, rand) : pickDistinct(pool.common, 1, rand, used)[0];
      push(land, rand() < o.landFoil, 'land');
      const wr = weighted(o.wildcard, rand, has);
      push(pickDistinct(pool[wr], 1, rand, used)[0], false, 'wildcard');
      const fr = weighted(o.foilWildcard, rand, has);
      push(pickOne(pool[fr], rand), true, 'foil');
      push(pickDistinct(pool[rareSlotRarity()], 1, rand, used)[0], false, 'rare');
    } else {
      const foil = rand() < o.foilChance;
      pickDistinct(pool.common, foil ? 9 : 10, rand, used).forEach((c) => push(c, false, 'common'));
      pickDistinct(pool.uncommon, 3, rand, used).forEach((c) => push(c, false, 'uncommon'));
      if (has('basic')) push(pickOne(pool.basic, rand), false, 'land');
      if (foil) {
        const fr = weighted(o.foil, rand, has);
        push(pickOne(pool[fr], rand), true, 'foil');
      }
      push(pickDistinct(pool[rareSlotRarity()], 1, rand, used)[0], false, 'rare');
    }
    return out;
  }

  const api = { ODDS, PLAY_BOOSTER_START, COLLECTOR_START, boosterTypeFor, hasCollector, openPack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PackOdds = api;
})(typeof self !== 'undefined' ? self : this);
