// Help guide content, shared by the Help page and the AI help chat (built into /help-kb.json on deploy).
// No imports here: the deploy workflow loads this file in Node.

// Each guide: [title, intro, steps[], tips[]?]. Steps are plain text; **bold** marks buttons and menu names.
export const TV = [
  ['Set up a new TV', 'Get the PROVIEW SIGNAGE app running on an Android TV, Google TV or Fire TV stick.', [
    'Connect the TV or TV stick to the internet (Wi-Fi or cable).',
    'Install the PROVIEW SIGNAGE TV app. On the TV, install the free **Downloader** app (Fire TV: search for it on the home screen; Android TV: Google Play Store).',
    'Fire TV only: go to **Settings → My Fire TV → Developer options → Install unknown apps** and turn on Downloader.',
    'Open Downloader, type **app.proviewsignage.co.uk/tv.apk**, press **Go**, then **Install** and **Open**.',
    'Open the app. It goes full screen and shows **Pair this screen** with a 6-character code.',
    'On your phone or computer, sign in to the dashboard and go to **Screens → Add a TV**.',
    'Type the code from the TV, give the TV a name (e.g. “Counter TV”), pick the location, then press **Pair TV**.',
    'Within a few seconds the TV shows “paired”. It plays as soon as you publish a playlist to it.',
  ], ['A brand-new TV gets a free 3-day trial licence when it is first paired.', 'The code changes every hour while the TV is waiting, so always use the one on screen now.']],

  ['What the TV does on its own', 'Once paired, the TV needs no attention.', [
    'It starts the player automatically when the TV is switched on.',
    'It downloads every picture and video before playing, so nothing freezes. A loading bar shows progress the first time.',
    'It keeps a copy of everything, so it carries on playing if the internet drops.',
    'It follows your schedule by itself: different playlists at different times and days.',
    'It picks up changes as soon as you press **Publish**. Small updates show an “Updating” badge in the corner while new files download.',
    'It reports back every few minutes: online or offline, and what is playing.',
  ]],

  ['Open the TV menu with the remote', 'The screen menu lets staff fix common problems without a computer.', [
    'Press the **Menu** or **Settings** button on the remote, or press **Back** three times quickly.',
    'Use the arrow buttons to move and **OK** to choose. **Back** closes the menu.',
    'The menu closes by itself after a minute without a key press.',
  ]],

  ['TV menu options', 'What each item in the screen menu does.', [
    '**Skip to next content**: show the next slide and keep it on screen: the playlist and schedule pause (every area of a split layout moves on; on a video wall every TV moves on together). Press it again for the slide after. The dashboard shows **Schedule paused on TV**.',
    '**Reactivate schedule**: appears after a skip. Goes back to the normal playlist and schedule.',
    '**Reload content**: fetch the latest schedule and media now.',
    '**Screen status**: the TV’s name, licence, what is playing, connection, device and app version.',
    '**Wi-Fi & network settings**: opens the TV’s network settings to join a different Wi-Fi. The player reopens itself after a few minutes.',
    '**Exit to home screen**: leave the player to change other TV settings. It reopens after the set number of minutes.',
    '**Exit until next restart**: close the player until the TV is switched off and on again.',
    '**Check for app update**: install the newest version of the TV app.',
    '**Allow automatic reopening**: shown when the TV still needs the “Display over other apps” permission, so the player can reopen itself.',
    '**Unlink this TV**: disconnect the TV from its account. Choose **Yes, unlink this TV** to confirm. It goes back to the pairing code page and can be added again.',
  ]],

  ['No internet on the TV', 'If the TV cannot reach the internet when it starts.', [
    'The app shows an offline message. Content already downloaded keeps playing.',
    'Press **OK** on the remote to open the Wi-Fi settings and reconnect.',
    'The player comes back on its own once the connection works.',
  ]],

  ['Portrait (sideways) TVs', 'For TVs mounted on their side.', [
    'Choose **Portrait** for the playlist in the editor (step 1).',
    'The app follows the TV’s own orientation setting automatically.',
    'If the picture still comes out sideways, open the TV in the dashboard, press the pencil next to its name and set **Screen rotation**.',
  ]],

  ['Sleep hours on the TV', 'What the TV does when its sleep hours start and end.', [
    'At the switch-off time the screen goes black and the content stops.',
    'If the TV has allowed it, the app also switches the TV stick off, and most TVs switch off with it. At the switch-on time both wake up and the content starts again.',
    'To allow it (once per TV): press **Menu** on the remote, choose **Allow switching the TV off**, then **Activate** / **Allow** on the next screen. Until then the TV shows a black screen during sleep hours.',
    'Need the screen during sleep hours? Press **OK** on the remote: it wakes for 1 hour, then goes back to sleep.',
    'If someone switches the TV on during sleep hours and presses nothing, it goes back to sleep after a minute.',
  ], ['Some TVs don’t switch themselves off or on with the TV stick (HDMI-CEC, often called Anynet+, SimpLink, Bravia Sync or CEC in the TV’s settings). Turn that setting on in the TV for the best result.', 'Fire TV sticks may not allow apps to switch them off. They use the black screen instead.']],

  ['Updating the TV app', 'Keep TVs on the newest version.', [
    'When a new version is available, the TV’s page in the dashboard shows **Update app to …** (and **App x.x ✓** when it is up to date).',
    'Press it and the TV downloads and installs the update. Some TVs ask for a one-time OK on screen.',
    'You can also choose **Check for app update** in the TV menu.',
  ]],
];

export const DASH = [
  ['Getting around', 'The dashboard works on a computer, tablet or phone.', [
    'The menu on the left (or the bar at the bottom on a phone) has **Screens**, **Playlists**, **Media** and **Users**. Notifications, search, chat and your account are in the bar at the top.',
    'If you manage more than one business, pick it in the drop-down at the top. Everything you see belongs to that business.',
    'Your role is shown under your email: Administrator, Manager or Editor.',
  ]],

  ['The quick start', 'From nothing to a playing TV.', [
    'Upload pictures, videos or PDFs in **Media**.',
    'Create a playlist in **Playlists** (or start from a template).',
    'Pair the TV in **Screens → Add a TV**.',
    'In the playlist editor, go to step 4 and press **Choose TVs & publish**.',
  ]],

  ['Media library', 'All your pictures, videos and PDFs in one place.', [
    'Go to **Media** and drop files onto the page, or press the upload button. On a phone you can pick from your camera roll.',
    'Pictures: JPG, PNG, WebP, GIF. Videos: MP4, WebM. PDFs: each page becomes its own picture.',
    'Choose **Picture & video quality**: Recommended plays smoothly on every TV; 4K is sharper on 4K TVs but files are bigger.',
    'Use folders to keep things tidy: type a new folder name, and uploads go into it.',
    'Click a file to see its details, move it to a folder or delete it.',
  ]],

  ['Create a playlist', 'A playlist is what plays on the screen.', [
    'Go to **Playlists**. Press **Blank playlist**, or pick a **template** with a ready-made layout.',
    'The editor opens on step 1. Everything saves automatically as you go; there is no Save button.',
    'The picture on the left always shows the whole screen, exactly as it will look on the TV.',
  ]],

  ['Editor step 1 · Screen & layout', 'Choose the shape of the screen and how it is split.', [
    'Type the playlist name.',
    'Choose **Landscape** or **Portrait**.',
    'Pick a layout: full screen, side panel, split, three or four areas, and more.',
    'Drag the sliders to change the size of each area. The exact size of each area in pixels is shown, so you can make content that fits perfectly.',
    'Tick **Add a scrolling ticker** for a moving text strip. Choose where it sits (top, bottom, both, or inside one area), its text, speed, size, colours and direction.',
  ]],

  ['Editor step 2 · Add / edit content', 'Fill each area with slides.', [
    'Each area has its own box. Click an area’s box (or click the area on the screen picture) to select it.',
    'Press **Pictures & videos**, **Text** or **Widget** to add to that area.',
    'Click a slide to edit it. The settings appear underneath.',
    '**Timing**: how many seconds a picture shows. Videos play to the end unless you set a time.',
    '**Transition**: how the slide arrives (fade, slide, zoom, circle…). **Motion effect**: movement while it shows (slow zoom, pan, flashing…).',
    '**Fit**: Stretch to area, Fill (crop), Fit whole, or Fit + blur (fills the gaps with a blurred copy).',
    'Use the arrows to change the order, the eye button to view a slide on its own, and the bin to remove it.',
  ], ['Transitions only show when an area has two or more slides.']],

  ['Text slides and widgets', 'Add information that updates by itself.', [
    '**Text**: a headline and subtitle on a colour or picture background, with animations.',
    '**Widget** adds a box you can drag and resize on the slide: Text box, Clock & date, Weather, QR code, or Menu / price list.',
    'Drag a widget to move it and drag its corner to resize it. Its settings appear under the slide.',
  ]],

  ['Editor step 3 · Schedule', 'Show slides only at certain times.', [
    'Click a slide and choose the dates it runs between, which days, and which hours.',
    'Leave it empty to show the slide all the time.',
    'Example: a breakfast offer only on weekdays 7:00–11:00.',
  ]],

  ['Editor step 4 · Choose TVs & publish', 'Send the playlist to your screens.', [
    'Check the summary, and press **Preview full screen** to watch it play.',
    'Press **Choose TVs & publish**, tick the TVs, and choose **Always** or **At certain times**.',
    'Press **Publish**. The TVs update within seconds, and you return to Playlists.',
    'Changed something later? Press **Publish** again to update the TVs.',
  ], ['If your business needs approval, an Editor’s Publish becomes a request that a Manager approves.']],

  ['Managing playlists', 'From the Playlists page.', [
    'Press the pencil next to a name to rename it.',
    '**Edit** opens the editor, **Publish** sends it to TVs.',
    'The copy button duplicates a playlist; the bin deletes it.',
    'Each card shows the number of slides, loop length, orientation and how many TVs use it.',
  ]],

  ['Screens', 'All your TVs at a glance.', [
    'Each card shows what the TV is playing, whether it is online, its licence, and **Unpublished changes** if you edited something but didn’t publish.',
    'Change the playlist straight from the card using the **Playing** drop-down.',
    'Press the pencil next to a TV’s name to rename it.',
    'Filter by location, and use **Locations** to add or rename your locations.',
    'Click a TV to open its own page.',
  ]],

  ['A TV’s own page', 'Everything about one screen.', [
    '**On air now**: a live preview of what is playing.',
    '**Playlists on this TV**: every playlist assigned to it, with an **Edit** button for each.',
    '**Live screenshot**: press **Take screenshot** to see exactly what the TV is showing right now.',
    '**Schedule**: the default playlist, add-on playlists that play after it, and rules for certain days and times. Rules marked Override or High win over others.',
    '**Licence**: plan, start and expiry, with **Renew online**.',
    '**Device**: model, app version, resolution, last seen.',
    'Top buttons: **Reload TV**, **Update app**, **Re-send to TV**. The pencil edits the name, location, position and screen rotation.',
  ]],

  ['Pause, stop and play a playlist', 'Take one playlist off your TVs for a while without changing any schedules.', [
    'Open **Playlists** (or a TV’s page, under **Playlists on this TV**).',
    '**Pause**: choose how long (30 minutes, 1 hour, 2 hours, until the end of today, until tomorrow 06:00, or a date and time). TVs skip the playlist and play whatever else is scheduled, then go back to it by themselves.',
    '**Stop**: TVs skip the playlist until you press **Play**.',
    '**Play**: puts it back on the TVs straight away.',
    'A paused playlist shows **Paused until …**, a stopped one shows **Stopped**. If it was the only thing on a TV, that TV shows a blank screen meanwhile.',
  ], ['Pausing doesn’t publish anything: edits you haven’t published stay unpublished.']],

  ['Sleep hours', 'Switch TVs off out of hours and back on in the morning.', [
    'Open a TV from **Screens**. Find the **Sleep hours** card and press **Edit**.',
    'Tick **Switch this TV off out of hours**, then choose **Switch off at** and **Switch on at** (the TV’s local time), and the nights it applies.',
    'Choose **Switch the TV off** (best: saves power; needs a one-off Allow on each TV) or **Black screen only** (works on every TV).',
    'Under **Apply to**, choose this TV, every TV at the same location, or all your TVs, then press **Save**. TVs pick it up within seconds.',
    'Need it on outside its hours? Press **Wake now** on the TV’s page (stays on until the next switch-off). **Sleep now** switches it off early. **Back to normal hours** cancels either.',
    'On the Screens page a TV in its sleep hours shows **Sleeping until …** instead of Offline.',
  ], ['A TV that is fully switched off can’t receive Wake now until it wakes at its set time: press OK on its remote to wake it straight away.']],

  ['Video walls', 'Several TVs showing one big picture together.', [
    'On **Screens**, press **Video wall**, name the wall and set the number of columns and rows.',
    'Say which TV is where, as you look at the wall, and set the gap for the screen edges (bezels).',
    'Choose what the wall should play. Pictures and videos stretch across the whole wall, and every TV starts and finishes together.',
    'Remove a wall at any time: each TV goes back to its own picture and nothing is deleted.',
  ]],

  ['Users and roles', 'Invite people and control what they can do.', [
    'Go to **Users** and press invite. Enter their email, choose a role, tick the locations they can see and the features they can use.',
    '**Owner / Admin**: every location and feature, adds TVs and locations, manages users. **Manager**: only their locations and features, publishes without approval. **Staff**: only their locations and features.',
    'Press **Edit access** next to a person to change their role, locations or features. Nobody can change their own access.',
    'Playlists and media are shared with all locations unless you pick **Locations** for them (on the playlist’s **Screen & layout** step, or in a file’s details). Managers and Staff only see shared items and items for their locations; what they create is kept to their locations, and shared items are view-only for them (they can duplicate a playlist to make their own copy).',
    'Send the invite email, or copy the link and send it yourself (WhatsApp, text…).',
    'Forgotten password? An administrator can press **Reset password**: the person signs in with 123456 and must choose a new password straight away.',
  ]],

  ['Notifications', 'The bell keeps you up to date.', [
    'It shows offline TVs, licence reminders and payments.',
    'A number on the bell means there is something new.',
  ]],

  ['Licences', 'Every TV needs an active licence to play.', [
    'New TVs get a 3-day trial when first paired.',
    'A TV’s licence is shown on its card and its page. You get reminders before it ends.',
    'Renew on the TV’s page with **Renew online**, or contact Proview.',
  ]],

  ['Administrators: Locations', 'For Proview staff who manage several businesses.', [
    'Go to **Locations** to add a business, then add its locations and invite its owner.',
    'Assign TVs that are waiting for a business, and manage licences that need attention.',
    'Set the TV menu options for all screens, such as how long before the player reopens.',
  ]],
];

// Extra facts for the AI help chat (not shown as guides).
export const FACTS = [
  'Product: PROVIEW SIGNAGE digital signage by Proview Tech, UK. Website proviewsignage.co.uk, dashboard app.proviewsignage.co.uk.',
  'Phone support: 020 8935 5495. We can also set everything up for you (installation, content design, updates).',
  'Works on Android TV, Google TV and Fire TV sticks. TV app download: app.proviewsignage.co.uk/tv.apk',
  'Pricing per TV, in GBP, excluding VAT, currently 50% off: 1 month £6 (was £12); 12 months £54 (£4.50 a month, was £108); 36 months £126 (£3.50 a month, was £252). 10 or more screens: call for a quote.',
  'Free trial: 3 days on 1 screen with every feature, no card needed. Sign up at app.proviewsignage.co.uk/#/signup. To add more TVs during a trial, buy a licence for the first TV.',
  'Licences do not renew automatically: renew online from the TV page in the dashboard (Licence → Renew online). Paid licences keep playing for 7 days after expiry, then stop; trials stop when they end.',
  'Data is stored in the EU (Ireland).',
];
