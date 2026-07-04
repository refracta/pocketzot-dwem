import type { Avatar } from '../avatars'
import { cachedFingerprint, resolvePlayerLoader } from '../game/tiles/atlas-dedup'
import type { TileLoader } from '../game/tiles/tile-loader'
import { renderTiles, dollTileSpec } from '../game/tiles/tile-view'

// Paint saved-character doll recipes (../avatars) into `container` as DOM
// tile-stacks — the same CSS-background tile path the in-game monster panel uses
// (no canvas, so no atlas CORS/taint problem). Shared by the login strip and the
// crypt grid. Each doll's atlas resolves through resolvePlayerLoader
// (../game/tiles/atlas-dedup): recipes whose versions share a player-tileinfo
// fingerprint render off ONE downloaded atlas instead of one per version dir —
// trunk rebuilds mint a new version hash for byte-identical atlases, so without
// this a crypt of dcss-git characters re-downloads the same ~1.2 MB PNG per
// build. A doll is appended only once a compatible atlas resolves, so a pruned
// or unreachable version is skipped outright rather than appended as a blank
// box. Append order follows the list order.
export async function paintAvatars(
  container: HTMLElement,
  avatars: Avatar[],
  scale: number,
  cls: string,
): Promise<void> {
  const entries = avatars
    .map((a) => ({ spec: dollTileSpec({ doll: a.doll, mcache: a.mcache }), httpBase: a.httpBase, version: a.version }))
    .filter((e) => e.spec.length > 0)
  // Append each doll the moment ITS atlas resolves, so one slow or unreachable
  // gamedata host can't hold up the dolls behind it (loads run concurrently;
  // the loader registry dedups per version and atlas-dedup per fingerprint).
  // A failed resolve is skipped outright — no blank box — and each doll is
  // inserted at its stored index, so the row stays in list order regardless of
  // which atlas wins the race.
  const placed: HTMLElement[] = []
  const place = (i: number, loader: TileLoader): void => {
    const el = renderTiles(loader, entries[i].spec, scale)
    el.classList.add(cls)
    // Insert before the nearest already-placed later doll to preserve list order.
    let before: HTMLElement | null = null
    for (let j = i + 1; j < entries.length; j++) {
      if (placed[j]) { before = placed[j]; break }
    }
    container.insertBefore(el, before)
    placed[i] = el
  }
  const resolved = await Promise.all(entries.map(async (e, i) => {
    const loader = await resolvePlayerLoader(e.httpBase, e.version)
    if (loader) place(i, loader)
    return loader
  }))
  // Second chance for dolls whose version dir is dead: group claims are
  // first-resolver-wins, so a dead-but-newest entry can claim its fingerprint
  // group, fail on its own atlas, and give up before a live same-fingerprint
  // sibling re-claims (seen live: a pruned trunk build alongside a later one).
  // Now that every first attempt has settled, retry the failures whose
  // fingerprint is cached — the only rescuable ones; without a fingerprint
  // there is no group to match, and the entry's own atlas already failed.
  await Promise.all(resolved.map(async (r, i) => {
    if (r) return
    const e = entries[i]
    if (cachedFingerprint(e.httpBase, e.version) == null) return
    const loader = await resolvePlayerLoader(e.httpBase, e.version)
    if (loader) place(i, loader)
  }))
}
