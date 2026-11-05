// Shop settings: prices and payment links for each challenge.
// Paste each Stripe Payment Link (or Razorpay page) into payLink when you have it.
// Leave payLink empty to show "Payment link coming soon".

export const SHOP = {
  currency: "$",
  website: "", // your challenges website, for "See all challenges" links
  // Shown on every challenge. The admin gives the prize from the Admin page.
  prize: "Most points at the end wins 1 month free",
  items: {
    "postholiday-2026": { price: "5.99", payLink: "" },
    "newyear-2027": { price: "9.99", payLink: "" },
    "christmas-2026": { price: "14.99", payLink: "" },
    "75day": { price: "19.99", payLink: "" },
    "winterarc-2026": { price: "24.99", payLink: "" },
  },
};
