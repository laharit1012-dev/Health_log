// Shop settings: prices and payment links for each challenge, by region.
// People whose phone is set to India's time zone see the India prices (₹);
// everyone else sees the US prices ($). Nobody sees both.
// Paste each payment link into payLink when you have it
// (Stripe for US dollars, Razorpay for rupees).
// Leave payLink empty to show "Payment link coming soon".

export const SHOP = {
  website: "", // your challenges website, for "See all challenges" links
  // Shown on every challenge. The admin gives the prize from the Admin page.
  prize: "Most points at the end wins 1 month free",
  regions: {
    US: {
      currency: "$",
      items: {
        "postholiday-2026": { price: "5.99", payLink: "" },
        "newyear-2027": { price: "9.99", payLink: "" },
        "christmas-2026": { price: "14.99", payLink: "" },
        "75day": { price: "19.99", payLink: "" },
        "winterarc-2026": { price: "24.99", payLink: "" },
        "fast-if16": { price: "9.99", payLink: "" },
        "fast-omad": { price: "12.99", payLink: "" },
        "fast-36": { price: "12.99", payLink: "" },
      },
    },
    IN: {
      currency: "₹",
      items: {
        "postholiday-2026": { price: "99", payLink: "" },
        "newyear-2027": { price: "199", payLink: "" },
        "christmas-2026": { price: "249", payLink: "" },
        "75day": { price: "399", payLink: "" },
        "winterarc-2026": { price: "449", payLink: "" },
        "fast-if16": { price: "199", payLink: "" },
        "fast-omad": { price: "249", payLink: "" },
        "fast-36": { price: "249", payLink: "" },
      },
    },
  },
};

// India if the phone's time zone is India's; otherwise US prices
export function shopRegion() {
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
  return tz === "Asia/Kolkata" || tz === "Asia/Calcutta" ? "IN" : "US";
}

// { currency, price, payLink } for one challenge, in this person's region
export function shopItem(id, region = shopRegion()) {
  const r = SHOP.regions[region] || SHOP.regions.US;
  const item = r.items[id] || {};
  return { currency: r.currency, price: item.price ?? null, payLink: item.payLink || "" };
}
