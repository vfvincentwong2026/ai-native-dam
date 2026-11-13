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
  SubmitSystemSpecInput,
  SubmitSystemSpecOutput,
  SearchSpecsInput,
  SearchSpecsOutput,
  RegisterGeneratedSystemInput,
  RegisterGeneratedSystemOutput,
  SearchSystemsInput,
  SearchSystemsOutput,
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
  ApproveDistillationInput,
  ApproveDistillationOutput,
  SearchDistillationsInput,
  SearchDistillationsOutput,
  RegisterLoraAdapterInput,
  RegisterLoraAdapterOutput,
  SearchLorasInput,
  SearchLorasOutput,
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
      'Does not modify the skill itself and does not approve new versions — it only executes an approved version. ' +
      'Pending/revoked/missing versions return applied=false with a reason and write no usage record.',
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
      'Draft only — does not trigger code generation; submit the draft for approval with submit_system_spec. ' +
      'Every sourceSkillId/sourceKnowledgeId must resolve to an approved registry/knowledge entry.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: GenerateSystemSpecInput,
    output: GenerateSystemSpecOutput,
  },
  {
    name: 'submit_system_spec',
    description:
      'Submit a draft System Spec for approval; the confirmation token IS the approval, ' +
      'so an approved spec is frozen and generation may run against it. High risk, always gated. ' +
      'Does not modify spec content, cannot reopen an approved spec, and cannot submit a missing ' +
      'or already-decided spec — register a new draft instead.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: SubmitSystemSpecInput,
    output: SubmitSystemSpecOutput,
  },
  {
    name: 'search_specs',
    description:
      'Query System Specs by status and title/domain substring. Read-only; ' +
      'drafts are visible to all scopes so reviewers can find work awaiting submit_system_spec.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: SearchSpecsInput,
    output: SearchSpecsOutput,
  },
  {
    name: 'register_generated_system',
    description:
      'Register a built system as a governed asset, linked to an approved System Spec. ' +
      'High risk, always gated. Records provenance from the spec (source skills/knowledge) and ' +
      'transitions the spec to generated. Registration only — does not deploy or start the system.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: RegisterGeneratedSystemInput,
    output: RegisterGeneratedSystemOutput,
  },
  {
    name: 'search_systems',
    description:
      'Query registered generated systems by status and name substring. Read-only; ' +
      'returns registry metadata and provenance pointers, never runtime internals.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: SearchSystemsInput,
    output: SearchSystemsOutput,
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
      'Pauses before training — never starts training by itself; crossing the usage threshold only ' +
      'sets awaiting_approval, and a human releases it via approve_distillation (see docs/adr/0003).',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: RequestDistillationInput,
    output: RequestDistillationOutput,
  },
  {
    name: 'approve_distillation',
    description:
      'Human decision on an awaiting_approval distillation request: approve releases it to the ' +
      'execution plane (status training), reject closes it. High risk, always gated. The decider ' +
      'identity comes from the authenticated principal. Does not itself run training, and cannot ' +
      'decide a request that is not awaiting_approval.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: ApproveDistillationInput,
    output: ApproveDistillationOutput,
  },
  {
    name: 'search_distillations',
    description:
      'Query distillation requests by status or source skill. Read-only; ' +
      'queued and awaiting_approval requests are visible so reviewers can find pending decisions.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: SearchDistillationsInput,
    output: SearchDistillationsOutput,
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
  {
    name: 'search_loras',
    description:
      'List registered LoRA adapter artifacts, optionally filtered by source skill. ' +
      'Read-only; returns metadata pointers (adapter/training-data URIs, base model, metrics), ' +
      'never the adapter bytes.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: SearchLorasInput,
    output: SearchLorasOutput,
  },
];

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find(t => t.name === name);
}
