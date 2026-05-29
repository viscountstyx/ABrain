# ABrain — Claude Code Instructions

## Release process (REQUIRED after every set of changes)

After making any code changes in this repo, you MUST complete all three steps below before reporting the work as done. Do not skip any step even for small fixes.

### 1. Update CHANGELOG.md

Add a new `## [x.y.z] - YYYY-MM-DD` section at the top of the existing entries (below the header block). Use today's date. Group entries under `### Added`, `### Changed`, or `### Fixed` as appropriate. Describe changes from the user's perspective, not implementation details.

### 2. Increment VERSION

Edit the `VERSION` file (single line, plain semver — no `v` prefix):
- **Patch** (`x.y.Z`): bug fixes, visual tweaks, dependency bumps
- **Minor** (`x.Y.0`): new user-visible features, non-breaking additions
- **Major** (`X.0.0`): breaking changes, major architectural rewrites

### 3. Tell the user to commit, tag, and push

After updating the changelog and version, output the exact git commands for the user to run, using the new version number:

```
git add -A
git commit -m "x.y.z — <one-line summary>"
git tag vx.y.z
git push origin main --tags
```

The user handles all git operations — do not run git add, commit, push, or tag yourself.
