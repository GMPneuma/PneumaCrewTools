export const PLAYER_DISCOVERY_ISSUES = [
  "noAssignedActor",
  "noEligibleActors",
  "unsupportedAssignedActorType",
  "sharedActor",
] as const;

export type PlayerDiscoveryIssue = (typeof PLAYER_DISCOVERY_ISSUES)[number];

export interface PlayerActorAssociation {
  actorId: string;
  actorName: string;
  actorType: string;
  assigned: boolean;
  sharedWithUserIds: string[];
}

export interface PlayerAccount {
  userId: string;
  userName: string;
  active: boolean;
  assignedActorId: string | null;
  assignedActorName: string | null;
  assignedActorType: string | null;
  actors: PlayerActorAssociation[];
  eligible: boolean;
  issues: PlayerDiscoveryIssue[];
}

const PAYOUT_ACTOR_TYPES = new Set(["character"]);

export function discoverPlayerAccounts(): PlayerAccount[] {
  const players = Array.from(game.users).filter((user) => !user.isGM);
  const actors = Array.from(game.actors).filter((actor) =>
    PAYOUT_ACTOR_TYPES.has(actor.type),
  );
  const actorOwners = indexActorOwners(players, actors);

  return players
    .map((user) => toPlayerAccount(user, actors, actorOwners))
    .sort((left, right) =>
      left.userName.localeCompare(right.userName, undefined, {
        sensitivity: "base",
      }),
    );
}

function indexActorOwners(
  users: FoundryUser[],
  actors: FoundryActor[],
): Map<string, string[]> {
  return new Map(
    actors.map((actor) => [
      actor.id,
      users
        .filter((user) => actor.testUserPermission(user, "OWNER"))
        .map(({ id }) => id),
    ]),
  );
}

function toPlayerAccount(
  user: FoundryUser,
  actors: FoundryActor[],
  actorOwners: Map<string, string[]>,
): PlayerAccount {
  const assignedActor = user.character;
  const issues: PlayerDiscoveryIssue[] = [];
  const associatedActors = actors
    .filter(
      (actor) =>
        actor.id === assignedActor?.id ||
        actor.testUserPermission(user, "OWNER"),
    )
    .map((actor) => ({
      actorId: actor.id,
      actorName: actor.name,
      actorType: actor.type,
      assigned: actor.id === assignedActor?.id,
      sharedWithUserIds: (actorOwners.get(actor.id) ?? []).filter(
        (userId) => userId !== user.id,
      ),
    }))
    .sort(compareActorAssociations);

  if (!assignedActor) {
    issues.push("noAssignedActor");
  } else if (!PAYOUT_ACTOR_TYPES.has(assignedActor.type)) {
    issues.push("unsupportedAssignedActorType");
  }

  if (associatedActors.length === 0) issues.push("noEligibleActors");
  if (
    associatedActors.some(({ sharedWithUserIds }) => sharedWithUserIds.length)
  ) {
    issues.push("sharedActor");
  }

  return {
    userId: user.id,
    userName: user.name,
    active: user.active,
    assignedActorId: assignedActor?.id ?? null,
    assignedActorName: assignedActor?.name ?? null,
    assignedActorType: assignedActor?.type ?? null,
    actors: associatedActors,
    eligible: associatedActors.length > 0,
    issues,
  };
}

function compareActorAssociations(
  left: PlayerActorAssociation,
  right: PlayerActorAssociation,
): number {
  if (left.assigned !== right.assigned) return left.assigned ? -1 : 1;
  return left.actorName.localeCompare(right.actorName, undefined, {
    sensitivity: "base",
  });
}
