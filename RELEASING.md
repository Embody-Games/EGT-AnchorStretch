# Releasing

The version lives in exactly one place, `const PLUGIN_VERSION` in
`anchored_stretch.js`. The plugin registration reads it rather than repeating the
number. There is no build step, so cutting a release is the build.

## One command

```sh
npm run release -- <major|minor|patch> --title "Short release name" \
  --added "..." --fixed "..." --changed "..."
```

That runs the suite, bumps the version in the plugin and in `package.json`, inserts
the `changelog.json` entry, commits `vX.Y.Z: <title>`, tags `vX.Y.Z` and pushes.
Tests run before anything is written, so a failing suite leaves the working tree
untouched.

Flags: `--dry-run` to preview the commit and tag, `--no-push` to push by hand,
`--notes <file.json>` for long entries, and `--removed` / `--safeguards` alongside
the other category flags. All the category flags are repeatable.

Pushing the tag is what publishes. `.github/workflows/release.yml` reruns the suite,
refuses if the tag disagrees with `PLUGIN_VERSION`, publishes a GitHub release whose
body is that version's `changelog.json` entry with the plugin and `changelog.json`
attached, then posts that entry to the `#addons` forum thread in Discord. `CLAUDE.md`
covers the Discord half.

Bump by what changed: `patch` for a fix with no new behaviour, `minor` for new
behaviour or a new setting, `major` for a change that breaks how existing models or
settings behave. Repo-only changes such as CI, README or scripts get a plain commit:
no version, no tag, no changelog entry. The version belongs to the plugin, not to
the repo.

## Changelog voice

`changelog.json` is the only place release notes are written. Blockbench's Changelog
tab, `CHANGELOG.md`, the GitHub release page and the Discord post all render from it,
so they cannot drift. Regenerate `CHANGELOG.md` with `npm run changelog`; never edit
it directly.

Say what the user sees, not what the code did. "Resizing a cube that already has
stretch no longer moves the anchored face" beats "fixed offset maths in resize".
Categories, in order: Added, Changed, Fixed, Removed, Safeguards.

## Pushing from a Claude session

Claude reaches this folder through the Cowork device bridge: a shell with network
access but no stored git credential of its own.

**This repo has no `.git/egt-push-token` yet**, unlike `EGT-DeltaLayers`,
`EGT-UnLeakyLayers` and `EGT-EmbodyTools`. Until one exists, `npm run release` will
commit and tag but fail to push, and the release will not happen. To set it up,
create a fine-grained token at
github.com/settings/personal-access-tokens scoped to this repository alone with
Contents write, and put it there:

```sh
printf '%s' 'github_pat_...' > .git/egt-push-token
```

Anything under `.git` is outside version control, so it is never committed or
pushed. `npm run release` reads that file when present, pushes through it, then
fetches so the clone does not look unpushed afterwards. For a push outside the
release script:

```sh
TOKEN=$(tr -d '\r\n' < .git/egt-push-token)
git push --follow-tags "https://x-access-token:$TOKEN@github.com/Embody-Games/EGT-AnchorStretch.git" main
```

Never write that token into `.git/config`, into a tracked file, or anywhere that
leaves the machine. Note that `git push -u` **does** write the URL you pushed to
into `.git/config`, token and all, so avoid `-u` when pushing this way.

**On a different computer** the file will not exist, because `.git` is per clone.
Either put the token there from a password manager, or push with that machine's own
git credentials. The token reaches this repository and nothing else, so it can be
replaced at any time without breaking anything else.

**Two quirks of the bridge.** The mounted folder may deny `unlink`, in which case a
commit leaves `.git/index.lock` and `HEAD.lock` behind and those block git on the
Windows side. Clear them:

```sh
find .git \( -name "*.lock" -o -name "tmp_obj_*" \) -delete
```

And the Linux side of the bridge cannot see Windows' global git config, so
`user.name` and `user.email` are set in this repo's own config instead.

**`uploads.github.com` is not reachable** from this machine's network, so release
assets cannot be uploaded from here. That only matters if you are attaching assets
by hand; a real release does it on a GitHub runner, which can.
