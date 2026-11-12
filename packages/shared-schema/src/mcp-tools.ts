import {
  SearchAssetsInput,
  SearchAssetsOutput,
  CheckUsageRightsInput,
  CheckUsageRightsOutput,
  CreateAssetInput,
  CreateAssetOutput,
  SetRightsInput,
  SetRightsOutput,
  RecordUsageInput,
  RecordUsageOutput,
} from './assets.js';
import {
  SearchSkillsInput,
  SearchSkillsOutput,
  ApplySkillInput,
  ApplySkillOutput,
  RegisterSkillInput,
  RegisterSkillOutput,
  ApproveSkillInput,
  ApproveSkillOutput,
  RevokeSkillInput,
  RevokeSkillOutput,
} from './skills.js';
import {
  GenerateSystemSpecInput,
  GenerateSystemSpecOutput,
} from './systems.js';
import {
  SearchKnowledgeInput,
  SearchKnowledgeOutput,
  WriteKnowledgeInput,
  WriteKnowledgeOutput,
  ApproveKnowledgeInput,
  ApproveKnowledgeOutput,
} from './knowledge.js';
import {
  RequestDistillationInput,
  RequestDistillationOutput,
  RegisterLoraAdapterInput,
  RegisterLoraAdapterOutput,
} from './distillation.js';
import { RiskLevel } from './approval.js';

export type McpScope = 'Suggest' | 'Read' | 'Edit';

export interface McpToolDefinition {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  gated: boolean;
  scopes: McpScope[];
  input: unknown;
  output: unknown;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'search_assets',
    description: 'Query media assets by tag, metadata, channel, or semantic similarity.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: SearchAssetsInput,
    output: SearchAssetsOutput,
  },
  {
    name: 'check_usage_rights',
    description:
      'Rights check only: can this asset be used on channel X in territory Y now? ' +
      'Read-only; does not log usage (use record_usage) and never modifies rights (use set_rights). ' +
      'Formerly check_use — the old name is a deprecated alias.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: CheckUsageRightsInput,
    output: CheckUsageRightsOutput,
  },
  {
    name: 'create_asset',
    description:
      'Ingest an asset with provenance; requires a license declaration. Gated by approval. ' +
      'The asset lands with rights_status Pending; this tool does not set rights (use set_rights) ' +
      'and does not make the asset usable on any channel.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: CreateAssetInput,
    output: CreateAssetOutput,
  },
  {
    name: 'set_rights',
    description:
      'Attach license, territory, embargo, and channel scope to an asset. Gated by approval. ' +
      'Does not validate or undo past usage records, and does not grant usage by itself — ' +
      'record_usage still re-checks rights at call time.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: SetRightsInput,
    output: SetRightsOutput,
  },
  {
    name: 'record_usage',
    description:
      'Log a use. Gated by approval. Rejected when check_usage_rights would return allowed=false ' +
      'for the target channel/territory. Does not publish or distribute anything; it only writes an audit record.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: RecordUsageInput,
    output: RecordUsageOutput,
  },
  {
    name: 'search_skills',
    description: 'Query Skill Registry by domain and rights scope.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: SearchSkillsInput,
    output: SearchSkillsOutput,
  },
  {
    name: 'apply_skill',
    description:
      'Invoke a skill version; records usage against provenance. Gated by approval. ' +
      'Does not modify the skill itself and does not approve new versions — it only executes an approved version.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: ApplySkillInput,
    output: ApplySkillOutput,
  },
  {
    name: 'register_skill',
    description:
      'Register a skill version with commit-pinned provenance (source repo, path, commit). Gated by approval. ' +
      'Lands as pending_approval; does not make the skill discoverable or invocable until a governance approver approves it.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: RegisterSkillInput,
    output: RegisterSkillOutput,
  },
  {
    name: 'approve_skill',
    description:
      'Approve a pending_approval (or draft) skill version, making it discoverable via search_skills and ' +
      'invocable. High risk, always gated. The approver identity is taken from the authenticated principal, ' +
      'never from arguments. Does not modify skill content or provenance, and cannot revoke — revocation is a ' +
      'separate governance action.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: ApproveSkillInput,
    output: ApproveSkillOutput,
  },
  {
    name: 'revoke_skill',
    description:
      'Revoke a skill version, removing it from default search results and blocking new invocations. ' +
      'High risk, always gated. Does not delete the record or rewrite provenance; a revoked version ' +
      'cannot be re-approved — register a new version instead.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: RevokeSkillInput,
    output: RevokeSkillOutput,
  },
  {
    name: 'generate_system_spec',
    description:
      'Draft a System Spec from conversation, skills, and knowledge. Gated by approval. ' +
      'Draft only — does not trigger code generation; submit the draft for approval with submit_system_spec.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: GenerateSystemSpecInput,
    output: GenerateSystemSpecOutput,
  },
  {
    name: 'search_knowledge',
    description: 'Query the knowledge base by layer.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: SearchKnowledgeInput,
    output: SearchKnowledgeOutput,
  },
  {
    name: 'write_knowledge',
    description:
      'Write a knowledge entry. Gated by approval; the entry lands as pending_approval. ' +
      'Does not make the entry discoverable until approved, and never overwrites existing entries.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: WriteKnowledgeInput,
    output: WriteKnowledgeOutput,
  },
  {
    name: 'approve_knowledge',
    description:
      'Approve a pending_approval (or draft) knowledge entry, making it discoverable via search_knowledge. ' +
      'High risk, always gated. Does not modify content or source links, and cannot revoke — revocation ' +
      'is a separate governance action.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: ApproveKnowledgeInput,
    output: ApproveKnowledgeOutput,
  },
  {
    name: 'request_distillation',
    description:
      'Flag a skill for distillation after N uses. Gated by approval. ' +
      'Pauses before training — never starts training by itself; training requires a separate human decision (see docs/adr/0003).',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: RequestDistillationInput,
    output: RequestDistillationOutput,
  },
  {
    name: 'register_lora_adapter',
    description:
      'Register a distilled LoRA adapter as a versioned asset. High risk, always gated. ' +
      'Registers metadata only; does not deploy, load, or serve the adapter.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: RegisterLoraAdapterInput,
    output: RegisterLoraAdapterOutput,
  },
];

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find(t => t.name === name);
}
