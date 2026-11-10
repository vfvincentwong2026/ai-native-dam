import {
  SearchAssetsInput,
  SearchAssetsOutput,
  CheckUseInput,
  CheckUseOutput,
} from './assets.js';
import {
  SearchSkillsInput,
  SearchSkillsOutput,
  ApplySkillInput,
  ApplySkillOutput,
} from './skills.js';
import {
  GenerateSystemSpecInput,
  GenerateSystemSpecOutput,
} from './systems.js';
import {
  SearchKnowledgeInput,
  SearchKnowledgeOutput,
  WriteKnowledgeInput,
} from './knowledge.js';
import {
  RequestDistillationInput,
  RegisterLoraAdapterInput,
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
    name: 'check_use',
    description: 'Can this asset be used on channel X in territory Y now?',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    input: CheckUseInput,
    output: CheckUseOutput,
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
    description: 'Invoke a skill version; records usage against provenance.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: ApplySkillInput,
    output: ApplySkillOutput,
  },
  {
    name: 'generate_system_spec',
    description: 'Draft a System Spec from conversation, skills, and knowledge.',
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
    description: 'Write a knowledge entry; requires approval.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: WriteKnowledgeInput,
    output: SearchKnowledgeOutput,
  },
  {
    name: 'request_distillation',
    description: 'Flag a skill for distillation after N uses; pauses before training.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    input: RequestDistillationInput,
    output: SearchKnowledgeOutput,
  },
  {
    name: 'register_lora_adapter',
    description: 'Register a distilled LoRA adapter as a versioned asset.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    input: RegisterLoraAdapterInput,
    output: SearchKnowledgeOutput,
  },
];

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find(t => t.name === name);
}
