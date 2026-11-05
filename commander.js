/*
 * Commander deck rules.
 *  - Exactly 100 cards, counting the commander(s).
 *  - Commander: a legendary creature, or a card that says it "can be your commander".
 *    Two commanders are allowed with Partner, Partner with, Friends forever,
 *    Choose a Background + Background, or Doctor's companion + a Time Lord Doctor.
 *  - Singleton: one copy of each card by name, except basic lands and cards that
 *    say a deck can have any number (or "up to seven", etc.) of them.
 *  - Every card must fit in the commanders' color identity.
 *  - No cards banned in Commander.
 *  - Pack Ripped rule: you can only use cards you own (basic lands are unlimited).
 */
(function (root) {
  'use strict';

  const DECK_SIZE = 100;
  const BASICS = [
    { name: 'Plains', color: 'W' },
    { name: 'Island', color: 'U' },
    { name: 'Swamp', color: 'B' },
    { name: 'Mountain', color: 'R' },
    { name: 'Forest', color: 'G' },
    { name: 'Wastes', color: '' },
  ];
  const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  /** Commander-related facts about a Scryfall card object. */
  function cardFlags(c) {
    const faces = c.card_faces || [];
    const front = faces[0] || c;
    const type = front.type_line || c.type_line || '';
    const oracle = c.oracle_text || faces.map((f) => f.oracle_text || '').join('\n');
    const kw = (c.keywords || []).map((k) => k.toLowerCase());
    let pair = '';
    let pairName = '';
    const pw = oracle.match(/Partner with ([^\n(]+?)\s*(?:\(|\n|$)/);
    if (pw) {
      pair = 'partnerWith';
      pairName = pw[1].trim();
    } else if (kw.includes('partner')) pair = 'partner';
    else if (kw.includes('friends forever')) pair = 'friends';
    else if (kw.includes('choose a background')) pair = 'chooseBg';
    else if (kw.includes("doctor's companion")) pair = 'companion';
    if (/\bBackground\b/.test(type) && /Legendary/.test(type)) pair = 'background';

    let copies = 1;
    if (/any number of cards named/i.test(oracle)) copies = 999;
    const up = oracle.match(/up to (\w+) cards named/i);
    if (up) copies = WORDS[up[1].toLowerCase()] || parseInt(up[1], 10) || 1;

    return {
      ci: (c.color_identity || []).join(''),
      cmc: c.cmc || 0,
      mana: c.mana_cost || front.mana_cost || '',
      legal: (c.legalities || {}).commander || '',
      cmdr: (/Legendary/.test(type) && /Creature/.test(type)) || /can be your commander/i.test(oracle),
      pair,
      pairName,
      doctor: /Time Lord Doctor/.test(type),
      copies,
      front: type,
    };
  }

  function canPair(a, b) {
    if (!a || !b || a.name === b.name) return false;
    if (a.pair === 'partner' && b.pair === 'partner') return a.cmdr && b.cmdr;
    if (a.pair === 'partnerWith' && b.pair === 'partnerWith') return a.pairName === b.name && b.pairName === a.name;
    if (a.pair === 'friends' && b.pair === 'friends') return true;
    if (a.pair === 'chooseBg' && b.pair === 'background') return a.cmdr;
    if (b.pair === 'chooseBg' && a.pair === 'background') return b.cmdr;
    if (a.pair === 'companion' && b.doctor) return true;
    if (b.pair === 'companion' && a.doctor) return true;
    return false;
  }

  /** Can this card be the first (or only) commander? Backgrounds only count as a second. */
  const isCommander = (c) => !!c && c.cmdr && c.pair !== 'background';
  /** Can this commander have a second one? */
  const wantsPartner = (c) => !!c && ['partner', 'partnerWith', 'friends', 'chooseBg', 'companion'].includes(c.pair);

  function identityOf(commanders) {
    const s = new Set();
    commanders.forEach((c) => (c.ci || '').split('').forEach((x) => s.add(x)));
    return 'WUBRG'.split('').filter((x) => s.has(x)).join('');
  }

  const fitsIdentity = (ci, identity) => (ci || '').split('').every((x) => identity.includes(x));

  function typeGroup(type) {
    const t = type || '';
    if (/Creature/.test(t)) return 'Creatures';
    if (/Planeswalker/.test(t)) return 'Planeswalkers';
    if (/Battle/.test(t)) return 'Battles';
    if (/Land/.test(t)) return 'Lands';
    if (/Instant/.test(t)) return 'Instants';
    if (/Sorcery/.test(t)) return 'Sorceries';
    if (/Artifact/.test(t)) return 'Artifacts';
    if (/Enchantment/.test(t)) return 'Enchantments';
    return 'Other';
  }

  /**
   * deck: { commanders:[id], cards:{id:qty}, basics:{Name:qty} }
   * getCard(id) -> slim card with flags (or null)
   * ownedByName(name) -> number of copies the player owns
   * Returns { count, identity, ok, problems:[string], warnings:[string] }
   */
  function validate(deck, getCard, ownedByName) {
    const problems = [];
    const warnings = [];
    const cmdrs = deck.commanders.map(getCard).filter(Boolean);
    const identity = identityOf(cmdrs);

    if (!cmdrs.length) problems.push('Choose a commander.');
    else if (!isCommander(cmdrs[0])) problems.push(`${cmdrs[0].name} can't be a commander.`);
    if (cmdrs.length === 2 && !canPair(cmdrs[0], cmdrs[1])) problems.push(`${cmdrs[0].name} and ${cmdrs[1].name} can't be commanders together.`);
    if (cmdrs.length > 2) problems.push('A deck can have at most two commanders.');

    const byName = {};
    const add = (c, n) => (byName[c.name] = (byName[c.name] || { card: c, n: 0 })).n += n;
    cmdrs.forEach((c) => add(c, 1));
    let count = cmdrs.length;
    for (const [id, n] of Object.entries(deck.cards)) {
      const c = getCard(id);
      if (!c) {
        problems.push('A card in this deck is missing from your collection.');
        continue;
      }
      add(c, n);
      count += n;
    }
    for (const b of BASICS) {
      const n = (deck.basics && deck.basics[b.name]) || 0;
      if (!n) continue;
      count += n;
      if (!fitsIdentity(b.color, identity)) problems.push(`${b.name} isn't in your commander's colors.`);
    }

    for (const { card: c, n } of Object.values(byName)) {
      if (c.legal === 'banned') problems.push(`${c.name} is banned in Commander.`);
      else if (c.legal && c.legal !== 'legal') problems.push(`${c.name} isn't legal in Commander.`);
      if (!fitsIdentity(c.ci, identity)) problems.push(`${c.name} is outside your commander's colors.`);
      const max = c.basic ? Infinity : c.copies || 1;
      if (n > max) problems.push(max === 1 ? `Only one ${c.name} is allowed.` : `At most ${max} copies of ${c.name}.`);
      if (!c.basic && n > ownedByName(c.name)) problems.push(`You only own ${ownedByName(c.name)} ${c.name}.`);
    }

    if (count < DECK_SIZE) warnings.push(`Add ${DECK_SIZE - count} more card${DECK_SIZE - count === 1 ? '' : 's'}.`);
    if (count > DECK_SIZE) problems.push(`Remove ${count - DECK_SIZE} card${count - DECK_SIZE === 1 ? '' : 's'} (max ${DECK_SIZE}).`);

    return { count, identity, ok: !problems.length && count === DECK_SIZE, problems: [...new Set(problems)], warnings };
  }

  const api = { DECK_SIZE, BASICS, cardFlags, canPair, isCommander, wantsPartner, identityOf, fitsIdentity, typeGroup, validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Commander = api;
})(typeof self !== 'undefined' ? self : this);
