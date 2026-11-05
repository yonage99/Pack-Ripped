# Pack Ripped

Earn points by walking and finishing daily tasks, then spend them to rip open
Magic: The Gathering booster packs with real pack odds. Every card you pull is
added to your collection.

## Features
- **Earn ◆ points**
  - Steps: 100 steps = 1 ◆. Count steps live with the phone's motion sensor
    (while the app is open), or sync today's total from your Health app.
  - Daily tasks: editable list (workout, water, reading…), reset at midnight.
  - Daily check-in with a growing streak bonus.
- **Open packs** from almost every Magic expansion, using real card lists from
  [Scryfall](https://scryfall.com).
  - Play Boosters (2024+): 14 cards, 1 rare/mythic (mythic ~13.5%), a wildcard,
    and a foil.
  - Draft Boosters (older sets): 15 cards, mythic 1 in 8, foil in ~1 of 3 packs.
- **Collection** with copies, foils, market prices, filters, and pack history.
- Installable on your phone's home screen. Backup and restore by copy/paste.

## Run it
It's a static site with no build step. Turn on **GitHub Pages** (Settings → Pages →
Deploy from a branch → `main` / root), or serve the folder locally:

```
python3 -m http.server 8000
```

Card data and images © Wizards of the Coast, provided by Scryfall. This is an
unofficial fan project. It is not affiliated with or endorsed by Wizards of the Coast.
