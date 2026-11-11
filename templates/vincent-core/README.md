# vincent-core

The certified skill hub for the AI-Native ecosystem. One directory per skill,
one `SKILL.md` per directory. Every skill here is validated in CI and synced
into the AI-Native DAM Skill Registry, where it is governed (rights,
provenance, approval, audit) before any agent may apply it.

> This repository holds skill **source**. Governance metadata lives in the DAM;
> each registered version is pinned to a commit hash of this repo.

## Layout

```text
skills/
  <domain>/<skill-name>/SKILL.md     # e.g. skills/short_drama/script-split/SKILL.md
registry.yml                         # generated index (CI keeps it fresh)
scripts/validate.mjs                 # local validation: node scripts/validate.mjs
```

## SKILL.md frontmatter (required)

```yaml
---
name: script-split            # lowercase slug, unique within the domain
description: ...              # must state trigger conditions ("Use when ...")
version: 1.2.0                # semver; bump = new registry entry
domain: short_drama           # ecommerce | short_drama | retail | content | generic
risk: low                     # low | medium | high
tags: [drama, script]         # optional
---
```

## Contribute

1. Add `skills/<domain>/<name>/SKILL.md` following the spec above.
2. Run `node scripts/validate.mjs` locally; CI enforces the same checks.
3. Open a PR. On merge, the sync workflow registers the new version into the
   DAM (`pending_approval`); a governance approver flips it to `approved`.

See `docs/skill-format.md` in **ai-native-dam** for the full industrial spec.
