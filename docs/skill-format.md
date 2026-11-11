# Skill Format & Intake Spec

The industrial contract for every skill in the ecosystem — ours, our projects',
and our customers'. Git is the **source of truth** for skill source code; the
AI-Native DAM is the **governance plane** (rights, provenance, approval, audit);
agent runtimes are the **trigger plane**.

```text
Git (source) ──sync──► DAM Skill Registry (governance) ──MCP──► Agent runtimes (trigger)
```

---

## 1. SKILL.md Manifest

Every skill is a directory containing `SKILL.md` with YAML frontmatter.
`name` + `description` follow the cross-vendor Agent Skills convention
(Kimi / Claude / Codex); the remaining fields are DAM governance extensions.

| Field | Required | Rule |
|---|---|---|
| `name` | ✅ | lowercase slug `^[a-z0-9][a-z0-9-]*$`, unique within its domain |
| `description` | ✅ | ≥ 10 chars, **must state trigger conditions** ("Use when …") |
| `version` | — | semver, default `0.1.0`; a bump creates a new registry entry |
| `domain` | — | `ecommerce` · `short_drama` · `retail` · `content` · `generic` (default) |
| `risk` | — | `low` (default) · `medium` · `high`; informs the approval gate |
| `tags` | — | string array |
| `author` | — | free text |

The markdown body teaches the procedure: when to use it, steps, constraints,
expected output. Reference auxiliary files with paths relative to the skill
directory.

## 2. Naming & Collision Rules

- Registry id = `<domain>:<name>` (e.g. `short_drama:script-split`).
- The same `name` in different domains is allowed and isolated by namespace.
- A given `id@version` can be registered **once**. Re-registration is rejected
  (`skill_version_exists`); fixes require a version bump.

## 3. Intake Channels

| Channel | Who | Flow | Lands as |
|---|---|---|---|
| ① Core repo PR | Certified internal skills | PR → CI validate → merge → sync on merge | `pending_approval` |
| ② Project repo intake | Our project ecosystem | repo carries valid SKILL.md → periodic sync scan | `pending_approval` |
| ③ Customer submission | External / customer systems | MCP `register_skill` call (later: A2A) | `pending_approval` |

All three channels converge on the same governed registry. Nothing becomes
visible to agents until a governance approver flips status to `approved`.

## 4. Provenance Requirements

Every registration records:

- `source_repo` — normalized HTTPS URL of the origin repository
- `source_path` — path of the SKILL.md inside that repo
- `source_commit` — commit hash the version is pinned to

`skill-sync` derives these automatically from the scanned git checkout.
Versions not pinned to a commit cannot be audited and should not be approved.

## 5. Trigger Semantics

1. **Discovery** — agents call `search_skills` (low risk, ungated) filtered by
   domain; only `approved` skills appear by default.
2. **Invocation** — `apply_skill` (gated) records usage against provenance.
   Usage count feeds the distillation pipeline (`request_distillation` after N
   uses).
3. **Runtime loading** — runtimes may mirror approved skills into their local
   skill index; the trigger rules live in `description`, per the Agent Skills
   convention.
4. **Revocation** — setting status `revoked` removes the skill from discovery
   everywhere at the next sync.

## 6. Industrial Checklist

- [x] Schema validation in CI (template repo: `scripts/validate.mjs`)
- [x] SemVer + commit-hash pinning
- [x] Approval audit (`approval_requests` table; two-call token gate)
- [x] Usage accounting (`usage_records`, distillation threshold)
- [x] Namespacing by domain
- [x] Revocation path
- [ ] Automated `approved` flip with reviewer identity (Phase 1 hardening)
- [ ] Skill content hash (`sha256` of SKILL.md) stored at registration
