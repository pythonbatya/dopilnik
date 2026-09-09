# py-usages

Collects the usages of the symbol under the cursor into a places editor —
the "study all usages properly" mode. The peek (cmd+click / shift+F12) is
untouched; this is the parallel deep-dive path.

## Usage

`cmd+b` (bound to `pyUsages.cmdB` in the user's keybindings.json; IDEA-style):
on a usage it goes to the definition; standing on the
definition itself it collects usages into places; multiple definitions land in
places as a `definitions:` group. Non-python files fall through to the default
go-to-definition.

Plain collection: command palette → "py-usages: collect usages of symbol at
cursor", or the editor context-menu item. Mouse gestures like cmd+click cannot
be rebound to extension commands (VSCode limitation). The group lands in Places
with fixed kind roots:

- `subclasses` — references on base-class positions (`class X(Symbol)`)
- `calls` — instantiation/call sites (next char is `(`)
- `imports` — import lines, incl. parenthesized multiline
- `writes` — assignment targets (`x = …`, `x += …`, `a, b = …`, `for x in …`,
  `… as x`)
- `reads` — everything else; the root is titled `reads` (instead of `other`)
  when the symbol has at least one write, so variables split into reads/writes

Classification is line-level python heuristics (`usageClassify.ts`, tested);
for other languages everything falls into one flat list. The definition site is
filtered out. 100 per kind root, remainder counted into the truncation footer.

Requires the `places` extension installed.
