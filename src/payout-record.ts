import { PAYOUT_SCHEMA_VERSION } from "./constants";
import { createUniqueId } from "./id";

export const PAYOUT_REWARD_TYPES = [
  "money",
  "ip",
  "humanityGain",
  "humanityLoss",
  "reputation",
  "factionReputation",
  "communalMoney",
  "hqIp",
  "attendance",
  "item",
  "downtime",
] as const;

export type PayoutRewardType = (typeof PAYOUT_REWARD_TYPES)[number];

export type PayoutTargetType = "actor" | "user" | "world" | "journal";

export interface PayoutParticipant {
  userId: string;
  userName: string;
  actorId: string | null;
  actorName: string | null;
}

export interface PayoutChange {
  reward: PayoutRewardType;
  targetType: PayoutTargetType;
  targetId: string | null;
  targetName: string;
  amount: number;
  previousValue: number | null;
  newValue: number | null;
  details?: Record<string, string | number | boolean | null>;
}

export interface PayoutRecord {
  schemaVersion: typeof PAYOUT_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  createdByUserId: string;
  createdByUserName: string;
  sessionLabel: string;
  inGameDate?: string;
  notes: string;
  participants: PayoutParticipant[];
  changes: PayoutChange[];
  correctsRecordId: string | null;
}

export interface CreatePayoutRecordInput {
  createdByUserId: string;
  createdByUserName: string;
  sessionLabel: string;
  inGameDate?: string;
  notes?: string;
  participants?: PayoutParticipant[];
  changes?: PayoutChange[];
  correctsRecordId?: string | null;
}

export function createPayoutRecord(
  input: CreatePayoutRecordInput,
): PayoutRecord {
  const sessionLabel = input.sessionLabel.trim();

  if (!sessionLabel) {
    throw new Error("A payout record requires a session label.");
  }

  if (!input.createdByUserId) {
    throw new Error("A payout record requires the creating user's ID.");
  }

  return {
    schemaVersion: PAYOUT_SCHEMA_VERSION,
    id: createUniqueId(),
    createdAt: new Date().toISOString(),
    createdByUserId: input.createdByUserId,
    createdByUserName: input.createdByUserName.trim(),
    sessionLabel,
    inGameDate: input.inGameDate?.trim() ?? "",
    notes: input.notes?.trim() ?? "",
    participants: structuredClone(input.participants ?? []),
    changes: structuredClone(input.changes ?? []),
    correctsRecordId: input.correctsRecordId ?? null,
  };
}
