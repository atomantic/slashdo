# `/do:config` internals

Expands on the [Configuration](../README.md#configuration-doconfig) section of the README.

## Masking a global default per repo

Saving `--project --review-with=none` stores an explicit "no external reviewer" tombstone that masks an inherited global reviewer list for that one repo — something `--unset` can't do (unsetting the project key just falls back to the global value). The explicit negative forms (`--no-merge`, `--no-self`, `--no-collaborators`, `--no-reviewer-applies`, `--review-stop-all`) exist for the same reason: to let a project default override an inherited global `true` back off. A saved `--trusted-authors none` is the same kind of tombstone for the extra-authors list.

## A typical split

Personal preferences go global, repo policy goes in the repo (and `.slashdo.json` can be committed so the whole team shares it):

```
/do:config --review-with=codex --merge          # your defaults, everywhere
/do:config --project --collaborators --trusted-authors howlingmime,Joebok
```

`/do:config` shows the merged result, e.g.:

```
Effective (project overrides global):
  review-with        = codex
  review-models      = (none — each reviewer's built-in default)
  review-iterations  = 1 (built-in default)
  review-mode        = series (built-in default)
  issues             = true
  self               = false
  collaborators      = true
  trusted-authors    = howlingmime,Joebok
  merge              = true
  merge-method       = (repo default)
```

Defaults are stored per host CLI (the one you run `/do:config` in) under a `defaults` key, alongside settings like `autoUpdate`. `/do:config` never mirrors defaults into other installed environments.
