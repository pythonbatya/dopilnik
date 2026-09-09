# status-path

Shows the active file path as breadcrumbs (`k-meta > .qqq > scratch_1.py`)
on the left side of the status bar — a replacement for the editor breadcrumbs
that lives where the eye already rests.

- workspace-relative segments joined with ` > `
- files outside the workspace: plain path, home shortened to `~`
- hidden for non-file editors (untitled, output, diff)
- not clickable (status bar API allows one command per item, not per segment)

Pair it with `"breadcrumbs.enabled": false` to drop the top bar.
