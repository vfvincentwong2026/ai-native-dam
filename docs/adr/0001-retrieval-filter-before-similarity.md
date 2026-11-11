# ADR 0001: Rights filtering happens before similarity ranking

- Status: **Accepted** (2026-11-12)
- Deciders: governance plane maintainers

## Context

`search_assets` and `search_knowledge` will eventually rank by semantic
similarity (embeddings). A naive pipeline — embed query, rank by similarity,
then filter by rights — leaks governance information: a restricted asset can
surface in a ranked list, and ranking behavior changes whenever the similarity
index changes, making rights enforcement hard to audit.

## Decision

Governance predicates are **hard filters applied before any similarity
ranking**. Channel/territory/embargo/status checks reduce the candidate pool
first; similarity only *orders* what already passed. Similarity is a ranking
strategy, never a gate.

## Consequences

- Restricted assets never appear in results, regardless of embedding quality.
- The similarity backend (pgvector, external vector DB, plain text match) can
  be swapped without touching rights logic.
- Ranking quality may suffer on small filtered pools; acceptable — governance
  correctness outranks recall.
- Current in-memory implementation already follows this: `searchAssets`
  filters by `checkUsageRights` before slicing/ranking.

## Status

Accepted. Applies to `search_assets`, `search_knowledge`, `search_skills`,
and any future semantic retrieval tool.
