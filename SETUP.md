# Setting up FurZone

FurZone works out of the box in **demo mode** (everything in memory, nothing shared). To make it a real
social network, it needs a server. FurZone uses **Supabase** (free plan is enough to start): a Postgres
database, logins, file storage and one small server function.

Nothing on this page needs code. Take it one step at a time.

---

## 1. Create the server (Supabase) — ~10 minutes

1. Go to **supabase.com** → sign up → **New project**. Pick a name (e.g. `furzone`), a strong database
   password (save it somewhere), and the region closest to you.
2. When it's ready, open **SQL Editor** → **New query**, paste **all** of `supabase/schema.sql`, press
   **Run**. It should say *Success. No rows returned*. (Running it again later is safe.)
3. **Authentication → Sign In / Providers → Email**: keep *Confirm email* on.
   **Authentication → Policies / Attack Protection**: set the minimum password length to 8. If your plan
   has it, turn on *Leaked password protection*.
4. **Authentication → Emails → Reset Password**: add this line to the message so people get a code they
   can type into the app:

   ```
   Your FurZone code: {{ .Token }}
   ```
5. **Authentication → URL Configuration → Redirect URLs**, add both:
   - `https://appassets.androidplatform.net/**`
   - `https://app.furzone.local/**`
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key. These two are
   meant to be public (they're inside the app); send them to whoever builds the app, or put them in a
   file called `.env.production` in the project folder:

   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   **Never** share the `service_role` key or the database password.

## 2. Discord login and the Discord badge — ~5 minutes

1. Go to **discord.com/developers/applications** → **New Application** → name it *FurZone*.
2. **OAuth2**: copy the **Client ID**, press **Reset Secret** and copy the **Client Secret**.
   Under *Redirects*, add `https://xxxxxxxx.supabase.co/auth/v1/callback` (your Project URL + that path).
3. In Supabase: **Authentication → Sign In / Providers → Discord** → enable, paste the ID and secret, save.
4. **Authentication → Sign In / Providers** (top of the page): turn on **Allow manual linking**, so people
   who signed up with email can connect Discord later.

## 3. The VRChat badge — ~10 minutes

VRChat has no "log in with VRChat" for other apps, so FurZone checks a short code that people put in their
VRChat bio. A server function reads public VRChat profiles using a **separate VRChat account you make just
for this** (never your main account).

1. Make a new VRChat account (e.g. `FurZoneVerify`), log in on vrchat.com once.
2. Turn on **two-factor authentication with an authenticator app** for it. When VRChat shows the QR code,
   also copy the **secret key** text (the "can't scan?" code). Finish setup with your authenticator app.
3. In Supabase: **Edge Functions → Secrets**, add:
   - `VRCHAT_BOT_USERNAME` — the bot account's username or email
   - `VRCHAT_BOT_PASSWORD` — its password
   - `VRCHAT_BOT_TOTP_SECRET` — the secret key from step 2
4. Deploy the function `supabase/functions/vrchat-verify` (both files). Either:
   - automatically: add the GitHub secret `SUPABASE_ACCESS_TOKEN` (Supabase → Account → Access Tokens)
     and the variable `SUPABASE_PROJECT_REF` (the `xxxxxxxx` in your Project URL); the release workflow
     deploys it on every push, or
   - by hand: `npx supabase login`, then `npx supabase functions deploy vrchat-verify --project-ref xxxxxxxx`.

## 4. Updates through GitHub — ~5 minutes

1. Create a **public** GitHub repository named **FurZone** (the apps read its releases to update).
2. Push this project to it.
3. **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `ANDROID_KEYSTORE_B64` — the contents of `furzone-signing-key.txt` (the long line under KEYSTORE)
   - `ANDROID_KEYSTORE_PASSWORD` — the password in that same file

   Keep that file private and backed up: phones only accept updates signed with this exact key.
4. Every push to `main` now runs all tests, then publishes **FurZone.apk** and **FurZone_Setup.exe** as a
   release. Installed apps see it and update themselves.

---

## How it stays safe

- **Logins**: Supabase Auth (bcrypt-hashed passwords, email confirmation, built-in rate limits on login and
  sign-up, Discord via OAuth with PKCE). Passwords never touch FurZone's own code.
- **Every table has Row Level Security**: logged-out visitors can read nothing; you can only change your own
  things; counters, tags, owners, timestamps and badges are set by the database and can't be faked.
- **Rate limits in the database** stop spam floods even from scripts: posts, comments, boops, follows,
  blocks, reports, VRChat checks.
- **Blocking** hides two people from each other completely. **Five reports** hide a post until you review it
  (Supabase → Table Editor → `posts`, set `hidden` back to false, or delete it).
- **Uploads** only into your own folder, max 50 MB, only image/video types (no HTML/SVG/scripts); photos are
  re-drawn on the phone first, which strips hidden GPS data.
- **The apps**: strict Content Security Policy, no HTML from users ever rendered, only the app / Discord login /
  your Supabase sign-in may load inside the app window, dev tools off, and updates are only installed if their
  SHA-256 checksum matches the release (Android also requires the same signing key).
- **DDoS**: Supabase sits behind a global edge network with its own rate limiting; the database limits above
  cap what any one account can do. For very large traffic, upgrade the Supabase plan and turn on CAPTCHA
  (Authentication → Attack Protection).

## Moderation

Reports are stored in the `reports` table (only visible in the Supabase dashboard). To ban someone, delete
their user in **Authentication → Users**; everything they posted is removed with them.
