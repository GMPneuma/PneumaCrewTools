// A common durable shape for active and completed TECH and medical activities.
export type ActivityStatus = "active" | "completed" | "failed" | "cancelled";
export interface ActivityEvent {
  id: string;
  date: string;
  action: string;
  text: string;
  data: Record<string, unknown>;
}
export interface ActivityRecord<T = unknown> {
  id: string;
  actorId: string;
  name: string;
  kind: "tech" | "patient" | "provider" | "medicalDay";
  status: ActivityStatus;
  startedAt: string;
  completedAt?: string;
  progress: { value: number; required: number; unit: "days" | "hours" };
  details: T;
  events: ActivityEvent[];
}
