// Writing: dialogue variants and the park's own background awfulness.
// Several ambient lines are lifted (paraphrased) from real 1-star reviews and
// local news about Midwest parks.

export const AMBIENT = [
  "A “Fright Fest-ish” banner falls over. Nobody picks it up.",
  "The one Halloween decoration, an inflatable ghost, slowly deflates.",
  "The churro cart is out of churros. It is 11 AM.",
  "A ride op reads the safety spiel at half speed. With feeling.",
  "The app lists every ride as open. Several are on fire, metaphorically.",
  "Water is now $4.50. The water fountain has been “being fixed” since 2019.",
  "A guest is offered a souvenir cup as compensation for a three-ride day. He accepts.",
  "The coaster that's been “reopening soon” for three years gets a new fence.",
  "A Haunt monster eats a pretzel on a bench, fully visible, in full costume.",
  "Somewhere, a gate stays shut until the station is completely, spiritually empty.",
  "Guest Relations thanks someone for their patience. That's the fourth time today.",
  "A sign reads “Under New Management.” Under it, an older sign reads the same thing.",
  "The queue fans are on. The fans are not plugged in.",
  "Someone posts a 1-star review from inside the park. It gets 40 likes.",
  "A ride that “failed to open repeatedly” opens. It's 7:30 PM.",
  "An employee explains that's the old company's policy. Nobody knows which old company.",
];

/**
 * Dialogue variants. {A} = the speaker, {B} = the other one. Other {keys} are
 * filled by the caller. Keep several per key so repeat days don't feel canned.
 */
export const LINES: Record<string, string[]> = {
  soaked: [
    `{A}: "I am wet in places I didn't know I had."`,
    `{A}: "We were WALKING. Past it. Why is the walkway a splash zone?"`,
    `{A}: "My phone is in a Ziploc and it is STILL wet."`,
  ],
  surveyStart: [
    `{A}: "I—sure. Quick, right?"`,
    `{A}: "Oh. Okay. How many questions is it?"`,
    `{A}: "We kind of have a show to— okay. Sure."`,
  ],
  surveyEnd: [
    `{A}: "That was NOT a quick survey."`,
    `{A}: "Question 41 was just him asking if we were having fun. Repeatedly."`,
    `{A}: "He gave us a pen. The pen doesn't work."`,
  ],
  churro: [
    `{A}: "Oh! A free churro. Thank you, sweetie."`,
    `{A}: "A comp churro? See, {B}, they DO care."`,
    `{A}: "It's stale, but it's free."`,
  ],
  voucher: [
    `{A}: "A free FastPass? Okay, this place isn't ALL bad."`,
    `{A}: "We get to skip the line? Best employee in the park."`,
  ],
  jam: [
    `{A}: "It's been roaring at us for twenty minutes. It's looking at me."`,
    `{A}: "The T-Rex has said 'RAWR' 340 times. I've been counting."`,
    `{A}: "The car stopped right at its mouth. It's animatronic but I can SMELL it."`,
  ],
  app: [
    `{A}: "The app says we were never in line. We've been standing here 30 minutes."`,
    `{A}: "It says 'We're aware of the issue.' Are they? ARE they?"`,
    `{A}: "The app logged us out and now it wants my blood type."`,
  ],
  closedFront: [
    `{A}: "We were RIGHT THERE. {min} minutes!"`,
    `{A}: "We could see the SEATS, {B}. I could touch the seat."`,
    `{A}: "{min} minutes and they close it as we hit the gate? They waited for us. They WAITED."`,
    `{A}: "The guy said 'technical difficulties' and then just… left."`,
  ],
  closedEarly: [
    `{A}: "It's closing? We just got in line."`,
    `{A}: "Oh, come ON. We were barely in."`,
  ],
  foodKicked: [
    `{A}: "They're kicking us out mid-bite?"`,
    `{A}: "I had ONE fry left."`,
  ],
  mimed: [
    `{A}: "Did it… beep? Is that a yes?"`,
    `{A}: "He just went 'boop' with his mouth. Are we in?"`,
    `{A}: "That's not a scanner, {B}. That's a stapler."`,
  ],
  leaving: [
    `{A}: "That's it. We're going home."`,
    `{A}: "I'm done. I'm DONE. Get the car."`,
    `{A}: "We're leaving. I'm writing a review in the parking lot."`,
  ],
  needRestroom: [
    `{A}: "I gotta find a bathroom."`,
    `{A}: "Bathroom. Now. This is not a drill."`,
    `{A}: "Hold my funnel cake. I need a restroom."`,
  ],
  reride: [
    `{A}: "{name}? Why not."`,
    `{A}: "Let's do {name} while the line's short."`,
    `{A}: "{name}! I think. Is that the one with the thing?"`,
  ],
  closedArrive: [
    `{A}: "Closed?! We walked all the way here."`,
    `{A}: "'Temporarily closed.' The sign is laminated. LAMINATED, {B}."`,
    `{A}: "The app said it was open. The app LIES."`,
  ],
  longWait: [
    `{A}: "{min} minutes?! …Fine."`,
    `{A}: "{min} minutes. We could drive to Topeka in {min} minutes."`,
    `{A}: "The sign says {min} minutes. The sign is an optimist."`,
  ],
  foodClosed: [
    `{A}: "Closed? I'm going to eat my own arm."`,
    `{A}: "There's a sign that says 'Back in 15.' It's dusty."`,
    `{A}: "The ONE food place nearby. Of course."`,
  ],
  dumpster: [
    `{A}: "I am going behind that dumpster. Don't look."`,
    `{A}: "There's a bush. I'm going to the bush. Do not follow me, {B}."`,
  ],
  restroomClosed: [
    `{A}: "OUT OF ORDER?! Where's the next one?"`,
    `{A}: "Both of them? BOTH stalls?"`,
    `{A}: "It's locked. Is someone in there? No. It's just locked."`,
  ],
  lateShow: [
    `{A}: "It already STARTED? They won't let us in?!"`,
    `{A}: "We missed it. We missed it because of a SURVEY."`,
  ],
  cashOnly: [
    `{A}: "Cash only? Who carries cash?"`,
    `{A}: "The card reader is 'down.' I can SEE that it's not plugged in."`,
  ],
  merchDone: [`{A}: "We look SO cute."`, `{A}: "Matching! Take a picture, {B}."`],
  showCancelled: [
    `{A}: "Cancelled? We waited out here for nothing!"`,
    `{A}: "The star 'called in sick.' The sign is in Comic Sans."`,
  ],
  timeshareStart: [
    `{A}: "Wait. This isn't the show. Why is there a guy with a clicker?"`,
    `{A}: "Why are they handing out clipboards? Is this a… seminar?"`,
  ],
  timeshareEnd: [
    `{A}: "We now own one week a year in Branson."`,
    `{A}: "I don't know how, but I signed something. {B}, I signed something."`,
  ],
  showDone: [`{A}: "That was a NATIONAL TREASURE."`, `{A}: "I cried. I'm not ashamed."`],
  veg: [
    `Deb: "Why does my vegan burger have a BONE in it?"`,
    `Deb: "The guy said it's 'basically vegan.' It's a pork tenderloin, Gary."`,
    `Deb: "Excuse me, is this… is this BACON? In the vegan wrap?"`,
  ],
  lunchOk: [`{A}: "Huh. It's actually not bad."`, `{A}: "Fourteen dollars, but it's food."`],
  foodBad: [
    `{A}: "This corn dog is cold in the middle."`,
    `{A}: "The fries are soggy AND somehow stale."`,
    `{A}: "These chicken tenders fought back."`,
  ],
  queasy: [
    `{A}: "Those teacups were set to… industrial."`,
    `{A}: "I can't feel my face. I can't feel {B}'s face."`,
  ],
  rideDone: [`{A}: "WOOO! Again!"`, `{A}: "Okay, THAT was worth it."`, `{A}: "My hair! Did you see my hair?"`],
  dj: [
    `{A}: "Is this the same song? It's the SAME SONG."`,
    `{A}: "If I hear 'Glitter Drop (Extended Mix)' one more time…"`,
  ],
  detour: [
    `{A}: "Wet floor? Again? We have to go AROUND."`,
    `{A}: "It's 80 degrees and sunny. Why is the floor wet?"`,
  ],
  parade: [
    `{A}: "A parade? It's four people and a golf cart. We can't get past it."`,
    `{A}: "The parade is one float. The float is a trailer. The trailer is stuck."`,
  ],
  upcharge: [
    `{A}: "It's $25 MORE? We have season passes!"`,
    `{A}: "They called it an 'exciting new evolution.' It's a paywall, {B}."`,
  ],
  locker: [
    `{A}: "The locker charges by the minute? The LINE is why we're here so long!"`,
    `{A}: "Our bag came out the OTHER side. How is there an other side?"`,
  ],
  complainGo: [
    `{A}: "That's it. We're going to Guest Relations."`,
    `{A}: "I want to speak to someone. Anyone. A manager. A raccoon."`,
  ],
  complainOk: [
    `{A}: "They gave us a free souvenir cup. I feel… better? Weirdly?"`,
    `{A}: "Guest Relations was actually nice. Okay. We'll stay."`,
  ],
  complainBad: [
    `{A}: "They said that's the OLD company's policy. Which old company?!"`,
    `{A}: "We got a gift card. For 20% of a souvenir cup."`,
    `{A}: "She thanked us for our patience four times and then closed the window."`,
  ],
};
