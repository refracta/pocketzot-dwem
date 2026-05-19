# PocketZot

**Dungeon Crawl Stone Soup (DCSS) WebTiles in your pocket.**

**▶ [Play now: pocketzot.pages.dev](https://pocketzot.pages.dev)**

PocketZot is an unofficial, mobile-first [WebTiles](https://crawl.develz.org/wordpress/howto)
client for [DCSS](https://crawl.develz.org). It connects to standard DCSS WebTiles servers
and speaks the same WebSocket protocol as the official client, but replaces the rendering
and UI entirely with an ASCII-first map, a custom touch HUD, and on-screen
controls designed for a phone in portrait mode. It installs as a Progressive
Web App.

<!-- Screenshots are served from the live deployment; the image files are part
     of the hosted site, not this repository. -->
<p>
  <img src="https://pocketzot.pages.dev/shot-spriggan.png" alt="ASCII dungeon map with touch controls" height="420">
  <img src="https://pocketzot.pages.dev/shot-monsters.png" alt="Full-screen monster description" height="420">
  <img src="https://pocketzot.pages.dev/shot-shoals.png" alt="Tiles dungeon map, spectating player" height="420">
  <img src="https://pocketzot.pages.dev/shot-login.png" alt="PocketZot account picker" height="420">
</p>

## Features

- ASCII-first design that fits the full standard console map onto a phone in
  portrait mode, with a font still large enough to read. Graphical tiles are
  supported too.
- Log in with multiple WebTiles server accounts and switch between them.
- Inline tap regions in many menus and descriptions for quick touch play.
- Spectator mode with an expanded map view.
- Floating monster list — tap for the full view.
- Map double-tap toggles zoom; two-finger long-press toggles tiles.
- Installs as a PWA — add to the home screen for the best experience.

See [ABOUT.md](ABOUT.md) for the controls model and security details
(credential handling, session cookies).

## Tech

TypeScript + [Vite](https://vitejs.dev), no UI framework. The client
holds no game logic, and gameplay runs entirely on DCSS servers.

## License

[AGPL-3.0-or-later](LICENSE). Copyright © 2026 the PocketZot contributors.
PocketZot is an independent project, not affiliated with or endorsed by the
DCSS development team. See [ATTRIBUTION.md](ATTRIBUTION.md) for the
relationship to DCSS and third-party provenance.

## Feedback

Comments, questions, and bug reports: <pocketzot@proton.me>
