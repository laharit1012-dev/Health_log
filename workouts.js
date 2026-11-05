// Workout plans and videos for the Workouts page.
// Videos are YouTube videos found through search (title and ID from YouTube's listing).
// Minutes are approximate, taken from each video's title.

export const KINDS = {
  walk: { label: "Walking", type: "Walk", short: "Walk" },
  strength: { label: "Full body", type: "Strength", short: "Full" },
  upper: { label: "Upper body", type: "Strength", short: "Upper" },
  lower: { label: "Lower body", type: "Strength", short: "Lower" },
  core: { label: "Core", type: "Strength", short: "Core" },
  cardio: { label: "Cardio", type: "Cardio", short: "Cardio" },
  pilates: { label: "Pilates", type: "Pilates", short: "Pilates" },
  yoga: { label: "Yoga", type: "Yoga", short: "Yoga" },
  gentle: { label: "Period yoga", type: "Yoga", short: "Gentle" },
  stretch: { label: "Stretching", type: "Stretching", short: "Stretch" },
  rest: { label: "Rest", type: "Rest day", short: "Rest" },
};

export const VIDEOS = [
  { id: "k_SoCdUlBvM", kind: "walk", title: "Beginner 1 Mile Walk", by: "Walk at Home", minutes: 15 },
  { id: "X3q5e1pV4pc", kind: "walk", title: "1 Mile Happy Walk", by: "Walk at Home", minutes: 15 },
  { id: "LqW9gdpctKE", kind: "strength", title: "20 Min Full Body Workout for Total Beginners (No Equipment)", minutes: 20 },
  { id: "uQhakL_3c8k", kind: "strength", title: "20 Min Beginner Standing Workout", minutes: 20 },
  { id: "n4PwnazY_GM", kind: "upper", title: "20 Min Total Upper Body Workout (No Equipment, Beginner Friendly)", minutes: 20 },
  { id: "vH7il0_ueFw", kind: "upper", title: "20 Min Beginner Calisthenics Upper Body & Core", minutes: 20 },
  { id: "5UL64BUxnXA", kind: "lower", title: "20 Min Legs and Glutes Workout (Beginner, No Equipment)", minutes: 20 },
  { id: "dg2wzHf8vY4", kind: "lower", title: "20 Min No Squat/Lunge Leg Workout (Knee Friendly)", minutes: 20 },
  { id: "5En7m2C1qNk", kind: "core", title: "10 Minute Core Workout for Beginners", minutes: 10 },
  { id: "eQdX2_k8FIM", kind: "core", title: "10 Min Beginner Total Core Workout (No Equipment)", minutes: 10 },
  { id: "3oitzTfujXs", kind: "cardio", title: "15 Min Beginner Cardio (No Jumping, Small Space)", minutes: 15 },
  { id: "mbIBSOlJNVE", kind: "cardio", title: "15 Minute HIIT Cardio at Home (Beginner Friendly)", minutes: 15 },
  { id: "wHOqfqXbrbA", kind: "pilates", title: "20 Min Absolute Beginner Pilates", minutes: 20 },
  { id: "xU3vDlJPrs4", kind: "pilates", title: "20 Min Beginner's Pilates Workout (Full Body, No Equipment)", minutes: 20 },
  { id: "v7AYKMP6rOE", kind: "yoga", title: "Yoga for Complete Beginners", by: "Yoga With Adriene", minutes: 20 },
  { id: "vNyJuQuuMC8", kind: "yoga", title: "20-Minute Yoga for Beginners", by: "Yoga With Adriene", minutes: 20 },
  { id: "86MZrQpGrzA", kind: "gentle", title: "15 Minute Yoga for Your Period (Cramps, Bloating, PMS)", minutes: 15 },
  { id: "COO2S7lPBzA", kind: "stretch", title: "10 Minute Total Body Stretch for Beginners", minutes: 10 },
  { id: "k7wCR3T8GO0", kind: "stretch", title: "10 Min Full Body Stretching, Easy for Beginners", minutes: 10 },
];

// for: who the plan is offered to ("female", "male" or "all")
// week: Monday to Sunday. The Cycle Sync plan follows her cycle phase instead (see PHASE_WORKOUTS).
export const PLANS = [
  {
    id: "cycle",
    for: "female",
    name: "Cycle Sync",
    level: "All levels",
    perDay: "10–20 min a day",
    about: "Workouts matched to your cycle phase: gentle during your period, stronger as your energy rises.",
    phased: true,
  },
  {
    id: "upperlower",
    for: "male",
    name: "Upper / Lower Split",
    level: "Beginner to intermediate",
    perDay: "15–20 min a day",
    about: "Alternate upper body and lower body days, with cardio and a walk.",
    week: ["upper", "lower", "cardio", "upper", "lower", "walk", "rest"],
  },
  {
    id: "fullbody",
    for: "male",
    name: "Full Body Strength",
    level: "Beginner",
    perDay: "10–20 min a day",
    about: "Three full-body strength days a week, with core and cardio in between.",
    week: ["strength", "core", "strength", "cardio", "strength", "walk", "rest"],
  },
  {
    id: "corecardio",
    for: "male",
    name: "Core & Cardio",
    level: "Beginner to intermediate",
    perDay: "10–15 min a day",
    about: "Short core and cardio sessions to build fitness and a strong middle.",
    week: ["core", "cardio", "core", "walk", "cardio", "core", "rest"],
  },
  {
    id: "strong",
    for: "female",
    name: "Strong at Home",
    level: "Beginner to intermediate",
    perDay: "10–20 min a day",
    about: "Three no-equipment strength days, plus walking, stretching and cardio.",
    week: ["strength", "walk", "lower", "stretch", "upper", "cardio", "rest"],
  },
  {
    id: "walk",
    for: "all",
    name: "Walk More",
    level: "Beginner",
    perDay: "10–15 min a day",
    about: "Build a daily walking habit, with gentle stretching in between.",
    week: ["walk", "stretch", "walk", "stretch", "walk", "walk", "rest"],
  },
  {
    id: "yoga",
    for: "all",
    name: "Yoga & Flexibility",
    level: "All levels",
    perDay: "10–20 min a day",
    about: "Feel calmer and less stiff. Good for busy or stressful weeks.",
    week: ["yoga", "stretch", "yoga", "walk", "pilates", "stretch", "rest"],
  },
  {
    id: "cardio",
    for: "all",
    name: "Cardio Boost",
    level: "Intermediate",
    perDay: "15–20 min a day",
    about: "Get your heart pumping with short cardio sessions and some strength.",
    week: ["cardio", "core", "cardio", "yoga", "cardio", "walk", "rest"],
  },
];

// Cycle Sync: what to do in each phase. The day's workout rotates through the list.
export const PHASE_WORKOUTS = {
  menstrual: ["gentle", "walk", "stretch", "yoga", "walk"],
  follicular: ["strength", "cardio", "lower", "upper", "core", "cardio", "walk"],
  ovulation: ["cardio", "strength", "lower"],
  luteal: ["pilates", "walk", "core", "yoga", "lower", "pilates", "stretch", "walk"],
  late: ["walk", "gentle", "stretch"],
};

export const PHASE_TIPS = {
  menstrual: "Go gentle. Easy yoga, stretching and walks can help with cramps. Rest if you need to.",
  follicular: "Energy is rising. A great time to build strength and try harder workouts.",
  ovulation: "Energy often peaks now. Go for your strongest sessions, like cardio and strength.",
  luteal: "Energy may dip as this phase goes on. Keep moving at a moderate pace with Pilates, core work and walks.",
  late: "Your period may be due. Keep it gentle and listen to your body.",
};
