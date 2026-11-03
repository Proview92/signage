# PROVIEW SIGNAGE: digital signage for multiple clients

Upload pictures and videos from a phone or computer, build slideshows with transitions and effects, schedule them per TV, and publish to Android TV / Fire TV screens. You (the admin) manage every client. Each client gets their own logins and only sees their own TVs.

```
┌──────────────────────┐     ┌──────────────────────────┐     ┌────────────────────────┐
│ Dashboard (web/)     │     │ Supabase                 │     │ TV app (android/)      │
│ phone + desktop      │────▶│ login · database · files │◀────│ Fire TV / Android TV   │
│ index.html           │     │ live updates · security  │     │ loads web/player.html  │
└──────────────────────┘     └──────────────────────────┘     └────────────────────────┘
```

## Live setup

| | |
|---|---|
| Dashboard | https://proview92.github.io/signage/ |
| TV player (browser) | https://proview92.github.io/signage/player.html |
| TV app (APK) | https://github.com/Proview92/signage/releases/latest/download/signage-tv.apk |
| Backend | Supabase project `signage` (zbuyafrdhbgqyaepiajm, eu-west-1) |

Pushing to `main` redeploys the dashboard automatically. Changes under `android/` rebuild the APK and publish a new release.

## What it does

| Area | Features |
|---|---|
| **Accounts** | Admin (you) → **Clients** → client users with **Manager** or **Editor** roles. Invite by link. Every client's data is isolated at the database level (row-level security). |
| **TVs** | Pair with a 6-character code shown on the TV. Admin assigns TVs to clients (or a client's manager pairs their own). Online/offline status, model, last seen, remote reload. |
| **Media** | Drag-and-drop or camera-roll upload with progress bars. Images and videos stored privately per client. |
| **Playlists** | Slides from pictures, videos or text. 12 transitions (fade, slide, zoom, flip, blur, wipe, circle…), motion effects (Ken Burns, pan, slow zoom), text overlays with position, size, colour and animation, landscape or portrait, live preview, autosave. |
| **Schedules** | Per TV: a default playlist plus rules such as *"Breakfast menu, weekdays 07:00–11:00"* or *"Christmas, 1–26 Dec, override"*. Priorities, overnight slots, date ranges, a 7-day timeline view. Individual slides can also have their own time windows. |
| **Publishing** | Edits stay as drafts until you press **Publish**. TVs update within seconds. |
| **Reliability** | TVs keep the full schedule and all media cached, so they continue playing and switching on time without internet. They auto-start on boot, recover from crashes and reload nightly. |

## Setup (about 20 minutes)

### 1. Create the backend
1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste all of `supabase/schema.sql`, then click **Run**.
3. **Authentication → Sign In / Providers**:
   - Turn on **Allow anonymous sign-ins**. TVs use these.
   - Email provider: on. For easier client onboarding you can turn off **Confirm email**.
4. **Authentication → URL Configuration**: set **Site URL** to your dashboard address (step 3).
5. **Storage → Settings**: set the upload size limit. The free plan allows up to 50 MB per file; paid plans allow much larger video files.

### 2. Configure the web app
Edit `web/config.js` with your values from **Project Settings → API**:
```js
SUPABASE_URL: 'https://abcd1234.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

### 3. Host the `web/` folder (any static host with HTTPS)
- **Netlify:** drag the `web` folder onto app.netlify.com/drop.
- **Cloudflare Pages / Vercel / GitHub Pages:** deploy `web/` as a static site.

You get, for example, `https://signage.yourdomain.com/` (dashboard) and `https://signage.yourdomain.com/player.html` (TV player).

### 4. Make yourself admin
Open the dashboard, click **Create an account**, then run this in the Supabase SQL Editor:
```sql
update public.profiles set is_admin = true where email = 'altun@proviewtech.co.uk';
```
Reload the dashboard. You'll see **Clients & TVs**.

### 5. Build the TV app
**Option A, no Android Studio (recommended):**
1. Push this project to a GitHub repository.
2. **Settings → Secrets and variables → Actions → Variables**: add `PLAYER_URL` = `https://signage.yourdomain.com/player.html`.
3. **Actions → Build TV app → Run workflow**, then download `signage-tv.apk` from the run.

**Option B:** open `android/` in Android Studio, set `PLAYER_URL` in `android/gradle.properties`, then **Build → Build APK**.

> The APK is signed with a debug key by default. To use your own key, add the secrets `SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS` and `SIGNING_KEY_PASSWORD`.

### 6. Install on the TV
- **Fire TV:** Settings → My Fire TV → Developer options → **Apps from Unknown Sources** (on for "Downloader"). Install the **Downloader** app, enter a link to your APK, and install it.
- **Android TV / Google TV:** enable unknown sources, then sideload with a file manager or `adb install signage-tv.apk`.
- Open **PROVIEW SIGNAGE** and the TV shows a pairing code.
- On **Google TV**, allow *Display over other apps* for PROVIEW SIGNAGE (Settings → Apps → Special app access) so it auto-starts after a power cut.

On the TV, press **Back 5×** (or **Menu**) to change the player address without rebuilding. Press **OK** to show what's playing.

Any browser can also be a screen: open `player.html` full-screen on a smart TV browser, PC or Raspberry Pi.

## Everyday use
1. **Clients & TVs → New client.** Optionally enter the client's email to create a manager invite link straight away.
2. **Pair a TV**: enter the code shown on the TV and pick the client.
3. Switch to the client using the picker at the top left. Then:
   - **Media**: upload pictures and videos.
   - **Playlists**: build slides, set transitions, effects and text, then preview.
   - **Screens → a TV**: set a default playlist and add schedule rules, then **Publish to TV**.
4. **Team**: invite client staff. Send them the link. They sign up with that email and only see their own company.

| Role | Media, playlists, schedules, publish | Pair/remove TVs, invite users | All clients, move TVs between clients |
|---|:-:|:-:|:-:|
| Editor | ✓ | | |
| Manager | ✓ | ✓ | |
| Admin (you) | ✓ | ✓ | ✓ |

## Good to know
- **Video format:** MP4 (H.264, 1080p) plays everywhere. iPhone `.mov`/HEVC may not play on older sticks.
- **Time zones:** schedule times use the TV's own clock and time zone.
- **Offline:** a TV that loses internet keeps playing its last published schedule. A small red dot appears in the corner until it reconnects.
- **Costs:** Supabase's free tier covers testing and a handful of screens. Each TV downloads media once and caches it, so bandwidth stays low.

## Project layout
```
supabase/schema.sql      Database, security rules, pairing/publishing functions
web/index.html           Dashboard (mobile + desktop)
web/player.html          TV player
web/js/renderer.js       Slide engine: transitions, effects, schedules (shared)
web/js/pages/*.js        Dashboard pages
web/sw.js                Offline cache for the player
android/                 Android TV / Fire TV app (Kotlin)
.github/workflows/       Builds the APK on GitHub
tools/vendor-supabase.sh Bundle the Supabase library locally instead of loading it from a CDN
```

## Ideas for the next version
Proof-of-play reports · screenshot from TV · weather, clock, RSS and YouTube widgets · split-screen layouts · emergency "override all screens" button · automatic video conversion · per-client branding (white label) · invite emails sent automatically (Supabase Edge Function) · billing per screen.
