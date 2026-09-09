// Chrome has three bookmark roots, Firefox four. Both are projected onto one canonical
// set so a file written by either browser restores sensibly into the other.
//
//   file folder          Chrome root        Firefox root
//   Bookmarks bar        Bookmarks bar      toolbar
//   Bookmarks menu       Other bookmarks    menu
//   Other bookmarks      Other bookmarks    unfiled
//   Mobile bookmarks     Mobile bookmarks   mobile
//
// The menu -> other fold is lossy in the Firefox-to-Chrome direction and cannot be undone.

const BY_ID = {
  1: 'toolbar',
  2: 'other',
  3: 'mobile',
  toolbar_____: 'toolbar',
  menu________: 'menu',
  unfiled_____: 'other',
  mobile______: 'mobile',
}

const BY_TITLE = {
  'bookmarks bar': 'toolbar',
  'bookmarks toolbar': 'toolbar',
  'bookmarks menu': 'menu',
  'other bookmarks': 'other',
  'mobile bookmarks': 'mobile',
}

const TITLES = {
  toolbar: 'Bookmarks bar',
  menu: 'Bookmarks menu',
  other: 'Other bookmarks',
  mobile: 'Mobile bookmarks',
}

export function canonicalRoot(node) {
  return BY_ID[node.id] ?? BY_TITLE[String(node.title ?? '').toLowerCase()] ?? null
}

export function rootTitle(canonical) {
  return TITLES[canonical] ?? TITLES.other
}

export function resolveRootId(canonical, topLevelNodes) {
  const find = (name) => topLevelNodes.find((node) => canonicalRoot(node) === name)?.id

  // An unknown root, or Firefox's menu in a browser that has none, lands in Other bookmarks.
  return find(canonical) ?? find('other') ?? topLevelNodes[0]?.id
}
