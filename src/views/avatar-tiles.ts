import type { Avatar } from '../avatars'
import { TEX, getTileLoader } from '../game/tiles/tile-loader'
import { renderTiles, dollTileSpec } from '../game/tiles/tile-view'

// Paint saved-character doll recipes (../avatars) into `container` as DOM
// tile-stacks — the same CSS-background tile path the in-game monster panel uses
// (no canvas, so no atlas CORS/taint problem). Shared by the login strip and the
// crypt grid. Each doll's gamedata atlas loads on demand (loaders memoize per
// version, so same-version dolls share one fetch); a doll is appended only once
// its PLAYER atlas resolves, so a pruned or unreachable version is skipped outright
// rather than appended as a blank box. Append order follows the list order.
export async function paintAvatars(
  container: HTMLElement,
  avatars: Avatar[],
  scale: number,
  cls: string,
): Promise<void> {
  const entries = avatars
    .map((a) => ({ spec: dollTileSpec({ doll: a.doll, mcache: a.mcache }), loader: getTileLoader(a.httpBase, a.version) }))
    .filter((e) => e.spec.length > 0)
  // Append each doll the moment ITS own atlas resolves, so one slow or unreachable
  // gamedata host can't hold up the dolls behind it (loads run concurrently and are
  // deduped per version by the loader registry). A failed load is skipped outright
  // — no blank box — and each doll is inserted at its stored index, so the row
  // stays in list order regardless of which atlas wins the race.
  const placed: HTMLElement[] = []
  await Promise.all(entries.map(async (e, i) => {
    if (!(await e.loader.ensureLoaded(TEX.PLAYER).then(() => true, () => false))) return
    const el = renderTiles(e.loader, e.spec, scale)
    el.classList.add(cls)
    // Insert before the nearest already-placed later doll to preserve list order.
    let before: HTMLElement | null = null
    for (let j = i + 1; j < entries.length; j++) {
      if (placed[j]) { before = placed[j]; break }
    }
    container.insertBefore(el, before)
    placed[i] = el
  }))
}
