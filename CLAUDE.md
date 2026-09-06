# Anchored Stretch — notes for Claude

Blockbench plugin that stretches cubes from the side you drag, keeping the opposite
face anchored, plus a Stretch mode for Vertex Snap and anchored resizing.
`README.md` explains what it does. `RELEASING.md` is the authority on cutting a
release. Read that before releasing anything; this file is orientation.

**This plugin is also bundled inside `EGT-EmbodyTools`**, which is live and released
separately. A behaviour fix here usually belongs there too. Check before assuming
this repo is the only home for a change.

## Shape of the repo

There is **no build step**. The plugin is one hand-written file that ships as-is.

| Path | What it is |
|---|---|
| `anchored_stretch.js` | The entire plugin. `const PLUGIN_VERSION` near the top is the only place the version lives; the plugin registration reads it rather than repeating the number. |
| `changelog.json` | Blockbench's changelog format. **The only place release notes are written.** |
| `CHANGELOG.md` | Generated. Never hand-edit it; run `npm run changelog`. |
| `anchored_stretch_icon.png` | Source for the icon inlined in the plugin as a data URL. |
| `test/run_tests.js` | One CommonJS suite, 68 assertions. It reads the plugin with `fs` and mocks the Blockbench internals it patches. |
| `scripts/` | `release.mjs`, `changelog.mjs`, `discord_notify.mjs`. |

## Releasing

```sh
npm run release -- patch --title "Short name" --fixed "What the user sees."
```

**Pushing the tag is the button.** That command tests, bumps, writes the changelog
entry, commits, tags and pushes. Everything after that is automatic.

Repo-only changes — CI, README, scripts, this file — get a plain commit. No version
bump, no tag, no changelog entry. The version belongs to the plugin, not the repo.

## What happens once the tag lands

`.github/workflows/release.yml`, on a GitHub runner:

1. Reruns the suite.
2. Refuses if the tag disagrees with `PLUGIN_VERSION`.
3. Publishes the GitHub release. Body is that version's `changelog.json` entry,
   with `anchored_stretch.js` and `changelog.json` attached.
4. Posts that same entry to Discord.
5. Ends. Nothing stays running.

## The Discord post

There is **no bot**. No hosted process, nothing invited to the server, nothing
listening. Step 4 above is a single HTTP POST to a Discord webhook, and then the
workflow exits. Discord labels webhook messages **APP**, which is not a bot account.

`scripts/discord_notify.mjs` reads the version's `changelog.json` entry and posts it
as an embed. Configuration is the `env:` block at the top of `release.yml`:

| Variable | Why |
|---|---|
| `PLUGIN_FILE` | Reads the version out of it; also builds the install link. |
| `PLUGIN_NAME` | The name the message posts under. |
| `PLUGIN_ICON_URL` | The avatar the message posts under. |
| `PLUGIN_COLOR` | Embed stripe colour, hex without the `#`. |
| `DISCORD_THREAD_ID` | The forum post it goes into. **`1545490313370542090` for this plugin.** |

The webhook URL is the repo/org secret `DISCORD_WEBHOOK_URL`. It is never in the
repo. All four plugin repos can read it.

Every plugin posts through **one** webhook on the `#addons` forum channel and lands
in its own thread via `?thread_id=`. Each post overrides `username` and
`avatar_url`, so it arrives as the plugin rather than as one shared identity.

Preview a post without sending anything:

```sh
PLUGIN_NAME="Anchored Stretch" PLUGIN_FILE=anchored_stretch.js \
  GITHUB_REPOSITORY=Embody-Games/EGT-AnchorStretch \
  node scripts/discord_notify.mjs 1.7.2 --dry-run
```

The step is `continue-on-error`. A Discord outage must never fail a good release.

## Traps

- **There is no `.git/egt-push-token` here**, unlike the other three repos. Until
  one is added, `npm run release` will commit and tag but cannot push. See
  `RELEASING.md`.
- **The suite is CommonJS.** Do not add `"type": "module"` to `package.json`; the
  `.mjs` extensions already make the scripts ESM.
- `test/run_tests.js` loads the plugin as `__dirname + '/../anchored_stretch.js'`.
  It lived at the repo root until recently, so that `../` is load-bearing.
- **There is no `icon.mjs` here.** The other repos regenerate their inlined icon
  with one, but theirs expects a `PLUGIN_ICON` const and a `TAG` line to insert
  after, and this plugin inlines the PNG as a plain `ICON` const. Updating the icon
  currently means replacing that data URL by hand.
- The version used to be a literal inside the plugin registration, which is why this
  repo had no tags for its first ten versions. `v1.7.2` was tagged retroactively.
- Users are given `https://raw.githubusercontent.com/Embody-Games/EGT-AnchorStretch/main/anchored_stretch.js`.
  Anything that reaches `main` reaches them immediately. There is no staging step.

## Changelog voice

Say what the user sees, not what the code did. Categories, in order: Added, Changed,
Fixed, Removed, Safeguards.

The entries for 1.0.0 through 1.7.2 were converted from a hand-written
`CHANGELOG.md` that had no categories. The bullet text is original; the version
titles were written during that conversion and are the weakest part of the file.
