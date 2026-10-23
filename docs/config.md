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
  self               = false
  collaborators      = true
  trusted-authors    = howlingmime,Joebok
  merge              = true
  merge-method       = (repo default)
```

Defaults are stored per host CLI (the one you run `/do:config` in) under a `defaults` key, alongside settings like `autoUpdate`. `/do:config` never mirrors defaults into other installed environments.

## PR/MR approval policy

`/do:review` approves a completed review with zero unresolved CRITICAL findings
when the authenticated reviewer is not the author and the head still matches
the reviewed commit. This is enabled by default, independently of `--merge`.
Teams that reserve approval for humans can save:

```
/do:config --no-approve
/do:config --project --no-approve
```

These store `defaults.approve=false` globally or for one project. The normal
precedence applies: explicit `--approve`/`--no-approve` → project → global →
built-in `true`. `--unset approve` removes the chosen scope's preference.
`--draft` always publishes nothing, and local branch reviews never approve.
An approval does not bypass protected-branch rules, other required approvers,
or CI. Trusted project policy remains binding.

## Dependency policy allowlist

Keep dependency families out of removal audits in every mode, including `--heavy`
and `--extreme`:

```
/do:config --depfree-allow '@aws-sdk/*,pg'
/do:config --project --depfree-allow 'prefix-*'
```

These save `defaults["depfree-allow"]` as an array in the host CLI's global config
and the repo-root `.slashdo.json`, respectively. You can also edit the JSON:

```json
{ "defaults": { "depfree-allow": ["@aws-sdk/*", "pg"] } }
```

Unlike scalar defaults, the global and project lists are **unioned**. The example
commands keep `@aws-sdk/*`, `pg`, and `prefix-*`; a project list of `[]` cannot drop
the global entries. Setting the flag replaces only the chosen scope's list.
`/do:config --unset depfree-allow` clears global policy; add `--project` to clear
only the project list. Reset also affects only the chosen scope.

Matching is case-sensitive against the whole package name. `*` matches zero or
more characters, including `/`; everything else is literal. Thus `pg` matches
only `pg`, `@aws-sdk/*` matches `@aws-sdk/client-s3`, and `prefix-*` matches
`prefix-utils`. Only string entries are supported. Invalid policy config stops
the audit rather than silently losing an allowance.

`/do:depfree` keeps matches with reason **policy allowlist** before usage analysis
and reports each package and matching pattern in its summary and, when remediation
runs, under **Kept — Policy allowlist** in `docs/DEPS.md`. Transitive accounting
and whole-tree vulnerability reporting still include these packages. Policy is
reloaded every run: deleting a recorded decision does not bypass current policy,
and removing an allowance causes normal classification on the next run.
