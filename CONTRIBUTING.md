# Contributing

## Before you push

```shell
cd src/hooks && npm test        # 185 tests, no dependencies to install
claude plugin validate . --strict
```

`--strict` treats warnings as errors, which is what the marketplace review pipeline does.

Never test a hook against your real `~/.claude`. The scripts write a flag file, and the badge
installer writes `settings.json`:

```shell
CLAUDE_CONFIG_DIR=$(mktemp -d) CLAUDE_PLUGIN_ROOT=$PWD node src/hooks/critica-activate.js
```

## Branches and pull requests

`main` is protected. Direct pushes are rejected — work on a branch and open a pull request.

Merge with **squash** or **rebase**. Merge commits are blocked by the linear-history rule.

Branch naming follows the commit type: `fix/...`, `feat/...`, `docs/...`, `chore/...`, `test/...`.

Commit subjects are in English, Conventional Commits style, imperative mood. Explain *why* in
the body — the diff already shows what.

## Signed commits

Commits must be signed. The configuration lives in `.git/config`, which is **not versioned**, so
a fresh clone starts unsigned and the first push fails. Set it up once per clone:

```shell
git config gpg.format ssh
git config user.signingkey ~/.ssh/<your-key>.pub
git config commit.gpgsign true
git config tag.gpgsign true
```

Keep it local, not `--global`, unless you want every repository on your machine signed with this
key.

The public key has to be registered on GitHub **twice**: once as an Authentication Key and again
as a **Signing Key**. They are separate key types — a commit signed with a key that is only
registered for authentication shows up as *Unverified*.

To verify locally rather than waiting for GitHub:

```shell
echo "$(git config user.email) $(cat ~/.ssh/<your-key>.pub)" >> ~/.config/git/allowed_signers
git config gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
git log --show-signature -1
```

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json` — it is the only place the version lives
2. Add the matching `## [x.y.z]` section to `CHANGELOG.md`, with a link to the tag at the bottom
3. Open the pull request and merge it
4. **Then** tag, on `main`, after pulling: `git tag -a critique--vX.Y.Z -m "..."`
5. Push the tag: `git push origin critique--vX.Y.Z`

Step 4 comes after the merge on purpose. Squash merging discards the branch commit and creates a
new one on `main`, so a tag made on the branch beforehand ends up pointing at a commit that is
not in `main`'s history. Check with:

```shell
git merge-base --is-ancestor "$(git rev-list -n1 critique--vX.Y.Z)" main && echo ok
```

`src/hooks/__tests__/repo.test.js` fails the suite if step 2 is skipped, or if a CHANGELOG link
points at a tag that does not exist.

The community marketplace pins a commit SHA and bumps it automatically as commits land on `main`,
syncing nightly. Whatever is on `main` is what users get — there is no separate publish step.

## Things this plugin must not do

`repo.test.js` enforces these. They are not style preferences; each one is a bug that shipped.

- **No writing to `~/.claude/settings.json` without the user asking.** The single exception is
  `cleanupLegacyHooks()`, which only removes this plugin's own stale entries and is scheduled for
  removal in 1.6.0. The badge is opt-in via `/critique:badge`.
- **No registering hooks anywhere but `hooks/hooks.json`.** Registering in `settings.json` too
  made every hook fire twice.
- **Never overwrite a `settings.json` that fails to parse.** Treat "does not exist" and "cannot
  be understood" as different states.
