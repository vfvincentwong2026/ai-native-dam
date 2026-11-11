import { readFile } from 'node:fs/promises';
import { parseSkillMd } from './frontmatter.js';
import { SkillManifest } from './manifest.js';
import { scanSkillFiles, skillRelativePath } from './scan.js';
import { gitProvenance } from './git.js';
import type { RegisterSkillInput } from '@ai-native-dam/shared-schema';

export interface SyncOptions {
  /** MCP gateway base URL, e.g. http://localhost:8080. Omit for dry-run. */
  gatewayUrl?: string;
  /** Bearer token with Edit scope. */
  token?: string;
  /** Validate and report only; never call the gateway. */
  dryRun?: boolean;
}

export interface SkillSyncRecord {
  file: string;
  ok: boolean;
  error?: string;
  registration?: RegisterSkillInput;
  registered?: boolean;
}

async function callGateway(
  gatewayUrl: string,
  token: string,
  args: RegisterSkillInput,
): Promise<{ ok: boolean; error?: string }> {
  const post = (payload: unknown): Promise<any> =>
    fetch(`${gatewayUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }).then(r => r.json() as Promise<any>);

  const snake = (o: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), v]),
    );

  const wireArgs = snake(args as unknown as Record<string, unknown>);
  const first = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'register_skill', arguments: wireArgs },
  });
  const text: string | undefined = first?.result?.content?.[0]?.text;
  if (!text) return { ok: false, error: JSON.stringify(first?.error ?? first) };
  const payload = JSON.parse(text);
  if (!payload.approval_required) return { ok: false, error: 'expected approval_required' };

  const second = await post({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'register_skill',
      arguments: { ...wireArgs, _confirmation: payload.confirmation_token },
    },
  });
  const secondText: string | undefined = second?.result?.content?.[0]?.text;
  if (!secondText) return { ok: false, error: JSON.stringify(second?.error ?? second) };
  const secondPayload = JSON.parse(secondText);
  if (second?.result?.isError) return { ok: false, error: secondPayload.reason ?? 'rejected' };
  return { ok: true };
}

/**
 * Scan a skill repository, validate every SKILL.md, and (unless dry-run)
 * register each one into the DAM via the gateway's gated register_skill tool.
 * The two-call confirmation is performed automatically; the gate still proves
 * the arguments were sent twice, and the approval request is audited.
 */
export async function syncSkills(root: string, options: SyncOptions = {}): Promise<SkillSyncRecord[]> {
  const files = await scanSkillFiles(root);
  const provenance = gitProvenance(root);
  const records: SkillSyncRecord[] = [];

  for (const file of files) {
    const rel = skillRelativePath(root, file);
    let registration: RegisterSkillInput | undefined;
    try {
      const content = await readFile(file, 'utf8');
      const parsed = parseSkillMd(content);
      if (!parsed) throw new Error('missing or invalid frontmatter block');
      const manifest = SkillManifest.parse(parsed.data);
      registration = {
        id: `${manifest.domain}:${manifest.name}`,
        version: manifest.version,
        name: manifest.name,
        description: manifest.description,
        domain: manifest.domain,
        sourceRepo: provenance.repo,
        sourcePath: rel,
        sourceCommit: provenance.commit,
      };
    } catch (err) {
      records.push({ file: rel, ok: false, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    if (options.dryRun || !options.gatewayUrl) {
      records.push({ file: rel, ok: true, registration, registered: false });
      continue;
    }

    const result = await callGateway(options.gatewayUrl, options.token ?? '', registration);
    records.push({ file: rel, ok: result.ok, registration, registered: result.ok, error: result.error });
  }

  return records;
}
