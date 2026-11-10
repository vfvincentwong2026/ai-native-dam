# Governance Policies

Machine-readable rules that the MCP Gateway and `mcp-approval` enforce.

| File | Purpose |
|---|---|
| `risk-levels.yml` | Defines `low` / `medium` / `high` and their approval requirements. |
| `approval-gates.yml` | Per-tool gate configuration: which tools are gated, how, and with what resource key. |
| `permission-scopes.yml` | Which tools each MCP scope (`Suggest` / `Read` / `Edit`) may call. |

**Invariant:** a tool declared `high` in `risk-levels.yml` can never be auto-approved,
regardless of scope. A tool declared gated in `approval-gates.yml` must be present
in `docs/mcp-tools.md` with a matching `riskLevel`.
