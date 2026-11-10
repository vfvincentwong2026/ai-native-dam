# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security reports.
Email the maintainer listed on the repository profile with:

- A description of the issue
- Steps to reproduce
- Affected component (governance / runtime / connector / docs)
- Any suggested remediation

You will receive an acknowledgement within 72 hours.

## Scope

In scope: the governance plane (MCP gateway, approval gates, rights checks),
the Builder Runtime, and the connectors shipped in this repository.

Out of scope: vulnerabilities in upstream projects (report those to the
upstream maintainer), and misconfiguration of your own deployment.

## Design assumptions

- Every `high`-risk MCP tool requires human approval via `elicitation`.
  A deployment that disables `mcp-approval` is **outside** the supported
  security model.
- Bearer tokens are scoped to a single user. Sharing a token across users
  breaks the rights model.
- The Cloudflare Pages MCP endpoint is **read-only by design**. Do not add
  write tools there.
