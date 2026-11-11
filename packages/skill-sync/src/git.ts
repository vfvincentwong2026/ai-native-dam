import { execFileSync } from 'node:child_process';

export interface GitProvenance {
  repo: string | null;
  commit: string | null;
}

/**
 * Best-effort git provenance for the scanned directory. Tolerates directories
 * that are not git repositories (both fields become null).
 */
export function gitProvenance(cwd: string): GitProvenance {
  let repo: string | null = null;
  let commit: string | null = null;
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    // Normalize git@github.com:org/repo.git → https://github.com/org/repo
    repo = remote
      .replace(/^git@([^:]+):/, 'https://$1/')
      .replace(/\.git$/, '');
  } catch {
    /* not a git repo or no origin */
  }
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    /* no commits yet */
  }
  return { repo, commit };
}
