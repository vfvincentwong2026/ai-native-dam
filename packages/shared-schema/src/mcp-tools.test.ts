import { describe, it, expect } from 'vitest';
import { MCP_TOOLS, findTool } from './mcp-tools.js';

const DOCUMENTED_TOOLS = [
  'search_assets',
  'check_usage_rights',
  'create_asset',
  'set_rights',
  'record_usage',
  'search_knowledge',
  'write_knowledge',
  'search_skills',
  'apply_skill',
  'register_skill',
  'approve_skill',
  'revoke_skill',
  'approve_knowledge',
  'generate_system_spec',
  'submit_system_spec',
  'search_specs',
  'request_distillation',
  'register_lora_adapter',
];

describe('MCP_TOOLS registry', () => {
  it('covers every tool documented in docs/mcp-tools.md', () => {
    const names = MCP_TOOLS.map(t => t.name);
    for (const name of DOCUMENTED_TOOLS) {
      expect(names).toContain(name);
    }
    expect(names.length).toBe(DOCUMENTED_TOOLS.length);
  });

  it('has no duplicate tool names', () => {
    const names = MCP_TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every gated tool is medium or high risk', () => {
    for (const tool of MCP_TOOLS) {
      if (tool.gated) {
        expect(['medium', 'high']).toContain(tool.riskLevel);
      }
    }
  });

  it('every Edit-scoped write tool is gated', () => {
    for (const tool of MCP_TOOLS) {
      const editOnly = tool.scopes.length === 1 && tool.scopes[0] === 'Edit';
      if (editOnly) {
        expect(tool.gated).toBe(true);
      }
    }
  });

  it('findTool round-trips every registered tool', () => {
    for (const tool of MCP_TOOLS) {
      expect(findTool(tool.name)).toBe(tool);
    }
    expect(findTool('does_not_exist')).toBeUndefined();
  });

  it('input schemas carry zod defaults that parse empty objects where allowed', () => {
    const checkUse = findTool('check_usage_rights');
    expect(checkUse).toBeDefined();
    // check_usage_rights requires assetId + channel; parsing empty input must fail.
    const parsed = (checkUse!.input as { safeParse: (v: unknown) => { success: boolean } })
      .safeParse({});
    expect(parsed.success).toBe(false);
  });
});
