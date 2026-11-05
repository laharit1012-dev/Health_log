// Challenges. Add a new one each month to keep things fresh.
//
// type "window": fixed dates. A day counts when it meets the rule; finish by
//   reaching `target` counted days between `start` and `end`.
// type "days": starts the day you join (or when access is given) and lasts `length` days;
//   finish by reaching `target` counted days.
// type "streak": starts the day you join; `length` days in a row that meet the
//   rule. Missing a day means starting again.
//
// rules (see challengeDayOK in app.js):
//   points50     – 50+ points that day
//   stepsWater   – step goal and water goal reached
//   stepsWorkout – step goal and workout goal reached
//   big3         – workout 30+ min, water goal and step goal reached
//   fast16 / fast23 / fast36 – a fast of 16+ / 23+ / 36+ hours ended that day

export const CHALLENGES = [
  {
    id: "christmas-2026",
    name: "Christmas Challenge",
    emoji: "🎄",
    type: "window",
    start: "2026-11-05",
    end: "2026-12-25",
    target: 35,
    rule: "points50",
    about: "Count down to Christmas: reach 50+ points on 35 days before Christmas.",
  },
  {
    id: "postholiday-2026",
    name: "Post-Holiday Reset",
    emoji: "🧃",
    type: "window",
    start: "2026-12-26",
    end: "2026-12-31",
    target: 6,
    rule: "stepsWater",
    about: "Reset after the feasts: reach your step and water goals every day this week.",
  },
  {
    id: "newyear-2027",
    name: "New Year Challenge",
    emoji: "🎆",
    type: "window",
    start: "2027-01-01",
    end: "2027-01-31",
    target: 25,
    rule: "stepsWorkout",
    about: "New year, new strength: reach your step goal and your workout goal on 25 days in January.",
  },
  {
    id: "winterarc-2026",
    name: "Winter Arc",
    emoji: "❄️",
    type: "window",
    start: "2026-11-01",
    end: "2027-02-28",
    target: 90,
    rule: "points50",
    about: "Build your summer body this winter: 90 days with 50+ points before March.",
  },
  {
    id: "75day",
    name: "75-Day Challenge",
    emoji: "🔥",
    type: "streak",
    length: 75,
    rule: "big3",
    about: "75 days in a row: work out 30+ minutes, reach your water goal and your step goal. Miss a day and you start again.",
  },
  // Fasting challenges: start the day you join; reach `target` fasting days within `length` days
  {
    id: "fast-if16",
    name: "Intermittent Fasting Challenge",
    emoji: "⏱️",
    type: "days",
    length: 21,
    target: 18,
    rule: "fast16",
    about: "21 days of 16:8 fasting: complete a 16-hour fast on 18 of the 21 days. Start and end each fast in the app.",
  },
  {
    id: "fast-omad",
    name: "One Meal a Day Challenge",
    emoji: "🍽️",
    type: "days",
    length: 21,
    target: 14,
    rule: "fast23",
    about: "21 days of OMAD: eat one meal a day, fasting 23 hours, on 14 of the 21 days.",
  },
  {
    id: "fast-36",
    name: "36-Hour Fast Challenge",
    emoji: "💧",
    type: "days",
    length: 28,
    target: 4,
    rule: "fast36",
    about: "4 weeks, 4 long fasts: complete a 36-hour fast once a week. For experienced fasters only; check with a doctor first.",
  },
];

export const RULE_TEXT = {
  points50: "50+ points",
  stepsWater: "step + water goals",
  stepsWorkout: "step + workout goals",
  big3: "30+ min workout, water + step goals",
  fast16: "a fast of 16+ hours",
  fast23: "a fast of 23+ hours (one meal a day)",
  fast36: "a fast of 36+ hours",
};
