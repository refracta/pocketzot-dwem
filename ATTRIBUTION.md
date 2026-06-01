# Attribution and licensing

PocketZot is an independent, unofficial mobile client for Dungeon Crawl
Stone Soup (DCSS) WebTiles servers. It is not affiliated with or endorsed
by the DCSS development team.

Copyright (C) 2026 the PocketZot contributors.
Licensed under the GNU Affero General Public License, version 3 or (at your
option) any later version (AGPL-3.0-or-later). See `LICENSE` for the full text.

## Relationship to DCSS

PocketZot connects to standard DCSS WebTiles servers and speaks the same
WebSocket protocol as the official client. It contains none of the DCSS game
engine; gameplay runs entirely on the server.

DCSS is Copyright 1997–2025 Linley Henzell, the dev team, and contributors,
licensed under the GNU General Public License, version 2 or (at your option)
any later version. PocketZot's AGPL-3.0-or-later license is compatible with
this through that "or later" option.

## Interoperability constants

The items below carry numeric values that must match the DCSS server exactly,
or the client mis-renders. They are fixed by the DCSS wire protocol and
reproduced from the DCSS WebTiles client purely as a protocol-interoperability
requirement; the colour palette is the standard Tango-derived terminal set:

| File | Derived from (DCSS WebTiles) | What |
|------|------------------------------|------|
| `src/game/input/keyboard.ts` | `webserver/static/scripts/key_conversion.js` | Special keycodes; browser-key → keycode tables |
| `src/game/map/colors.ts` | `webserver/game_data/static/view_data.js` | Flash-colour RGBA palette |
| `src/game/map/cell-flags.ts` | `webserver/game_data/static/enums.js` | Tile fg/bg flag bit masks |
| `src/game/dcss-colors.ts` | DCSS WebTiles colour palette | Named colour → hex map |

The 16-entry base palette in `src/game/map/colors.ts` is the standard
IBM CGA/VGA color set and is not specific to DCSS.

## Derived from the DCSS WebTiles client

The tile-rendering pipeline ports portions of the DCSS WebTiles renderer 
to TypeScript, following its structure and draw order:

| File | Ported from (DCSS WebTiles) | What |
|------|------------------------------|------|
| `src/game/map/tile-map-view.ts` | `cell_renderer.js` — `do_render_cell`, `draw_background`, `draw_foreground` | Tile cell composition and draw order |
| `src/game/tiles/tile-view.ts` | `cell_renderer.js` — `draw_dolls` | Player-doll layer composition |
| `src/game/hud/monster-style.ts` | `cell_renderer.js` — `draw_background` (attitude-halo slice), `draw_foreground` (status-icon order + `status_shift`) | Monster-panel background tile; shared status-overlay decision |
| `src/game/hud/monster-style.ts` | `monster_list.js` — `monster_sort`, `is_excluded` | Monster ordering and display-exclusion predicate |
| `src/game/map/icon-sizes.ts` | `rltiles/icon-sizes.txt` (input to `util/status-icon-sizes-gen.py` → `status_icon_size`) | Per-status-icon width table for `cell.icons` stacking |
| `src/game/map/colors.ts` | `cell_renderer.js` — `split_term_colour`, `term_colour_apply_attributes` | Console colour-attribute decode |
| `src/game/hud/monster-list.ts` | `monster_list.js` — `group_monsters` / `can_combine` | Consecutive same-rank monster grouping |

This DCSS code is "version 2 or, at your option, any later version";
it is taken forward to GPLv3 and combined into this AGPL-3.0-or-later
work as AGPLv3 section 13 permits.

## Independently implemented

The remaining code — the WebSocket layer, the map and monster state
model, the ASCII map renderer, markup-to-HTML conversion, the HUD,
touch input, and UI — is an independent implementation written against
the observed wire protocol.
