// Workout plans and videos for the Workouts page.
// Videos are YouTube videos found through search (title and ID from YouTube's listing).
// Minutes are approximate, taken from each video's title.

export const KINDS = {
  walk: { label: "Walking", type: "Walk", short: "Walk" },
  strength: { label: "Strength", type: "Strength", short: "Strength" },
  yoga: { label: "Yoga", type: "Yoga", short: "Yoga" },
  cardio: { label: "Cardio", type: "Cardio", short: "Cardio" },
  stretch: { label: "Stretching", type: "Stretching", short: "Stretch" },
  rest: { label: "Rest", type: "Rest day", short: "Rest" },
};

export const VIDEOS = [
  { id: "k_SoCdUlBvM", kind: "walk", title: "Beginner 1 Mile Walk", by: "Walk at Home", minutes: 15 },
  { id: "X3q5e1pV4pc", kind: "walk", title: "1 Mile Happy Walk", by: "Walk at Home", minutes: 15 },
  { id: "LqW9gdpctKE", kind: "strength", title: "20 Min Full Body Workout for Total Beginners (No Equipment)", minutes: 20 },
  { id: "uQhakL_3c8k", kind: "strength", title: "20 Min Beginner Standing Workout", minutes: 20 },
  { id: "v7AYKMP6rOE", kind: "yoga", title: "Yoga for Complete Beginners", by: "Yoga With Adriene", minutes: 20 },
  { id: "vNyJuQuuMC8", kind: "yoga", title: "20-Minute Yoga for Beginners", by: "Yoga With Adriene", minutes: 20 },
  { id: "3oitzTfujXs", kind: "cardio", title: "15 Min Beginner Cardio (No Jumping, Small Space)", minutes: 15 },
  { id: "mbIBSOlJNVE", kind: "cardio", title: "15 Minute HIIT Cardio at Home (Beginner Friendly)", minutes: 15 },
  { id: "COO2S7lPBzA", kind: "stretch", title: "10 Minute Total Body Stretch for Beginners", minutes: 10 },
  { id: "k7wCR3T8GO0", kind: "stretch", title: "10 Min Full Body Stretching, Easy for Beginners", minutes: 10 },
];

// week: Monday to Sunday
export const PLANS = [
  {
    id: "walk",
    name: "Walk More",
    level: "Beginner",
    perDay: "10–15 min a day",
    about: "Build a daily walking habit, with gentle stretching in between.",
    week: ["walk", "stretch", "walk", "stretch", "walk", "walk", "rest"],
  },
  {
    id: "strong",
    name: "Strong at Home",
    level: "Beginner to intermediate",
    perDay: "10–20 min a day",
    about: "Three no-equipment strength days, plus walking, stretching and cardio.",
    week: ["strength", "walk", "strength", "stretch", "strength", "cardio", "rest"],
  },
  {
    id: "yoga",
    name: "Yoga & Flexibility",
    level: "All levels",
    perDay: "10–20 min a day",
    about: "Feel calmer and less stiff. Good for busy or stressful weeks.",
    week: ["yoga", "stretch", "yoga", "walk", "yoga", "stretch", "rest"],
  },
  {
    id: "cardio",
    name: "Cardio Boost",
    level: "Intermediate",
    perDay: "15–20 min a day",
    about: "Get your heart pumping with short cardio sessions and some strength.",
    week: ["cardio", "strength", "cardio", "yoga", "cardio", "walk", "rest"],
  },
];
