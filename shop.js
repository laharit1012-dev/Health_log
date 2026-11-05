// Shop settings: prices and payment links for each challenge.
// Paste each Razorpay Payment Page / Stripe Payment Link into payLink when you have it.
// Leave payLink empty to show "Payment link coming soon".

export const SHOP = {
  currency: "₹",
  website: "",
  // Shown on every challenge. The admin gives the prize from the Admin page.
  prize: "Most points at the end wins 1 month free", // your challenges website, for "See all challenges" links
  items: {
    "christmas-2026": { price: 249, payLink: "" },
    "postholiday-2026": { price: 99, payLink: "" },
    "newyear-2027": { price: 199, payLink: "" },
    "winterarc-2026": { price: 449, payLink: "" },
    "75day": { price: 399, payLink: "" },
  },
};
