# MCP Tool Contract

Canonical contract for every tool exposed by the AI-Native DAM governance plane.
Every tool declares `risk_level` (`low` / `medium` / `high`) and `gated` (`true` / `false`).
**Every `gated: true` tool is routed through `mcp-approval`.**

## Table of Contents

- [Media & Knowledge](#media--knowledge)
- [Skills & Systems](#skills--systems)
- [Distillation](#distillation)
- [Approval Semantics](#approval-semantics)

---

## Media & Knowledge

### `search_assets`

| Field | Value |
|---|---|
| Risk | `low` |
| Gated | `false` |
| Scopes | `Suggest`, `Read`, `Edit` |

**Description.** Query media assets by tag, metadata, channel, or semantic similarity.

**Input Schema**

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Free-text or semantic query" },
    "channel": { "type": "string", "enum": ["x", "youtube", "instagram", "xiaohongshu", "wechat_channels"] },
    "tags": { "type": "array", "items": { "type": "string" } },
    "limit": { "type": "integer", "default": 20, "maximum": 100 }
  },
  "required": ["query"]
}
```

**Output Schema**

```json
{
  "type": "object",
  "properties": {
    "assets": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "mime_type": { "type": "string" },
          "rendition_url": { "type": "string" },
          "rights_status": { "type": "string", "enum": ["Cleared", "Restricted", "Expired"] }
        }
      }
    }
  }
}
```

**Example Call**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "search_assets", "arguments": { "query": "summer campaign hero", "channel": "xiaohongshu", "limit": 10 } }
}
```

---

### `check_usage_rights`

> Renamed from `check_use`. The old name remains accepted as a **deprecated
> alias**; responses to alias calls carry `deprecated_alias` / `use_instead`
> markers. New integrations must use `check_usage_rights`.

| Field | Value |
|---|---|
| Risk | `low` |
| Gated | `false` |
| Scopes | `Suggest`, `Read`, `Edit` |

**Description.** Rights check only: can this asset be used on *channel X* in *territory Y* right now?
Read-only — does not log usage (use `record_usage`) and never modifies rights (use `set_rights`).
Returns `allowed: false` with a `replacement_id` when rights block the use.

**Input Schema**

```json
{
  "type": "object",
  "properties": {
    "asset_id": { "type": "string" },
    "channel": { "type": "string", "enum": ["x", "youtube", "instagram", "xiaohongshu", "wechat_channels"] },
    "territory": { "type": "string", "enum": ["CN", "US", "EU", "GLOBAL"], "default": "CN" },
    "at": { "type": "string", "format": "date-time", "description": "Defaults to now" }
  },
  "required": ["asset_id", "channel"]
}
```

**Output Schema**

```json
{
  "type": "object",
  "properties": {
    "allowed": { "type": "boolean" },
    "reason": { "type": "string" },
    "replacement_id": { "type": ["string", "null"] }
  }
}
```

---

### `record_usage`

| Field | Value |
|---|---|
| Risk | `medium` |
| Gated | `true` |
| Scopes | `Edit` |

**Description.** Log a use. **Rejected if `check_usage_rights` would return `allowed: false`.** Does not publish or distribute anything; it only writes an audit record.

**Input Schema**

```json
{
  "type": "object",
  "properties": {
    "asset_id": { "type": "string" },
    "channel": { "type": "string" },
    "territory": { "type": "string" },
    "context": { "type": "string", "description": "What was it used for" }
  },
  "required": ["asset_id", "channel"]
}
```

---

## Skills & Systems

| Tool | Risk | Gated | Status |
|---|---|---|---|
| `search_skills` | low | — | implemented (gateway, Phase 1) |
| `apply_skill` | medium | ✅ | implemented (gateway, Phase 1) |
| `register_skill` | medium | ✅ | implemented (gateway + `skill-sync`, Phase 1) |
| `approve_skill` | high | ✅ | implemented (gateway, Phase 1) |
| `revoke_skill` | high | ✅ | implemented (gateway, Phase 1) |
| `generate_system_spec` | medium | ✅ | implemented (gateway, Phase 2) |
| `submit_system_spec` | high | ✅ | implemented (gateway, Phase 2) |
| `search_specs` | low | — | implemented (gateway, Phase 2) |
| `register_generated_system` | high | ✅ | planned |

---

## Distillation

| Tool | Risk | Gated | Status |
|---|---|---|---|
| `request_distillation` | medium | ✅ | planned |
| `register_lora_adapter` | high | ✅ | planned |

---

## Implementation Status (Phase 1)

Implemented in `packages/mcp-gateway` over Streamable HTTP, in-memory state:

| Tool | Status |
|---|---|
| `search_assets` | ✅ implemented |
| `check_usage_rights` | ✅ implemented (renamed from `check_use`, alias kept) |
| `create_asset` | ✅ implemented (gated) |
| `set_rights` | ✅ implemented (gated) |
| `record_usage` | ✅ implemented (gated, rights-rejection enforced) |
| `search_knowledge` | ✅ implemented |
| `write_knowledge` | ✅ implemented (gated, lands as `pending_approval`) |
| `approve_knowledge` | ✅ implemented (high-risk gated, `draft`/`pending_approval` → `approved`) |
| `search_skills` | ✅ implemented |
| `register_skill` | ✅ implemented (gated, lands as `pending_approval`, commit-pinned provenance) |
| `approve_skill` | ✅ implemented (high-risk gated, `draft`/`pending_approval` → `approved`; approver = authenticated principal) |
| `revoke_skill` | ✅ implemented (high-risk gated, any status → `revoked`; record kept for audit) |
| `apply_skill` | ✅ implemented (gated, approved-only; writes a `SkillUsageRecord` per application) |

`packages/skill-sync` scans any skill repository (SKILL.md + frontmatter per
`docs/skill-format.md`), validates manifests, derives git provenance, and
registers skills through the gateway's approval gate. `templates/vincent-core`
is the ready-to-push skeleton for the certified core skill hub.

The gateway authenticates via bearer token (`DAM_TOKENS`), filters `tools/list`
by scope (`Suggest` / `Read` / `Edit`), and routes every gated tool through the
two-call confirmation-token approval flow described below.


---

## Approval Semantics

- `mcp-approval` first tries **`elicitation`**: it asks the human via the MCP client.
  The model **cannot** answer on the person's behalf.
- When the client does not support `elicitation`, it falls back to a **two-call
  confirmation token**: the first call returns a random string, the second call
  must quote it back. The token proves the same arguments were sent twice.
- `high`-risk tools are **never** auto-approved, even for admin users.
