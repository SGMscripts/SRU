# Contributing

Thanks for helping keep SRU useful for REAPER users. Small, focused changes are easiest to review and safest to ship through ReaPack.

## Script Standards

- Put ReaPack metadata at the top of installable scripts.
- Include `@description` or `@title`, `@version`, `@author`, and `@about` where practical.
- Bump `@version` when behavior changes.
- Keep scripts self-contained unless a helper file is intentionally part of the package.
- Avoid committing generated files, large media, model weights, local REAPER config, or machine-specific paths.

## Validation

Before opening a pull request or pushing a release change:

```sh
find . -name '*.lua' -print0 | xargs -0 -n1 luac -p
reapack-index --check
```

`reapack-index` is installed with Ruby:

```sh
gem install reapack-index
```

## Release Notes

When changing an installable script, update both:

- The script's `@version` and `@changelog` metadata.
- `CHANGELOG.md` for repository-level context.

The GitHub Actions deploy workflow updates `index.xml` on `master`.

