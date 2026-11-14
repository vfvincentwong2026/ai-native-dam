import { z } from 'zod';

/**
 * Deployment Plane data layer (ADR 0009): targets and instances are governed
 * assets. The gateway registers and audits them; actuation (containers,
 * rollouts) is delegated to existing tooling — governance, not orchestration.
 */

export const DeploymentTargetKind = z.enum(['cloud', 'edge', 'onprem']);
export type DeploymentTargetKind = z.infer<typeof DeploymentTargetKind>;

export const DeploymentTargetStatus = z.enum(['active', 'retired']);
export type DeploymentTargetStatus = z.infer<typeof DeploymentTargetStatus>;

export const DeploymentTarget = z.object({
  id: z.string(),
  name: z.string(),
  kind: DeploymentTargetKind,
  endpointUri: z.string().url().nullable(),
  region: z.string().nullable(),
  /** Free-text capacity note, e.g. "4 vCPU / 16GB / no GPU". */
  capacityNotes: z.string().nullable(),
  status: DeploymentTargetStatus,
  registeredBy: z.string(),
  createdAt: z.string().datetime(),
});
export type DeploymentTarget = z.infer<typeof DeploymentTarget>;

export const DeployedInstanceStatus = z.enum(['deployed', 'degraded', 'offline', 'revoked']);
export type DeployedInstanceStatus = z.infer<typeof DeployedInstanceStatus>;

export const DeployedInstance = z.object({
  id: z.string(),
  systemId: z.string(),
  targetId: z.string(),
  version: z.string(),
  status: DeployedInstanceStatus,
  lastHealthAt: z.string().datetime().nullable(),
  healthMetrics: z.record(z.number()).default({}),
  deployedBy: z.string(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  revokedBy: z.string().nullable(),
  revokeReason: z.string().nullable(),
});
export type DeployedInstance = z.infer<typeof DeployedInstance>;

export const RegisterDeploymentTargetInput = z.object({
  name: z.string(),
  kind: DeploymentTargetKind,
  endpointUri: z.string().url().optional(),
  region: z.string().optional(),
  capacityNotes: z.string().optional(),
});
export type RegisterDeploymentTargetInput = z.infer<typeof RegisterDeploymentTargetInput>;

export const RegisterDeploymentTargetOutput = z.object({
  target: DeploymentTarget,
});
export type RegisterDeploymentTargetOutput = z.infer<typeof RegisterDeploymentTargetOutput>;

export const RegisterDeployedInstanceInput = z.object({
  systemId: z.string(),
  targetId: z.string(),
});
export type RegisterDeployedInstanceInput = z.infer<typeof RegisterDeployedInstanceInput>;

export const RegisterDeployedInstanceOutput = z.object({
  instance: DeployedInstance,
});
export type RegisterDeployedInstanceOutput = z.infer<typeof RegisterDeployedInstanceOutput>;

export const RecordInstanceHealthInput = z.object({
  instanceId: z.string(),
  status: z.enum(['healthy', 'degraded', 'offline']),
  metrics: z.record(z.number()).default({}),
});
export type RecordInstanceHealthInput = z.infer<typeof RecordInstanceHealthInput>;

export const RecordInstanceHealthOutput = z.object({
  instance: DeployedInstance,
});
export type RecordInstanceHealthOutput = z.infer<typeof RecordInstanceHealthOutput>;

export const RevokeInstanceInput = z.object({
  instanceId: z.string(),
  reason: z.string(),
});
export type RevokeInstanceInput = z.infer<typeof RevokeInstanceInput>;

export const RevokeInstanceOutput = z.object({
  instance: DeployedInstance,
});
export type RevokeInstanceOutput = z.infer<typeof RevokeInstanceOutput>;

export const SearchDeploymentsInput = z.object({
  kind: DeploymentTargetKind.optional(),
  status: DeployedInstanceStatus.optional(),
  systemId: z.string().optional(),
  targetId: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchDeploymentsInput = z.infer<typeof SearchDeploymentsInput>;

export const SearchDeploymentsOutput = z.object({
  targets: z.array(DeploymentTarget),
  instances: z.array(DeployedInstance),
});
export type SearchDeploymentsOutput = z.infer<typeof SearchDeploymentsOutput>;
