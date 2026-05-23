<!--
Maintainer note: this file is the source of truth for the hosted
"What's new" page, public/changelog.html. That page is hand-written
with no generator and must be kept in sync with these entries — only date
formatting and HTML chrome differ. Drift is a bug.
-->

# What's new

Notable changes to PocketZot, newest first.

## 2026-05-23

- The Gods list under `?/` no longer renders each entry with a duplicated
  hotkey letter.
- Allies and neutral monsters no longer show threat highlight in the
  monster list.
- Use correct d-pad mode in the Ctrl-F result preview.

## 2026-05-22

- Tapping a shop item to view its description no longer swaps the shop's
  bottom control bar for the d-pad.
- Improve shop shift-tapping behavior.
- The HUD now displays an offhand weapon on its own row when dual-wielding.
- Guest spectate remembers the last server you picked.
- Polished the lobby and spectator header styling.

## 2026-05-21

- Improved search (Ctrl-F) handling.
- Setting an exclusion zone with radius (R#) in X mode now pops up the
  on-screen numpad to pick the radius value.
- Shift-tapping a shop row to add an item to your shopping list no longer
  highlights an unrelated row.
- X mode now zooms out in tile mode, matching existing ASCII mode behavior.
- In tile mode, a monster re-entering FoV at a memorized location no longer
  renders as a bare floor tile in the monster list.

## 2026-05-20

- Fixed a brief flicker when opening the message log (Ctrl-P) and other long
  in-game popups.
- Fixed a jump-back when scrolling those popups to the bottom on phone-width
  screens.
- In tile mode, the highlight marking cells you can Rampage to now shows.
- In tile mode, mangroves rooted in water now show the water through their
  bases.

## 2026-05-19

- Fixed a black screen that could appear when resuming a game on experimental
  or trunk servers after the server had been updated.
- In describe menus, very long monster descriptions now stay a single tappable
  entry instead of splitting into separate rows.
- Menu highlight follows the d-pad immediately on up/down, instead of after a server
  round-trip.
- D-pad diagonals page through long menus and jump to top/bottom.
- Fixed a visible jerk-back after paging on phone-width menus with tall description
  rows.

## 2026-05-18

- Initial public release. PocketZot is an unofficial, mobile-first WebTiles
  client for Dungeon Crawl Stone Soup: the full standard ASCII map on a phone
  in portrait mode, on-screen touch controls, multi-account login, spectating
  with an expanded map view, and installable as a Progressive Web App.
