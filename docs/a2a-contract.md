# A2A Contract

The Agent-to-Agent (A2A) surface lets **customer agents** delegate tasks to this
platform as a peer, without exposing internal skills, models, or pipeline state.

MCP is the **tool surface**. A2A is the **peer surface**. Both go through the same
Rights and Approval gate.

---

## Agent Card

Served at:

```text
GET /.well-known/agent.json
```

Example:

```json
{
  "name": "ai-native-dam",
  "description": "Governance plane for AI-native assets, skills, generated systems, and distilled capabilities.",
  "url": "https://ai-native-dam.pages.dev/a2a",
  "version": "0.1.0",
  "protocolVersion": "0.3.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["application/json"],
  "skills": [
    {
      "id": "generate-system",
      "name": "Generate internal system",
      "description": "Given a business domain and an approved SOP, produce a System Spec for approval before any code is generated.",
      "tags": ["generation", "spec-first", "approval-gated"],
      "examples": [
        "Generate a read-only e-commerce order query admin.",
        "Generate a short-drama episode management system."
      ]
    },
    {
      "id": "search-capabilities",
      "name": "Search governed skills and assets",
      "description": "Return approved skills and assets scoped to the caller's rights, filtered by business domain and channel.",
      "tags": ["search", "rights-scoped"],
      "examples": [
        "What approved skills exist for retail order management?",
        "Which brand assets may be used on Xiaohongshu in CN?"
      ]
    }
  ],
  "securitySchemes": {
    "bearer": {
      "type": "http",
      "scheme": "bearer",
      "bearerFormat": "JWT"
    }
  },
  "security": [{ "bearer": [] }]
}
```

Required fields: `name`, `description`, `url`, `version`, `protocolVersion`,
`capabilities`, `skills`, `securitySchemes`. Each skill must have `id`, `name`,
`description`, and at least one of `tags` or `examples`.

---

## Task Delegation Flow

A customer agent sends `message/send` (synchronous) or `message/stream` (SSE):

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        { "kind": "text", "text": "Generate a read-only retail order admin for client ACME." }
      ],
      "messageId": "msg-001"
    },
    "metadata": {
      "skillId": "generate-system",
      "businessDomain": "retail",
      "clientId": "acme"
    }
  }
}
```

The governance plane then:

1. **Authenticates** the caller via the bearer token.
2. **Resolves rights** — which skills, assets, and knowledge layers this caller may use.
3. **Filters** the Skill Registry and asset pool to that scope.
4. **Delegates** to the Builder Runtime over internal MCP (`generate_system_spec`).
5. **Gates** the result: the System Spec goes to `mcp-approval` before any code runs.
6. **Returns** a governed result — a Spec ID, approval status, and blocked reasons.

The caller **never sees** which internal skills, models, or pipelines were used.
Only the governed result is returned.

---

## Response Example

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "status": "input-required",
    "taskId": "task-7f3a",
    "message": {
      "role": "agent",
      "parts": [
        {
          "kind": "text",
          "text": "Spec draft created and awaiting approval. Spec ID: spec-2026-001. Blocked items: 2 assets restricted in territory CN."
        }
      ]
    },
    "artifacts": [
      {
        "artifactId": "spec-2026-001",
        "name": "System Spec: Retail Order Admin",
        "parts": [{ "kind": "data", "data": { "spec_id": "spec-2026-001", "status": "pending_approval" } }]
      }
    ]
  }
}
```

`input-required` means the task is **intentionally paused** for human approval.
The customer agent must not auto-retry until approval completes.

---

## What A2A Does Not Do

- It does **not** bypass rights. A delegated task is filtered to the caller's scope exactly like a direct MCP call.
- It does **not** expose internal tools. The customer sees `generate-system`, not `search_skills` or `apply_skill`.
- It does **not** replace MCP. Internal orchestration stays on MCP; A2A only faces external peers.

---

## Status

| Item | Status |
|---|---|
| Agent Card schema | Defined (this document) |
| `message/send` handler | Phase 3 |
| `message/stream` handler | Phase 3 |
| Task persistence | Phase 3 |
| Artifact return | Phase 3 |
