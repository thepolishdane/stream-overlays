# stream-overlays

Custom [Social Stream Ninja](https://socialstream.ninja) themes by [thepolishdane](https://twitch.tv/thepolishdane).

Two overlays for live-streaming with multi-platform chat (Twitch / YouTube / TikTok / Kick + StreamElements donations):

| File | Purpose |
|---|---|
| [`chat.html`](chat.html) | Chat overlay with shared-chat origin markers, reply support, per-message backdrops, new-chatter highlight |
| [`activity.html`](activity.html) | Unified activity feed: subs, gifts, raids, super chats, hearts, follows, donations, with streak grouping for high-frequency events |
| [`demo.html`](demo.html) | Standalone preview of the chat overlay with fake messages for visual testing (no SSN session needed) |

## Quick start

1. Get your SSN session ID from [socialstream.ninja](https://socialstream.ninja) (the random short code under your dashboard).
2. Paste this URL into an **OBS Browser Source** or **OBS Dock**:

```
https://thepolishdane.github.io/stream-overlays/chat.html?session=YOUR_SESSION_ID&twitchchannel=your_twitch_login&isdock=true
```

Replace `YOUR_SESSION_ID` and `your_twitch_login` (lowercase).

3. For the activity feed, use:

```
https://thepolishdane.github.io/stream-overlays/activity.html?session=YOUR_SESSION_ID&isdock=true
```

## URL parameters

### chat.html

| Param | Default | Notes |
|---|---|---|
| `session` | (required) | Your SSN session ID |
| `twitchchannel` | (optional) | Your Twitch login, lowercase. Enables the gold-dot marker on messages coming from collab channels via Twitch Shared Chat |
| `isdock` | off | Dock mode: smaller fonts, source-platform icons, viewer-count stats bar at top |
| `scroll` | off | Mouse-wheel scrollable, auto-sticks to bottom unless user scrolls up |
| `bgalpha` | `0.4` | Message backdrop opacity, `0` = transparent, `1` = solid |
| `sharedalpha` | `0.6` | Opacity for messages from collab partner channels |
| `limitbadges` | unlimited | Max badges per user (recommend `2`) |
| `showtime` | `1` | `0` hides message timestamps |
| `fadezone` | `1` | `0` disables fade animation |
| `viewonly` | off | Read-only mode, no SSN reply/mod controls |
| `fakestats` | off | Pre-populate dock stats bar for OBS layout previewing |
| `debug` | off | DevTools console logging + red DEBUG banner |

### activity.html

| Param | Default | Notes |
|---|---|---|
| `session` | (required) | Your SSN session ID |
| `isdock` | off | Dock mode styling |
| `scroll` | off | Scrollable mode |
| `se_jwt` | (optional) | StreamElements JWT token if you want SE donations in the feed. Find it at: StreamElements dashboard, profile name, Channels tab, Show secrets, JWT Token. **Keep this URL private,** the JWT grants channel access. |
| `fakedata` | off | Pre-populate with fake events for OBS layout previewing |

## Use cases

### OBS Browser Source (on stream)

Drop the URL into Sources, Browser. Recommended size: 380x600 for chat, 380x320 for activity. Set transparent background in the browser-source properties.

### OBS Dock (sidebar monitoring)

Custom Browser Docks, paste URL with `&isdock=true`. Use a vertically tall dock for chat.

### Always-on-top over fullscreen game

OBS docks don't help if your eyes have to stay on a different monitor (sim racing, rhythm games, etc.). Use the companion Electron app at [ssn-desktop-overlay](https://github.com/thepolishdane/ssn-desktop-overlay) (not yet public), which wraps these same URLs into a transparent, click-through, always-on-top window over borderless-fullscreen games.

## Customizations vs stock SSN

These overlays start from Steve Seguin's [`sampleoverlay.html`](https://github.com/steveseguin/social_stream/blob/main/themes/sampleoverlay.html) and add:

- **Twitch Shared Chat origin detection** via parallel anonymous IRC connection (SSN doesn't expose this server-side). Gold dot appears next to messages coming from a collab partner's channel.
- **Reply context** rendered as a pill above the message, not inline italic text.
- **Per-message rounded backdrops** with tunable opacity.
- **First-time chatter highlight** (green tinted message + "NEW CHATTER" pill), driven by SSN's `firsttimers` database flag.
- **Unified activity feed** with canonical event normalizer covering Twitch + YouTube + TikTok + StreamElements, streak grouping for high-frequency events (TikTok likes/joins), highlight deduplication.
- **TikTok gift catalog** (~440 gifts) with diamond values for monetary display.

## Contributing

PRs welcome. Each overlay is one self-contained HTML file (plus shared JS in `activity-feed/`). Use [`demo.html`](demo.html) for visual iteration without going live.

## License

MIT, see [LICENSE](LICENSE).
