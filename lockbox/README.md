# 🔒 Lockbox

Lock money away with someone you trust, set goals worth part of it, and earn it
back as you hit them.

**Lockbox never holds or moves money.** You give the money to your referee (or
park it in a separate account), and Lockbox keeps the record: goals, claims,
approvals, what's owed back and what you've received. All data stays on your
device (browser storage). Use **Settings → Save backup** now and then.

## How it works
1. Create a Lockbox: amount, who holds it, final deadline.
2. Your referee types their own PIN on your phone (you don't learn it).
3. Add goals, each worth part of the money.
4. Hit a goal, tap **I did it**, and add proof. Your referee approves it with their PIN.
5. They pay you back, and you tap **I got it back**.

## Safety net (so money never gets stuck)
- **Final deadline:** anything still locked comes back after it, no conditions.
  You can extend the deadline, but you can't make it earlier.
- **Referee no-show:** if a claim isn't answered within 3, 7 or 14 days, it's approved automatically.
- **Backup referee:** an optional second person with their own PIN.
- **Emergency withdrawal:** unlocks everything after a 24h, 72h or 7-day wait that you can cancel,
  with an optional penalty that goes to a charity you choose. A referee can release early with their PIN.

No referee PIN set? It runs on the honor system.

## Run it
It's a static web app with no build step:

```sh
cd lockbox
python3 -m http.server 8080
# open http://localhost:8080
```

On your phone, open it over HTTPS and use **Add to Home Screen** to install it.

> The PIN is a speed bump for honesty, not real security. The data sits in your
> own browser, so a determined person could edit it. The real money is
> protected by the person holding it.
