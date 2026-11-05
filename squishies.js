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

  /*
   * Real products with real photos (Nov 2026). Names and photos come from toy stores'
   * own product listings (Toot Toot Toys, Amazeum Store, Flying Pig Toys, Pacifier
   * Kids), shown straight from the stores' image server. Rarities are this app's,
   * based on demand (purchase limits, sold-out items), not official odds.
   */
  const CATALOG = [
    {
      name: 'RMS Mystery Dumpling', match: ['rms'], style: 'spinner',
      named: [
        ['Sherbet Dumpling', 'common'], ['Neon Dumpling', 'common'], ['Shark Dumpling', 'common'], ['Seashell Dumpling', 'common'],
        ['Sunset Dumpling', 'common'], ['Party Confetti Dumpling', 'common'], ['Stuffed Bun Dumpling', 'common'],
        ['Water-Filled Dumpling', 'common'], ['Color Changing Dumpling', 'rare'], ['Galaxy Dumpling', 'rare'],
        ['Starlight Dumpling', 'rare'], ['Spooky Ghost Dumpling', 'rare'], ['Green Holographic Dumpling', 'rare'],
        ['Purple Holographic Dumpling', 'rare'], ['Ultra-Rare Glitter Dumpling', 'super'], ['Golden Ticket Dumpling', 'super'],
      ].map(([n, r]) => [n, r, 'dumpling']),
      items: [
        ["Mystery Squishy Dumpling: Pink Glitter Edition", 'common', 'dumpling', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-08-19T130702.142.jpg?v=1787116080&width=500"],
        ["Rainbow Mystery Bao Bun", 'rare', 'dumpling', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-05-05T014651.864.jpg?v=1777924062&width=500"],
      ],
    },
    {
      name: 'NeeDoh', match: ['nee-doh', 'needoh', 'nee doh'], style: 'bag',
      // (Nice Ice Baby and Teenie Cool Cats are the same products as the Teenie photo items, so they're not repeated.)
      named: [
        ['The Groovy Glob', 'common', 'ball'], ['Gumdrop', 'common', 'drop'], ['Snowball Crunch', 'common', 'ball'],
        ['Teenie NeeDoh', 'common', 'ball'], ['Dohnut', 'common', 'donut'], ['Groovy Fruit', 'common', 'drop'],
        ['Nice Cube Swirl', 'rare', 'cube'], ['Nice Cube Glitter & Glow', 'rare', 'cube'], ['Jellyfish', 'rare', 'drop'],
        ['Fuzzball', 'rare', 'ball'], ['Dream Drop', 'rare', 'drop'], ['Nice Sicle', 'rare', 'drop'],
        ['Nice Berg', 'super', 'cube'], ['Atomic NeeDoh', 'super', 'ball'],
      ],
      items: [
        ["Teenie Fuzz Ball (multi-pack)", 'common', 'ball', "https://cdn.shopify.com/s/files/1/0570/3537/files/needoh_teenie_fuzz_ball_multipack_1_777ea53d-2134-41e1-aeb5-8ac2ba4c6cae.webp?v=1769058110&width=500"],
        ["Teenie Nice Ice Baby (multi-pack)", 'common', 'ball', "https://cdn.shopify.com/s/files/1/0570/3537/files/needoh_teenie_nice_ice_baby_multipack_1.webp?v=1770161825&width=500"],
        ["Teenie Cool Kittens (multi-pack)", 'common', 'ball', "https://cdn.shopify.com/s/files/1/0286/1203/4642/files/coolkittens.jpg?v=1770934739&width=500"],
        ["Teenie Hot Shots", 'common', 'ball', "https://cdn.shopify.com/s/files/1/0286/1203/4642/files/HOTSHOTTEENIENEEDOH.jpg?v=1773788702&width=500"],
        ["Jelly Hops", 'common', 'ball', "https://cdn.shopify.com/s/files/1/0286/1203/4642/files/jellyhops.jpg?v=1770934914&width=500"],
        ["Candy Swirl Nice Cube", 'rare', 'ball', "https://cdn.shopify.com/s/files/1/0286/1203/4642/files/candy1.jpg?v=1770934575&width=500"],
        ["Squishmas Polar Glow Penguins", 'rare', 'ball', "https://cdn.shopify.com/s/files/1/0286/1203/4642/files/penguin_f0eed820-7c69-49e4-b9e3-b4d71267752f.jpg?v=1770934516&width=500"],
        ["Mello Mallo", 'rare', 'ball', "https://cdn.shopify.com/s/files/1/0628/9886/4365/files/IMG-2239.webp?v=1741806162&width=500"],
        ["Disney Stitch Micro Teenies", 'rare', 'ball', "https://cdn.shopify.com/s/files/1/0628/9886/4365/files/IMG_1180_57d26dcc-7252-4691-a0d8-236aa2a18dc0.webp?v=1740244620&width=500"],
        ["Hello Kitty and Friends Micro Teenies", 'rare', 'ball', "https://cdn.shopify.com/s/files/1/0628/9886/4365/files/IMG_0924.jpg?v=1738519009&width=500"],
        ["Nice Cube", 'super', 'ball', "https://cdn.shopify.com/s/files/1/0570/3537/files/NCBND-NeeDoh-Nice-Cube-3QR-Group.jpg?v=1689949384&width=500"],
        ["Galactic Glow Dream Drop", 'super', 'ball', "https://cdn.shopify.com/s/files/1/0628/9886/4365/files/czki95otooue3r6eiceq.jpg?v=1775522245&width=500"],
      ],
    },
    {
      name: 'Squeezies', match: ['squeez'], style: 'bag',
      // Toymendous Laffy Quacks / Laffy Snacks and ORB Easy Sqweezy (photos from ToyWiz).
      items: [
        ["Easy Sqweezy Mega Banana", 'common', 'blob', "https://cdn11.bigcommerce.com/s-0kvv9/products/556917/images/843523/622222424107__41890.1765733247.500.750.jpg?c=2"],
        ["Easy Sqweezy Jumbo Banana", 'super', 'blob', "https://cdn11.bigcommerce.com/s-0kvv9/products/572400/images/868390/622222424060__50028.1770399565.500.750.jpg?c=2"],
        ["Easy Sqweezy Pickle", 'common', 'blob', "https://cdn11.bigcommerce.com/s-0kvv9/products/556896/images/843477/622222424077__89881.1757971857.500.750.jpg?c=2"],
        ["Easy Sqweezy Puppy", 'common', 'blob', "https://cdn11.bigcommerce.com/s-0kvv9/products/564793/images/855925/622222177775__70769.1774893934.500.750.jpg?c=2"],
        ["Easy Sqweezy Super Cheesy", 'rare', 'blob', "https://cdn11.bigcommerce.com/s-0kvv9/products/483090/images/748925/622222421182__38194.1717447653.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Blue)", 'common', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/579390/images/877612/840359705092blue__48255.1774278225.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Green)", 'common', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/579388/images/877608/840359705092gre__65047.1774278225.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Pink)", 'common', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/579831/images/878044/840359705092pnk__77863.1774366371.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Red)", 'common', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/590669/images/893855/840359712250__39513.1780498519.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Tie-Dye Blue)", 'rare', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/587505/images/888929/840359713714__22180.1778602249.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Tie-Dye Green)", 'rare', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/587502/images/888922/840359713721__43302.1778608350.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Tie-Dye Pink)", 'rare', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/587503/images/888925/840359713707__05867.1778608350.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Tie-Dye Yellow)", 'rare', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/587504/images/888927/840359713738__97483.1778608350.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (White)", 'common', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/590640/images/893777/840359712274__22586.1780442407.500.750.jpg?c=2"],
        ["Laffy Quacks Jumbo Duck (Yellow)", 'common', 'drop', "https://cdn11.bigcommerce.com/s-0kvv9/products/579389/images/877611/840359705092yel__30811.1774271713.500.750.jpg?c=2"],
        ["Laffy Snacks Hot Dog", 'common', 'blob', "https://cdn11.bigcommerce.com/s-0kvv9/products/587348/images/888648/840359712359__46065.1778514020.500.750.jpg?c=2"],
        ["Laffy Snacks Jumbo Butter", 'super', 'cube', "https://cdn11.bigcommerce.com/s-0kvv9/products/576581/images/873550/840359707874__47651.1772477513.500.750.jpg?c=2"],
        ["Laffy Snacks Jumbo Banana", 'rare', 'blob', "https://cdn11.bigcommerce.com/s-0kvv9/products/576582/images/873553/840359704019__29008.1772477513.500.750.jpg?c=2"],
      ],
    },
    {
      name: 'Jellycat', match: ['jellycat'], style: 'bag',
      // Photos from Pacifier Kids. Bartholomew Bear and the Bashful Bunny are Jellycat's best-known classics.
      items: [
        ["Amuseables Molasi Cookie", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-10-01T091826.045.jpg?v=1791323386&width=500"],
        ["Amuseables Pinecone Tree", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-10-01T092831.024.jpg?v=1791323340&width=500"],
        ["Amuseables Garlic", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-08-12T201732.312.jpg?v=1786537067&width=500"],
        ["Amuseables Pomilly", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T200014.682.jpg?v=1788523234&width=500"],
        ["Amuseables Fitswell Mitten", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T195011.683.jpg?v=1788522700&width=500"],
        ["Amuseables Perta Snow Boot", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T200935.745.jpg?v=1788523817&width=500"],
        ["Amuseables Mullover Spiced Drink", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T195641.907.jpg?v=1788523021&width=500"],
        ["Amuseables Scarffles Hot Chocolate", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-10-01T094224.032.jpg?v=1790818976&width=500"],
        ["Amuseables Vampop Drink", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-08-12T202715.480.jpg?v=1786537650&width=500"],
        ["Amuseables Flickerty Candle", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-08-12T201318.370.jpg?v=1786536819&width=500"],
        ["Ghost Bob", 'common', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-08-12T203049.334.jpg?v=1786537871&width=500"],
        ["Birchly Moose", 'rare', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-10-01T101742.042.jpg?v=1791322425&width=500"],
        ["Ulrich Wolf", 'rare', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T204146.791.jpg?v=1788525723&width=500"],
        ["Tawoola Owl", 'rare', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T203417.811.jpg?v=1788525274&width=500"],
        ["Growlston Gargoyle", 'rare', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-08-12T203422.424.jpg?v=1786538073&width=500"],
        ["Franilla Luxe Bunny", 'rare', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-10-01T102859.035.jpg?v=1791322397&width=500"],
        ["Amuseables Silver Star (2026)", 'rare', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T201554.713.jpg?v=1788524176&width=500"],
        ["Amuseables Collette Tarte Au Citron", 'rare', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_5_d30ee980-f1db-4695-a169-6ddabad6bb8c.jpg?v=1791870305&width=500"],
        ["Bizzlestomp Bear", 'super', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/product_photo_-_white_background_-_2026-09-04T202122.194.jpg?v=1788524634&width=500"],
        ["Ooky Jack O Lantern", 'super', 'blob', "https://cdn.shopify.com/s/files/1/0281/8056/files/OOK3JOL_4__23668.1752688236.jpg?v=1786636376&width=500"],
      ],
      named: [['Bartholomew Bear', 'super', 'ball'], ['Bashful Bunny', 'rare', 'ball']],
    },
  ];
  // Names from the first starter list (kept for reference; nothing is removed anymore).
  const OLD_CATALOG = ['Sherbet Dumpling', 'Neon Dumpling', 'Shark Dumpling', 'Seashell Dumpling', 'Sunset Dumpling',
    'Party Confetti Dumpling', 'Stuffed Bun Dumpling', 'Water-Filled Dumpling', 'Color Changing Dumpling', 'Galaxy Dumpling',
    'Starlight Dumpling', 'Spooky Ghost Dumpling', 'Green Holographic Dumpling', 'Purple Holographic Dumpling',
    'Ultra-Rare Glitter Dumpling', 'Golden Ticket Dumpling', 'The Groovy Glob', 'Gumdrop', 'Nice Cube', 'Snowball Crunch',
    'Teenie NeeDoh', 'Dohnut', 'Groovy Fruit', 'Nice Cube Swirl', 'Nice Cube Glitter & Glow', 'Jellyfish', 'Fuzzball',
    'Dream Drop', 'Teenie Cool Cats', 'Nice Ice Baby', 'Nice Sicle', 'Nice Berg', 'Atomic NeeDoh'].map((n) => n.toLowerCase());

  function data() {
    const s = PR.state;
    if (!s.squish) s.squish = { bagCost: 50, brands: [] };
    const CATALOG_VER = 4;
    if ((s.squish.catalogVer || 0) < CATALOG_VER) {
      for (const c of CATALOG) {
        let b = s.squish.brands.find((x) => c.match.some((m) => x.name.toLowerCase().replace(/[^a-z ]/g, '').startsWith(m.replace(/[^a-z ]/g, ''))));
        if (!b) s.squish.brands.push((b = { id: uid(), name: c.name, items: [] }));
        b.name = c.name;
        b.style = c.style;
        // Items with real store photos.
        for (const [name, rarity, shape, img] of c.items) {
          const have = b.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
          if (have) Object.assign(have, { img, rarity });
          else b.items.push({ id: uid(), name, rarity, shape, img });
        }
        // Real product names without a photo yet (shown with a simple drawing). Never removes anything.
        for (const [name, rarity, shape] of c.named || [])
          if (!b.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) b.items.push({ id: uid(), name, rarity, shape });
      }
      s.squish.catalogVer = CATALOG_VER;
      s.squish.catalogV3 = true;
      s.squish.catalogV2 = true;
      s.squish.catalogV1 = true;
      // RMS first, then NeeDoh, then anything you added.
      s.squish.brands.sort((a, b) => (CATALOG.findIndex((c) => c.name === a.name) + 1 || 99) - (CATALOG.findIndex((c) => c.name === b.name) + 1 || 99));
      s.squish.seeded = true;
    }
    return s.squish;
  }
  const uid = () => Math.random().toString(36).slice(2, 9);

  // A simple, original squishy tile (not brand art), colored from the item's name.
  const SHAPES = {
    blob: 'M44 200 C40 120 80 80 122 80 C164 80 204 120 200 200 C198 250 160 268 122 268 C84 268 46 250 44 200 Z',
    ball: 'M122 76 C178 76 206 122 206 172 C206 228 170 268 122 268 C74 268 38 228 38 172 C38 122 66 76 122 76 Z',
    cube: 'M58 96 Q50 96 50 104 L50 252 Q50 262 60 262 L184 262 Q194 262 194 252 L194 104 Q194 96 186 96 Z',
    drop: 'M122 70 C150 110 196 150 196 200 C196 244 162 268 122 268 C82 268 48 244 48 200 C48 150 94 110 122 70 Z',
    donut: 'M122 96 C176 96 210 132 210 182 C210 232 176 262 122 262 C68 262 34 232 34 182 C34 132 68 96 122 96 Z M122 160 C108 160 102 170 102 180 C102 192 110 200 122 200 C134 200 142 192 142 180 C142 170 136 160 122 160 Z',
    dumpling: 'M30 220 C30 150 70 104 122 104 C174 104 214 150 214 220 C214 246 186 262 122 262 C58 262 30 246 30 220 Z',
  };

  function tile(name, rarity, shape) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = /gold/i.test(name) ? 46 : h % 360;
    const body = `hsl(${hue},70%,72%)`;
    const shade = `hsl(${hue},60%,58%)`;
    const bg = rarity === 'super' ? '#2a1d55' : rarity === 'rare' ? '#1d2f55' : '#241f38';
    const sparkle = rarity === 'super' ? '<text x="40" y="70" font-size="30">✨</text><text x="180" y="120" font-size="22">✨</text>' : rarity === 'rare' ? '<text x="185" y="80" font-size="24">✨</text>' : '';
    const label = name.replace(/ Dumpling$/, '');
    const words = label.length > 18 ? label.slice(0, 17) + '…' : label;
    const path = SHAPES[shape] || SHAPES.blob;
    // Dumplings get pleats on top; cubes sit a bit lower in the face.
    const pleats = shape === 'dumpling' ? '<path d="M82 116 Q92 140 86 160 M122 104 Q126 132 122 156 M162 116 Q152 140 158 160" stroke="rgba(255,255,255,.55)" stroke-width="5" fill="none" stroke-linecap="round"/>' : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 244 340">
      <rect width="244" height="340" rx="16" fill="${bg}"/>
      <ellipse cx="122" cy="270" rx="78" ry="12" fill="rgba(0,0,0,.35)"/>
      <path d="${path}" fill="${body}" stroke="${shade}" stroke-width="6" fill-rule="evenodd"/>${pleats}
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
      img: item.img || tile(item.name, item.rarity, item.shape),
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

  /** Pick from every brand at once: roll the rarity, then any item of that rarity. */
  function pickAll(d) {
    const all = d.brands.flatMap((brand) => brand.items.map((item) => ({ brand, item })));
    if (!all.length) return null;
    let x = Math.random();
    let tier = 'common';
    for (const [t, p] of Object.entries(ODDS)) {
      if ((x -= p) < 0) {
        tier = t;
        break;
      }
    }
    const order = tier === 'super' ? ['super', 'rare', 'common'] : tier === 'rare' ? ['rare', 'common', 'super'] : ['common', 'rare', 'super'];
    for (const t of order) {
      const list = all.filter((x) => x.item.rarity === t);
      if (list.length) return list[Math.floor(Math.random() * list.length)];
    }
    return null;
  }

  function openBag() {
    const d = data();
    const got = pickAll(d);
    if (!got) return toast('Add some squishies first');
    if (PR.state.points < d.bagCost) return toast(`You need ${d.bagCost} ◆ to spin`);
    const { brand, item } = got;
    const card = cardFor(brand, item);
    // Pay & record first, so closing the app mid-reveal doesn't lose it.
    PR.state.points -= d.bagCost;
    const c = PR.state.collection;
    const isNew = !c[card.id];
    const e = c[card.id] || (c[card.id] = { n: 0, f: 0, firstAt: Date.now(), card });
    e.card = card;
    e.n += 1;
    e.lastAt = Date.now();
    PR.state.history.unshift({ at: Date.now(), set: card.set, setName: 'Squishy Wheel', type: 'squishy', game: 'squishy', value: 0, best: card.name, cards: [[card.id, 0]] });
    PR.state.history = PR.state.history.slice(0, 30);
    PR.save();
    PR.renderPoints(true);
    dialog(
      `${
        true
          ? `<div class="spinner-wrap" id="sqBag"><div class="spin-pointer">▼</div><div class="wheel" id="sqWheel"><span>Squish</span></div></div>
      <p class="hint" id="sqHint">Tap the wheel to spin</p>`
          : `<div class="bag" id="sqBag"><div class="bag-top"></div><div class="bag-body"><span>?</span><b>${esc(brand.name)}</b><small>Blind bag</small></div></div>
      <p class="hint" id="sqHint">Tap the bag to open it</p>`
      }
      <div id="sqReveal" class="hidden">
        <div class="mini squish-big ${card.rarity}"><img src="${esc(card.img)}" alt="${esc(card.name)}"></div>
        <h3>${esc(card.name)} ${isNew ? '<span class="new-tag">NEW</span>' : ''}</h3>
        <p class="muted small"><span class="rarity-dot ${card.rarity}"></span>${card.rarityLabel} · ${esc(brand.name)}</p>
        <div class="row"><button class="btn" id="sqDone">Done</button><button class="btn primary" id="sqAgain" ${PR.state.points >= d.bagCost ? '' : 'disabled'}>Another (${d.bagCost} ◆)</button></div>
      </div>`,
      (close) => {
        document.getElementById('sqBag').onclick = () => {
          const bag = document.getElementById('sqBag');
          return spin(bag); // every squishy now comes from the one wheel
          bag.classList.add('opening');
          if (window.PRSound) window.PRSound.shake();
          if (window.PRFx) window.PRFx.burstFrom(bag, { count: 120 });
          if (navigator.vibrate) navigator.vibrate(item.rarity === 'super' ? [40, 60, 80] : 25);
          setTimeout(() => {
            bag.remove();
            document.getElementById('sqHint').remove();
            document.getElementById('sqReveal').classList.remove('hidden');
            const hit = window.PRSound ? window.PRSound.forCard(card, 0) : '';
            if (window.PRFx && hit === 'huge') window.PRFx.goldShower();
          }, 550);
        };
        const reveal = () => {
          document.getElementById('sqHint').remove();
          document.getElementById('sqReveal').classList.remove('hidden');
          const hit = window.PRSound ? window.PRSound.forCard(card, 0) : '';
          if (window.PRFx && hit === 'huge') window.PRFx.goldShower();
        };
        // Spinner: spin the wheel a few turns, tick as it goes, then burst and reveal.
        const spin = (wrap) => {
          if (wrap.dataset.spun) return;
          wrap.dataset.spun = 1;
          const wheel = document.getElementById('sqWheel');
          const turns = 4 + Math.random() * 2;
          wheel.style.transform = `rotate(${turns * 360}deg)`;
          if (window.PRSound) {
            window.PRSound.wake();
            for (let k = 0; k < 9; k++) setTimeout(() => window.PRSound.drop(1), k * k * 22);
          }
          setTimeout(() => {
            if (window.PRSound) window.PRSound.shake();
            if (window.PRFx) window.PRFx.burstFrom(wrap, { count: 140 });
            if (navigator.vibrate) navigator.vibrate(item.rarity === 'super' ? [40, 60, 80] : 25);
            wrap.remove();
            reveal();
          }, 1900);
        };
        document.getElementById('sqDone').onclick = () => {
          close();
          render();
        };
        document.getElementById('sqAgain').onclick = () => {
          close();
          openBag();
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
        <h2>🎡 Squishy Wheel</h2>
        <p class="muted small">One spin, every brand: ${d.brands.reduce((n, b) => n + b.items.length, 0)} squishies from ${d.brands.map((b) => esc(b.name)).join(', ')}. Common 70%, rare 25%, super rare 5%.</p>
        <button class="btn primary wide" id="sqSpinAll" ${d.brands.some((b) => b.items.length) && PR.state.points >= d.bagCost ? '' : 'disabled'}>Spin the wheel (${d.bagCost} ◆)</button>
        <p class="muted small" style="margin-top:10px">Real products, with real store photos where available and a simple drawing for the rest. Rarities are based on demand (purchase limits, sold-out items), not official odds. Tap Edit on a brand to add or change items, or add your own brand below.</p>
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
                    .map((i) => `<img src="${esc(i.img || tile(i.name, i.rarity, i.shape))}" alt="${esc(i.name)}" class="${PR.state.collection[`sq:${b.id}:${i.id}`] ? '' : 'unowned'}">`)
                    .join('')}</div>`
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
    document.getElementById('sqSpinAll').onclick = () => openBag();
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
