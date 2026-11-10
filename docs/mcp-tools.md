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

### `check_use`

| Field | Value |
|---|---|
| Risk | `low` |
| Gated | `false` |
| Scopes | `Suggest`, `Read`, `Edit` |

**Description.** Can this asset be used on *channel X* in *territory Y* right now?
Returns `allowed: false` with a `replacement_id` when rights block the use.

**Input Schema**

```json
{
  "type": "object",
  "properties": {
    "asset_id": { "type": "string" },
    "channel": { "type": "string" },
    "territory": { "type": "string", "default": "CN" },
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

**Description.** Log a use. **Rejected if `check_use` would return `allowed: false`.**

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
| `search_skills` | low | — | planned |
| `apply_skill` | medium | ✅ | planned |
| `generate_system_spec` | medium | ✅ | planned |
| `submit_system_spec` | high | ✅ | planned |
| `register_generated_system` | high | ✅ | planned |

---

## Distillation

| Tool | Risk | Gated | Status |
|---|---|---|---|
| `request_distillation` | medium | ✅ | planned |
| `register_lora_adapter` | high | ✅ | planned |

---

## Approval Semantics

- `mcp-approval` first tries **`elicitation`**: it asks the human via the MCP client.
  The model **cannot** answer on the person's behalf.
- When the client does not support `elicitation`, it falls back to a **two-call
  confirmation token**: the first call returns a random string, the second call
  must quote it back. The token proves the same arguments were sent twice.
- `high`-risk tools are **never** auto-approved, even for admin users.
