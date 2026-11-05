# Pack Ripped

Earn points by walking and finishing daily tasks, then spend them to rip open
Magic: The Gathering booster packs with real pack odds. Every card you pull is
added to your collection.

## Features
- **Earn ◆ points**
  - Steps: 10 steps = 1 ◆, so 1,000 steps earns a pack. Count steps live with the phone's motion sensor
    (while the app is open), or sync today's total from your Health app.
  - Daily tasks: editable list (workout, water, reading…), reset at midnight.
  - Daily check-in with a growing streak bonus.
- **Open packs** from almost every Magic expansion, using real card lists from
  [Scryfall](https://scryfall.com).
  - Play Boosters (2024+): 14 cards, 1 rare/mythic (mythic ~13.5%), a wildcard,
    and a foil.
  - Draft Boosters (older sets): 15 cards, mythic 1 in 8, foil in ~1 of 3 packs.
  - Collector Boosters (Throne of Eldraine, 2019, onward; 400 ◆): 15 cards,
    12 foils, 5 rares/mythics, including the set's real extended-art,
    borderless and showcase versions. Contents vary by set, so this uses the
    typical layout.
- **Commander deck builder**: build 100-card decks using only cards you own,
  plus unlimited basic lands (Plains, Island, Swamp, Mountain, Forest, Wastes).
  Checks commander eligibility, partners/Backgrounds, color identity,
  singleton, and the Commander ban list. Export to Moxfield in one tap: it copies the list (with your exact printings and foils) and opens Moxfield so you can paste it in.
- **Friends & steps leaderboard** (optional, needs a free Supabase project, see
  [SETUP-FRIENDS.md](SETUP-FRIENDS.md)): sign up with a username, add friends,
  browse each other's collections and decks, and compete on steps today, this
  week, or all time.
- **Trading** with friends (needs the Friends server): pick cards from their
  collection and yours, send an offer, and they accept or decline. The swap
  happens on the server in one step, and each phone applies it on its next
  sync. If you trade away a card a deck uses, the deck switches to another copy
  you own, or the card leaves the deck and frees the slot. You're warned before
  offering.
- **Pack Wars** (official "Mini-Master" rules from Wizards' minigame card): each
  player rips a pack face down, adds three of each basic land, shuffles and plays.
  Best of three; between games keep your deck, add a pack and cut to 30, or
  replace it with a new pack. Optional land rule. Shared virtual table with
  draw, play, tap, counters, graveyard, exile, London mulligan, life, turns and
  a game log. Play online against a friend (needs the Friends server) or with
  two players on one phone. The app doesn't enforce Magic's rules.
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
