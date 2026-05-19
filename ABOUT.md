# About PocketZot

PocketZot is an unofficial [DCSS](https://crawl.develz.org) [WebTiles](https://crawl.develz.org/wordpress/howto) client designed for mobile phones in portrait mode. 

## Features

- Custom, ASCII-first design to maximize compactness and readability.
The default DCSS map viewport is roughly square in ASCII. PocketZot 
fits the full standard console map dimensions onto a standard iPhone 
in portrait mode, with a font still large enough to read. Tiles are 
supported as well.
- Login with multiple WebTiles server accounts and easily switch between them
- Many menus and descriptions contain inline tap regions for quick touch interaction
- Spectator mode with expanded map view
- Floating monster list — tap for full view
- Map double-tap toggles zoom
- Map two-finger long press toggles tiles
- Installs as a PWA — add to home screen for the best experience

## Controls

The controls are organized into three tabs: **@**, **>**, and **?**. While the sorting is not 100% perfect, the mental model is as follows:
  - **@** *"micro"* — moment-to-moment actions, including during battle
  - **>** *"macro"* — actions often taken outside of battle, or after clearing a floor
  - **?** *"info"* — commands to get information about your character or game

Obligatory virtual keyboard also available.

## Security

### Accounts

"Account" refers to a WebTiles account between you and your DCSS server of choice.
PocketZot does not have any sort of accounts of its own, and never stores your credentials.

### Password handling

PocketZot only connects over `wss://` (an encrypted WebSocket) so your
credentials are protected in transit. Every server in the list requires it, with
no plaintext fallback. Your password is held only as an in-memory JavaScript
variable, just long enough to send `{msg:"login", username, password}`. It's 
never written to disk or stored anywhere.

### "Resume as …" — what is stored

If the server issues a session cookie, the app stores it in `localStorage`
under a per-{server, username} key. This is what allows you to connect again
without entering your credentials, until the session token expires or is revoked.

Logging out sends `{msg:"forget_login_cookie", cookie}` to the server and 
removes the local entry, invalidating the token on both ends.

## How it was built

Most of the implementation was written with Claude Code, under my direction and review. All product decisions, design, testing, and QA were mine. 

The source is available at <https://github.com/pocketzot/pocketzot>, licensed under [AGPL-3.0-or-later](LICENSE); see [ATTRIBUTION.md](ATTRIBUTION.md) for its relationship to DCSS.

## Feedback

Please send any comments, questions, or bug reports to <pocketzot@proton.me>.

## Support

If you like the app and want to support its development, donations are greatly appreciated. Please see the [Support page](/support).