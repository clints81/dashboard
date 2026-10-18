# Dashboard: working rules

- Read DASHBOARD-REFERENCE.md before changing anything.
- Every change updates DASHBOARD-REFERENCE.md in the same commit:
  what changed, and why if a decision was involved.
- Planning happens in a separate chat and arrives here as a brief.
  When a brief contains a decision or a reason, record it in the
  reference doc, not just in the code.
- Briefs are saved in briefs/, which is gitignored: this repo is public
  and briefs can hold private context. Never commit a brief, and never
  copy private details from one into a committed file. Once a brief is
  built, the reference doc is the record; the brief is disposable.
- Decided-but-unbuilt work lives in the Backlog section of the
  reference doc. Add to it when a brief defers something; remove
  items when they ship.
- Run node --check on every JS file. Never commit without asking; Clint reviews
  and approves changes. Then commit.
