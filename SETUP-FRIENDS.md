# Turning on Friends & the leaderboard

Friends, shared collections and decks, the steps leaderboard and online Pack
Wars need a small online database. This uses **Supabase**, which is free for an app this size. It
takes about 5 minutes, and you can do it all from a phone browser.

You only do this once. Everyone else just creates an account in the app.

## 1. Create a free Supabase account
Go to **https://supabase.com**, tap **Start your project**, and sign up.
"Continue with GitHub" is quickest.

## 2. Create a project
- Tap **New project**.
- Name: `pack-ripped`
- Database password: make one up and save it somewhere. The app doesn't need it.
- Region: the one closest to you. Plan: **Free**.
- Tap **Create new project** and wait 1–2 minutes while it sets up.

## 3. Let people sign up with just a username
In the left menu, open **Authentication → Sign In / Providers** (on some
screens it's **Providers → Email**):
- Keep **Email** turned on.
- Turn **Confirm email** **OFF**, then tap **Save**.

The app turns each username into a placeholder email behind the scenes, so no
real email address is used or sent. If Confirm email stays on, sign-ups will
fail.

## 4. Create the database tables
- Open the setup script in this repo: `supabase/setup.sql`. On GitHub, tap the
  file, tap **Raw**, then select all and copy.
- In Supabase, open **SQL Editor → New query**, paste, and tap **Run**.
- You should see **"Success. No rows returned."** Running it again is safe.

## 5. Connect the app
Open **Project Settings → API Keys** (or **Data API**) and copy:
- **Project URL** (looks like `https://abcdefghijkl.supabase.co`)
- **anon / public** key (or **publishable** key, starting with `sb_publishable_`)

Both are **meant to be public**. They go into the app's code, and the database
rules in `setup.sql` decide who can see what. Do **not** share the
`service_role` / secret key.

Send those two values to Claude to add, or paste them into `config.js`
yourself:

```js
window.PACKRIPPED_CONFIG = {
  supabaseUrl: 'https://abcdefghijkl.supabase.co',
  supabaseAnonKey: 'your-anon-or-publishable-key',
  usernameEmailDomain: 'users.packripped.app',
};
```

## What friends can see
- **Friends** (after they accept your request): your collection, your decks,
  and your steps.
- **Everyone signed in**: only your username and step totals, on the
  "Everyone" leaderboard.
- Nobody can change anyone else's data.

## Good to know
- **Forgotten passwords can't be reset** (there's no real email). You can
  still reset one by hand in Supabase under **Authentication → Users**.
- **Steps run on the honor system.** Synced steps can only go up within a day
  and are capped at 100,000 a day, but someone could type a fake number.
- **If sign-up says the email is invalid**, change `usernameEmailDomain` in
  `config.js` to another domain-style value, such as `pr-users.net`. Existing
  accounts keep working only if the domain stays the same, so pick one before
  friends join.
- **Data limits:** the free plan has plenty of space for a group of friends.
  Projects pause after a week with no activity. Open the Supabase dashboard
  and tap **Restore** if that happens.
