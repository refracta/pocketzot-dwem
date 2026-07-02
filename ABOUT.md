# About PocketZot

PocketZot is an unofficial [DCSS](https://crawl.develz.org) [WebTiles](https://crawl.develz.org/wordpress/howto) client designed for phones in portrait mode.

## Features

- Custom ASCII-first design that fits the full standard console map onto a phone in
  portrait mode, with a font still large enough to read
- Tiles support
- Log in with multiple WebTiles server accounts and easily switch between them
- Many menus and descriptions contain inline tap regions for quick touch interaction
- Context-aware control sets for common situations
- Spectator mode with an expanded map view
- Floating, collapsible monster list; tap for details
- Installs to your home screen as a PWA

## Controls

The controls are organized into three tabs: **@**, **>**, and **?**. The mental model:

- **@** *"micro"* — moment-to-moment actions, including during battle
- **>** *"macro"* — actions often taken outside of battle, or after clearing a floor
- **?** *"info"* — commands to get information about your character or game

Obligatory virtual keyboard also available.

## Gestures

- Double tap on map to toggle zoom level
- Two-finger long press on map to toggle ASCII/tiles
- Double tap Shift to lock it
- Tap floating monster list for full view, then tap monster to inspect
- Tap chevron at top-right of monster list to collapse to single-line view

## Version support

Current stable and trunk DCSS are supported. Versions back to 0.24 generally work; older versions and forks may or may not — in particular, starting a new character on versions before 0.24 doesn't work.

## Security

PocketZot is a static web app with no backend of its own. Your browser connects directly to your chosen DCSS server over an encrypted WebSocket (`wss://`). Your account is a WebTiles account between you and that server — PocketZot has no accounts of its own. Credentials are sent only in the login message and never stored.

### "Resume as …" — what is stored

If the server issues a session cookie, the app stores it in `localStorage` under a per-{server, username} key. This is what allows you to connect again without entering your credentials, until the session token expires or is revoked.

Logging out sends `{msg:"forget_login_cookie", cookie}` to the server and removes the local entry, invalidating the token on both ends.

## How it was built

Most of the implementation was written with Claude Code, under my direction and review. All design and product decisions, testing, and QA were mine.

The source is available at <https://github.com/pocketzot/pocketzot>, licensed under [AGPL-3.0-or-later](LICENSE). See [ATTRIBUTION.md](ATTRIBUTION.md) for its relationship to DCSS.

## Feedback

Please send any comments, questions, or bug reports to <pocketzot@proton.me>. If you're enjoying the app, I'd love to hear from you.

## Support

If you like the app and want to support its development, donations are sincerely appreciated. Please see the [Support page](/support).
