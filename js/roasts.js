// Turkey Court roast lines. {name} is replaced with the guilty Santa's name.
// Add your own — the more unhinged the better.
export const ROASTS = [
  "{name} saw \"$20 max\" and read it as a suggestion. Basted. Stuffed. Served.",
  "{name} has been sentenced to 4 hours at 350°F. No appeals.",
  "{name} thinks \"budget\" is a type of airline. Gobble gobble, felon.",
  "Breaking: {name} overspent so hard the economy noticed.",
  "{name} brought a flamethrower to a sparkler fight. Golden brown and guilty.",
  "{name}'s bank account filed a restraining order. Turkey Court agrees.",
  "{name} had ONE rule. One. Now {name} is the main course.",
  "We asked for a $20 gift. {name} delivered a $20 gift plus a crime.",
  "{name} is the reason we can't have nice things. Or cheap things, apparently.",
  "Somewhere a calculator is crying because of {name}.",
  "{name} has been carved, plated, and posted to the group chat.",
  "{name}: generous? Yes. Law-abiding? Absolutely not. 🦃🔥",
  "The court finds {name} guilty of making everyone else look cheap.",
  "{name} went over budget and over the line. Stuffing them with shame.",
  "{name}'s gift had more zeros than {name}'s respect for rules.",
  "Let the record show {name} chose violence (financially).",
  "{name} is now legally a Thanksgiving centerpiece.",
  "{name} heard \"Secret Santa\" and thought \"Secret Sugar Daddy\".",
  "Turkey Court hereby revokes {name}'s right to say \"it was on sale\".",
  "{name}, the gravy boat has sailed. You're roasted.",
  "{name} spent like the rent isn't due. It is. Gobble.",
  "Nobody: ... {name}: \"what if I just ignored the budget entirely\"",
  "{name} brought shame to the flock. Preheat the oven.",
  "{name} is the reason the cap exists and also the reason it failed.",
  "Sir/ma'am/legend {name}, put the credit card DOWN.",
  "{name}'s receipts have been entered into evidence. They are long.",
  "Turkey Court sentences {name} to buy the cheap gift next year. In public.",
  "{name} thinks $20 is the shipping fee.",
  "{name} out here flexing in a Secret Santa. Seasoned and sentenced.",
  "Even Santa thinks {name} went too far, and Santa owns a factory.",
];

export function roastFor(name, seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROASTS[h % ROASTS.length].replaceAll("{name}", name);
}
