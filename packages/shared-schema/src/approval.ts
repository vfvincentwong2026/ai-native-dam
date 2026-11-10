import { z } from 'zod';

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ApprovalDecision = z.enum(['approved', 'declined', 'pending', 'expired']);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalRequest = z.object({
  id: z.string(),
  toolName: z.string(),
  riskLevel: RiskLevel,
  arguments: z.record(z.unknown()),
  resourceKey: z.string(),
  requestedAt: z.string().datetime(),
  decision: ApprovalDecision,
  decidedAt: z.string().datetime().nullable(),
  decidedBy: z.string().nullable(),
  reason: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
