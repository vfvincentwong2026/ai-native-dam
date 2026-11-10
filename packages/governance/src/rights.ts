import type {
  RightsRecord,
  CheckUseInput,
  CheckUseOutput,
} from '@ai-native-dam/shared-schema';

export function checkUse(
  record: RightsRecord | null,
  input: CheckUseInput,
  now: Date = new Date(),
): CheckUseOutput {
  if (!record) {
    return { allowed: false, reason: 'no_rights_record', replacementId: null };
  }

  if (record.status === 'Expired') {
    return { allowed: false, reason: 'rights_expired', replacementId: null };
  }

  if (record.status !== 'Cleared') {
    return {
      allowed: false,
      reason: `rights_${record.status.toLowerCase()}`,
      replacementId: null,
    };
  }

  if (!record.channels.includes(input.channel)) {
    return { allowed: false, reason: 'channel_not_licensed', replacementId: null };
  }

  if (!record.territories.includes(input.territory)) {
    return { allowed: false, reason: 'territory_not_licensed', replacementId: null };
  }

  if (record.embargoUntil && new Date(record.embargoUntil) > now) {
    return { allowed: false, reason: 'embargo_active', replacementId: null };
  }

  if (record.expiresAt && new Date(record.expiresAt) <= now) {
    return { allowed: false, reason: 'rights_expired', replacementId: null };
  }

  return { allowed: true, reason: 'ok', replacementId: null };
}
