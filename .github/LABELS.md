# Issue taxonomy

This page is for maintainers who triage issues. Scalius uses GitHub's native `Bug`, `Feature`, and `Task` issue types. The issue forms set the type (`Bug` or `Feature`) and the label `status: needs-triage`. Labels add routing metadata and must not repeat the issue type.

## Status

Every open issue has exactly one status label:

- `status: needs-triage`: reported, not yet verified or prioritized.
- `status: needs-info`: blocked on a reproduction, a product decision, or missing evidence.
- `status: ready`: verified, scoped, and ready to implement.

Remove the old status label when the status changes. Use GitHub dependencies for blocked work, not another label.

## Priority

Set one priority only after you understand the impact and likelihood:

- `priority: p0`: active security incident, data loss or corruption, broad checkout outage, or a similar production failure that needs an immediate response.
- `priority: p1`: a core commerce workflow is blocked, a material integrity or security risk, or severe impact with no reasonable workaround.
- `priority: p2`: meaningful user impact with a safe workaround or a limited scope.
- `priority: p3`: low-impact improvement, polish, or an uncommon edge case.

Priority does not measure how easy, interesting, or old an issue is. Leave `needs-info` and `needs-triage` issues unprioritized until the missing facts arrive.

## Product area

Set the fewest `area: *` labels that route the issue to its owning commerce domain. Prefer one. Use two only when ownership is shared.

`area: auth`, `area: catalog`, `area: checkout`, `area: content`, `area: customers`, `area: inventory`, `area: media`, `area: orders`, `area: payments`, `area: platform`, `area: promotions`, `area: settings`, `area: setup`.

Code package names and UI surfaces are evidence, not ownership labels. Do not add `bug` or `enhancement`: the issue type already carries that.

## Triage rules

1. Confirm that the report has one independently deliverable problem and no sensitive data.
2. Search for duplicates. Link the canonical issue before you close the duplicate.
3. Set the issue type and the product area.
4. Reproduce the behavior, or record the exact missing information.
5. Decide whether the behavior breaks a business invariant, an accessibility requirement, a documented contract, or a well-supported user expectation, rather than one person's taste.
6. Set `status: ready` and a priority only after that decision is supported.
7. Link the implementation pull request with a closing keyword. Include focused and live verification that match its risk.

---

## Pull-request labels (automatic)

Pull requests are labeled automatically by `.github/workflows/label.yml` using
`.github/labeler.yml`. PR labels describe the *change* and its *technical
ownership* — they are separate from issue triage labels (`status:*`,
`priority:*`) which are applied manually to issues only and are never set on
pull requests.

### Change classification (`type:`)

| Label | Meaning |
|-------|---------|
| `type: bug` | Bug fix |
| `type: feature` | New functionality |
| `type: enhancement` | Improvement to existing behavior |
| `type: refactor` | Internal restructuring, no behavior change |
| `type: maintenance` | Repo upkeep, non-feature work |
| `type: docs` | Documentation only |
| `type: test` | Test changes only |
| `type: performance` | Performance improvement |
| `type: security` | Security fix |
| `type: breaking` | Breaking change |
| `type: dependencies` | Dependency update |

Triggered by branch prefixes (`feature/`, `fix/`, `chore/`, `docs/`, `test/`,
`perf/`, `security/`, `break/`, `deps/`, …) and by changed-file globs
(`docs/**`, `*.test.*`, `__tests__/**`, …).

### Domain & application ownership (`area:`)

Reuses all issue-triage `area:*` labels plus technical surfaces:

- Commerce domains (from `.github/LABELS.md`): `area: auth`, `area: catalog`,
  `area: checkout`, `area: content`, `area: customers`, `area: inventory`,
  `area: media`, `area: orders`, `area: payments`, `area: platform`,
  `area: promotions`, `area: settings`, `area: setup`
- Technical surfaces (auto-applied via changed files): `area: api`,
  `area: storefront`, `area: dashboard`, `area: database`, `area: plugins`,
  `area: integrations`, `area: core`, `area: cli`

### Infrastructure & platform (`infra:`)

| Label | Meaning |
|-------|---------|
| `infra: database` | Schema, migrations, database providers |
| `infra: cloudflare` | Wrangler / Workers configuration |
| `infra: deployment` | Deploy scripts, release process |
| `infra: ci` | GitHub Actions workflows |
| `infra: security` | Auth, secrets, encryption |
| `infra: build` | Build tooling, turbo, bundler config |

### Quality & maintenance (`quality:`, `chore:`)

| Label | Meaning |
|-------|---------|
| `quality: ci` | CI workflow changes |
| `quality: test` | Test infrastructure |
| `quality: docs` | Documentation improvements |
| `quality: code-quality` | Lint, typecheck, formatting |
| `quality: performance` | Performance budgets |
| `chore: dependencies` | Dependency updates (manual label) |

### Labeling rules

- `status:*` and `priority:*` are **never** auto-applied to PRs.
- A PR may carry multiple labels (e.g. `type: feature` + `area: payments` +
  `infra: database`).
- Existing `area:*` labels from issue triage may also be auto-applied to PRs
  when changed files fall under that domain.
- Labels must already exist on GitHub before the labeler can apply them — see
  the label audit below for the full list.
