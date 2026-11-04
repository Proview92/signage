// Help: step-by-step guides for the TV app and every part of the dashboard.
import { h, icon } from '../core.js';

// Each guide: [title, intro, steps[], tips[]?]. Steps are plain text; **bold** marks buttons and menu names.
const TV = [
  ['Set up a new TV', 'Get the PROVIEW SIGNAGE app running on an Android TV, Google TV or Fire TV stick.', [
    'Connect the TV or TV stick to the internet (Wi-Fi or cable).',
    'Install the PROVIEW SIGNAGE TV app. Proview installs it for you, or call support on 020 8935 5495 for the download.',
    'Open the app. It goes full screen and shows **Pair this screen** with a 6-character code.',
    'On your phone or computer, sign in to the dashboard and go to **Screens → Add a TV**.',
    'Type the code from the TV, give the TV a name (e.g. “Counter TV”), pick the site, then press **Pair TV**.',
    'Within a few seconds the TV shows “paired”. It plays as soon as you publish a playlist to it.',
  ], ['A brand-new TV gets a free 7-day trial licence when it is first paired.', 'The code changes every hour while the TV is waiting, so always use the one on screen now.']],

  ['What the TV does on its own', 'Once paired, the TV needs no attention.', [
    'It starts the player automatically when the TV is switched on.',
    'It downloads every picture and video before playing, so nothing freezes. A loading bar shows progress the first time.',
    'It keeps a copy of everything, so it carries on playing if the internet drops.',
    'It follows your schedule by itself: different playlists at different times and days.',
    'It picks up changes as soon as you press **Publish**. Small updates show an “Updating” badge in the corner while new files download.',
    'It reports back every few minutes: online/offline, what is playing, and proof-of-play counts for Reports.',
  ]],

  ['Open the TV menu with the remote', 'The screen menu lets staff fix common problems without a computer.', [
    'Press the **Menu** or **Settings** button on the remote, or press **Back** three times quickly.',
    'Use the arrow buttons to move and **OK** to choose. **Back** closes the menu.',
    'The menu closes by itself after a minute without a key press.',
  ]],

  ['TV menu options', 'What each item in the screen menu does.', [
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

  ['Updating the TV app', 'Keep TVs on the newest version.', [
    'When a new version is available, the TV’s page in the dashboard shows **Update app to …**.',
    'Press it and the TV downloads and installs the update. Some TVs ask for a one-time OK on screen.',
    'You can also choose **Check for app update** in the TV menu.',
  ]],
];

const DASH = [
  ['Getting around', 'The dashboard works on a computer, tablet or phone.', [
    'The menu on the left (or the bar at the bottom on a phone) has **Screens**, **Playlists**, **Media**, **Reports**, **Activity**, **Team** and **Notifications**.',
    'If you manage more than one business, pick it in the drop-down at the top. Everything you see belongs to that client.',
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
    'Filter by site, and use **Sites** to add or rename your locations.',
    'Click a TV to open its own page.',
  ]],

  ['A TV’s own page', 'Everything about one screen.', [
    '**On air now**: a live preview of what is playing.',
    '**Playlists on this TV**: every playlist assigned to it, with an **Edit** button for each.',
    '**Live screenshot**: press **Take screenshot** to see exactly what the TV is showing right now.',
    '**Schedule**: the default playlist, add-on playlists that play after it, and rules for certain days and times. Rules marked Override or High win over others.',
    '**Licence**: plan, start and expiry, with **Renew online**.',
    '**Device**: model, app version, resolution, last seen.',
    'Top buttons: **Reload TV**, **Update app**, **Re-send to TV**. The pencil edits the name, site, position and screen rotation.',
  ]],

  ['Video walls', 'Several TVs showing one big picture together.', [
    'On **Screens**, press **Video wall**, name the wall and set the number of columns and rows.',
    'Say which TV is where, as you look at the wall, and set the gap for the screen edges (bezels).',
    'Choose what the wall should play. Pictures and videos stretch across the whole wall, and every TV starts and finishes together.',
    'Remove a wall at any time: each TV goes back to its own picture and nothing is deleted.',
  ]],

  ['Emergency message', 'Take over screens instantly.', [
    'On **Screens**, press **Emergency message**.',
    'Type the message, pick a colour, choose how long it shows, and which screens: all, one site, or the whole client.',
    'It replaces what the TVs are showing straight away. End it from the banner at the top of Screens.',
  ]],

  ['Reports (proof of play)', 'What was shown, where, and for how long.', [
    'Go to **Reports** and pick the dates.',
    'Group by playlist, TV, slide or day.',
    'Press **Download CSV** to open it in Excel.',
    'TVs send their counts every 10 minutes.',
  ]],

  ['Activity', 'A log of who changed what.', [
    'Go to **Activity** to see edits, publishes, pairings and more, with who did it and when.',
    'Managers can turn on **Editors need a manager’s approval to publish** here, if changes should be checked first.',
    'Publish requests from Editors appear here. Press **Approve & publish**, or **Reject** with a reason the editor will see.',
  ]],

  ['Team and roles', 'Invite people and control what they can do.', [
    'Go to **Team** and press invite. Enter their email and choose a role.',
    '**Editor**: media, playlists and schedules. **Manager**: also adds TVs and invites people.',
    'Send the invite email, or copy the link and send it yourself (WhatsApp, text…).',
    'Forgotten password? An administrator can press **Reset password**: the person signs in with 123456 and must choose a new password straight away.',
  ]],

  ['Notifications', 'The bell keeps you up to date.', [
    'It shows offline TVs, licence reminders and payments.',
    'A number on the bell means there is something new.',
  ]],

  ['Licences', 'Every TV needs an active licence to play.', [
    'New TVs get a 7-day trial when first paired.',
    'A TV’s licence is shown on its card and its page. You get reminders before it ends.',
    'Renew on the TV’s page with **Renew online**, or contact Proview.',
  ]],

  ['Administrators: Clients & TVs', 'For Proview staff who manage several businesses.', [
    'Go to **Clients & TVs** to add a client with its sites and a manager invite.',
    'Assign TVs that are waiting for a client, and manage licences that need attention.',
    'Set the TV menu options for all screens, such as how long before the player reopens.',
  ]],
];

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const rich = (s) => { const el = h('span'); el.innerHTML = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); return el; };

function guide([title, intro, steps, tips = []], open) {
  return h('details', { class: 'help-guide', open },
    h('summary', {}, h('span', { class: 'help-title' }, title), h('span', { class: 'help-intro' }, intro)),
    h('ol', { class: 'help-steps' }, ...steps.map((s) => h('li', {}, rich(s)))),
    tips.length ? h('div', { class: 'help-tips' }, ...tips.map((t) => h('div', {}, h('b', {}, 'Tip: '), rich(t)))) : '');
}

export async function helpPage({ main }) {
  let tab = sessionStorage.getItem('signage.helpTab') || 'tv', term = '';
  const list = h('div', { class: 'help-list' });
  const tabs = h('div', { class: 'seg help-tabs' });
  const search = h('input', { type: 'search', placeholder: 'Search the help, e.g. ticker, Wi-Fi, publish', oninput: (e) => { term = e.target.value.trim().toLowerCase(); paint(); } });

  function paint() {
    tabs.replaceChildren(...[['tv', 'TV app'], ['dash', 'Dashboard']].map(([k, l]) =>
      h('button', { type: 'button', class: tab === k && !term ? 'on' : '', onclick: () => { tab = k; sessionStorage.setItem('signage.helpTab', k); search.value = ''; term = ''; paint(); } }, l)));
    const all = term ? [...TV.map((g) => ['TV app', g]), ...DASH.map((g) => ['Dashboard', g])] : (tab === 'tv' ? TV : DASH).map((g) => ['', g]);
    const hits = term ? all.filter(([, g]) => JSON.stringify(g).toLowerCase().includes(term)) : all;
    list.replaceChildren(...(hits.length ? hits.map(([where, g], i) => h('div', {}, where ? h('div', { class: 'tiny help-where' }, where) : '', guide(g, !!term || i === 0)))
      : [h('div', { class: 'muted' }, 'Nothing matches. Try another word, or call support on 020 8935 5495.')]));
  }
  paint();

  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Help'), h('p', { class: 'muted' }, 'Step-by-step guides for the TV app and the dashboard.'))),
    h('div', { class: 'help-bar' }, tabs, search),
    list,
    h('div', { class: 'card help-contact' }, h('div', { class: 'card-body' },
      h('b', {}, 'Still stuck?'), ' Call PROVIEW support on ', h('a', { href: 'tel:02089355495' }, '020 8935 5495'), ' or visit ', h('a', { href: 'https://www.proviewsignage.co.uk', target: '_blank', rel: 'noopener' }, 'proviewsignage.co.uk'), '.')));
}
