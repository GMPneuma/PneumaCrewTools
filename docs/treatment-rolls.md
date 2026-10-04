# Treatment rolls

The Player Hub's **Treatment** button sits directly below **Spend Downtime**, with a red cross icon. It opens the same layout as Combat Tools' Treatment Roll: Patient, Stabilize, Body Crits and Head Crits. CrewTools provides this window independently; Combat Tools does not need to be enabled.

The window uses CrewTools' panel headers, red accents, compact controls and striped stabilization rows. Styling is scoped to the CrewTools Treatment window.

The Hub's selected character provides treatment. A selected token is not required. Choose a visible player-owned token on the current scene as the patient, or select **Type a patient name…**. Player ownership does not require the owning player to be online. A single targeted eligible token is selected initially. Hidden tokens are available only to the GM; patient Actor permissions are unnecessary when using the name option.

Stabilization offers First Aid and Paramedic at DV10, DV13 or DV15 for Lightly, Seriously or Mortally Wounded patients. Body and Head injury lists load the system's native critical-injury compendiums. Each injury's own data determines which QuickFix and Treatment skills are available and their separate DVs. QuickFix-only cures disable the Treatment controls.

First Aid and Paramedic use the character's native skill Items. Surgery uses the Medtech's native **Surgery Skill** sub-role ability. Unavailable skills are disabled. Rolls retain the native modifiers dialog, confirmation, critical dice, Luck spending and chat roll mode. Shift-click follows the native shortcut behavior. Closing the native roll dialog spends no Luck and posts no roll.

Chat retains the native roll card and adds healer, patient, success/failure and DV. Success requires a total above the DV. This is a roll aid: injury removal, QuickFix effects and stabilization remain manual. Treatment does not spend downtime, update the patient's Actor, or require a connected GM.

Automated checks cover native skill/role selection, individual DVs, QuickFix-only cures, cancelled rolls, Luck, chat privacy, offline patients, ownership checks, button placement and rendered controls. Live Foundry verification remains pending.
