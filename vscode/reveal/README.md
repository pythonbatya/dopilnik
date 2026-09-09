# reveal

A single title-bar button on the Explorer file tree: reveals the active editor
file — expands the folders along the path and scrolls to it.

Made to pair with `explorer.autoReveal: false` (set in the user settings): the
tree never moves on its own while you jump around the code (`.venv`, libraries,
anything); the button is the only thing that syncs it, on demand.

The command opens the Explorer sidebar first (`workbench.view.explorer`), then
runs core's `workbench.files.action.showActiveFileInExplorer` — so it works
from a keybinding even with the sidebar hidden or on another view. The wrapper
exists because a title-bar button needs a contributed command with an icon, and
core commands can't get one. No keybinding is contributed — the user's
keybindings.json binds `reveal.activeFile` to `cmd+shift+1`.
