# py-hierarchy

CodeLens + gutter marker for python class/method inheritance navigation,
on top of pyright (works with pyright-multi).

- Lines of classes/methods that have overrides (or a parent to jump to) get a
  ⇅ icon in the glyph margin — information only, VSCode gives extensions no
  gutter clicks.
- A CodeLens line appears above them, immediately clickable:
  - `⇩ N overrides` — jump when single, list in the bottom panel when many;
  - `⇧ ParentName` — jump to the base class / overridden method
    (`⇧ super().method` on methods; one link per base class).
- Children/overrides come from the references provider filtered to declaration
  positions (pyright's implementation provider returns nothing in practice);
  the parent is resolved from the `class X(Base):` declaration via type
  definition. Empty LSP answers (cold server) are cached for 2s only.
- Cross-module only works through the venv that sees both modules (e.g. frontik
  opened from k-meta's site-packages).

## Install / develop

`npm install`, `npm run compile`, `npm run package`, install the vsix.
