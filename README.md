# FurZone 🐾

A social app for furries: share art, fursuits and VRChat moments, boop posts, follow your pack.
Android and Windows apps, with **Discord** and **VRChat** connected-account badges.

- `web/` — the app (Vite, plain JavaScript; same code in both apps)
- `supabase/schema.sql` — the database and all its security rules
- `supabase/functions/vrchat-verify/` — the server check behind the VRChat badge
- `android/` — the Android app (WebView shell, self-updater)
- `desktop/` — the Windows app (WebView2 shell, installer, self-updater)
- `.github/workflows/release.yml` — tests, builds and publishes both apps on every push

**Setting it up:** see [SETUP.md](SETUP.md).

```
npm install
npm run build                 # web app → dist/web (demo mode without .env.production)
node --test test/*.test.js    # database, VRChat and helper tests
node test/ui.test.mjs         # click-through tests (needs Playwright)
bash android/build.sh         # → android/build/FurZone.apk
bash desktop/build.sh         # → desktop/FurZone_Setup.exe
```

Made by Deltro.
