// These are Cyberpunk RED roleplaying states, derived from current Humanity.
export const HARE_TRAITS = [
  "Grandiose sense of self",
  "Need for stimulation",
  "Cunning and manipulative",
  "Lack of remorse or guilt",
  "Callousness and lack of empathy",
  "Poor behavioral controls",
  "Impulsivity",
  "Failure to accept responsibility",
  "Criminal versatility",
] as const;

export function cyberpsychosisState(actor?: FoundryActor) {
  const humanity = (
    actor?.system as
      { derivedStats?: { humanity?: { value?: number } } } | undefined
  )?.derivedStats?.humanity?.value;
  if (typeof humanity !== "number" || !Number.isFinite(humanity)) return null;
  const emp = Math.max(0, Math.floor(humanity / 10));
  if (emp >= 3) return null;
  const level =
    emp === 2 ? "dissociative" : emp === 1 ? "psychopathy" : "cyberpsycho";
  const label =
    emp === 2 ? "Dissociative" : emp === 1 ? "Psychopathy" : "CYBERPYSCHO";
  const guidance =
    humanity < 0
      ? "Your character is in extreme cyberpsychosis. Hand control to the GM, who plays the character according to their worst tendencies. Control returns to you when Humanity becomes positive again."
      : emp === 2
        ? "Your character has borderline dissociative disorder. Roleplay a growing sense of detachment from yourself and other people."
        : emp === 1
          ? "Your character has dissociative disorder and borderline cyberpsychosis. Strongly roleplay at least three of the traits below."
          : "Your character has cyberpsychosis. Strongly roleplay at least five of the traits below.";
  return { humanity, emp, level, label, guidance };
}

export function showCyberpsychosisSummary(actor?: FoundryActor): void {
  const state = cyberpsychosisState(actor);
  if (!state) return;
  new Dialog(
    {
      title: "Cyberpsychosis — EMP " + state.emp,
      content:
        '<div class="crewtools-cyberpsychosis-summary"><p><strong>Current EMP: ' +
        state.emp +
        "</strong> · Humanity: " +
        state.humanity +
        "</p><p>" +
        state.guidance +
        "</p><p>Cyberpsychosis does not necessarily mean violence.</p><h3>Hare Psychopathy traits</h3><ul>" +
        HARE_TRAITS.map((trait) => "<li>" + trait + "</li>").join("") +
        "</ul></div>",
      buttons: { close: { label: "Close" } },
      default: "close",
    },
    { width: 440 },
  ).render(true);
}
