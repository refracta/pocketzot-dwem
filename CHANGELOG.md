<!--
Maintainer note: this file is the source of truth for the hosted
"What's new" page, public/changelog.html. That page is hand-written
with no generator and must be kept in sync with these entries — only date
formatting and HTML chrome differ. Drift is a bug.
-->

# What's new

Notable changes to PocketZot, newest first.

## 2026-05-20

- Fixed a brief flicker when opening the message log (Ctrl-P) and other long
  in-game popups.
- Fixed a jump-back when scrolling those popups to the bottom on phone-width
  screens.

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
