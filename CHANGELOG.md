<!--
Maintainer note: this file is the source of truth for the hosted
"What's new" page, public/changelog.html. That page is hand-written
with no generator and must be kept in sync with these entries — only date
formatting and HTML chrome differ. Drift is a bug.
-->

# What's new

Notable changes to PocketZot, newest first.

## 2026-06-08

- The skills menu (`m`) now displays in a single column.
- Polished the appearance of in-game menus.

## 2026-06-04

- Prompts and messages no longer drop a literal `<` character.

## 2026-06-03

- A stray "–" no longer appears before entries in the "Items not yet
  recognised" menu.

## 2026-06-02

- The stable and trunk buttons now look distinct.
- Stable and trunk now appear as lobby buttons on CPO, where they were
  previously hidden inside "Show all versions".

## 2026-06-01

- Switching the map from ASCII to tiles now works during your own game on
  servers where it previously only worked while spectating.
- Fixed the map shifting downward shortly after loading a game or starting to
  spectate.
- The status bar no longer appears with placeholder values while creating a
  character.

## 2026-05-30

- Info (`?`) controls now include a `$` button (show gold / shopping list),
  in place of the save-and-exit button.
- Map display mode (ASCII or tiles) is now remembered across sessions.
- About and What's new pages are now viewable inside the app.

## 2026-05-29

- Long character titles no longer wrap to a second line in the HUD; the title
  is truncated with an ellipsis so piety stars stay visible.
- After a game ends, the lobby now shows a dialog with your character summary
  and a link to the morgue/dump file.
- The HUD now shows drained stats alongside their natural maximum
  (e.g. `12 (15)`), plus Contamination and Doom meters when either is active.
- Fixed occasional stray specks of color left next to monsters and items in
  tile mode.

## 2026-05-28

- Optimized map rendering to be ~40% faster during movement-heavy play.
- Rewrote message log handling to be an order of magnitude faster when many
  messages are arriving.
- The noise indicator is now a graphical colored bar instead of an ASCII meter.
- In tile mode, HP and MP bars now appear beneath the player tile.
- The HUD no longer briefly flashes empty bars and stat captions before the
  first game update arrives.

## 2026-05-27

- Acquirement now shows a dedicated ⎋ / `!` control row.
- y/N confirmation buttons now appear during any open menu, not
  just shops.
- The floating monster list can now be collapsed to a one-row summary.
  Collapsed state is remembered across sessions.

## 2026-05-26

- Skill-menu hotkey buttons no longer drop right-column skills whose
  partner skill has a training manual.
- Add inline buttons for more prompts (e.g. `* to list` on the cast-spell
  confirmation).

## 2026-05-24

- Lobby rows now include game version.

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
- Fixed a visible jump-back after paging on phone-width menus with tall description
  rows.

## 2026-05-18

- Initial public release. PocketZot is an unofficial, mobile-first WebTiles
  client for Dungeon Crawl Stone Soup: the full standard ASCII map on a phone
  in portrait mode, on-screen touch controls, multi-account login, spectating
  with an expanded map view, and installable as a Progressive Web App.
