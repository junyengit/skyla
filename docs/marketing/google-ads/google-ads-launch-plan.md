# Sky LA Google Ads Launch Plan

## Goal

Launch Google Ads around three conversion goals:

1. Ticket purchases on `checkout.html`
2. Private experience / event inquiries on `experiences.html#reserve`
3. Membership applications on `members.html#apply`

## Required Account Setup

- Business name: Sky LA
- Brand search aliases to keep: Sky Deck LA, Skyla Los Angeles, Sky LA rooftop
- Website: https://skydeckla.com/
- Location: 6100 Wilshire Blvd, Los Angeles, CA 90048
- Primary conversion: Purchase
- Secondary conversions: Event lead, membership lead, begin checkout
- Recommended daily launch budget: $125 to $250 total

## Tracking Setup

The site now includes a Vercel environment-backed Google Ads config route at `/ads-config.js` and a static helper at `apps/web/public/ads-tracking.js`. After creating Google Ads conversion actions, set these public Vercel environment variables for Preview and Production:

```bash
NEXT_PUBLIC_GOOGLE_ADS_TAG_ID=AW-XXXXXXXXX
NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION=AW-XXXXXXXXX/label
NEXT_PUBLIC_GOOGLE_ADS_EVENT_LEAD_CONVERSION=AW-XXXXXXXXX/label
NEXT_PUBLIC_GOOGLE_ADS_MEMBERSHIP_LEAD_CONVERSION=AW-XXXXXXXXX/label
NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION=AW-XXXXXXXXX/label
```

Leave an env var blank to disable that conversion event. Do not hard-code Google Ads IDs in `ads-tracking.js`.

Recommended conversion values:

- Purchase: dynamic checkout total
- Event lead: $250
- Membership lead: $250 to $1000 depending on tier
- Begin checkout: secondary observation only

## Campaign 1: Tickets - High Intent Search

Budget: $60 to $100/day

Landing page:
`https://skydeckla.com/checkout.html?utm_source=google&utm_medium=cpc&utm_campaign=tickets_search&utm_content={creative}&utm_term={keyword}`

Ad groups:

- LA observation deck
- Things to do in LA
- Best views in LA
- Sunset/date night LA
- Miracle Mile tourist attractions

Core keywords:

- "la observation deck"
- "los angeles observation deck"
- "best views in la"
- "rooftop views los angeles"
- "things to do in los angeles"
- "things to do near lacma"
- "things to do near academy museum"
- "date night los angeles"
- "sunset views los angeles"
- "los angeles skyline view"

Negative keywords:

- jobs
- hiring
- apartment
- apartments
- lease
- weather
- free
- map only
- construction
- office space
- skydeck chicago
- sears tower
- willis tower

## Campaign 2: Private Events - Lead Search

Budget: $40 to $80/day

Landing page:
`https://skydeckla.com/experiences.html?utm_source=google&utm_medium=cpc&utm_campaign=private_events_search&utm_content={creative}&utm_term={keyword}#reserve`

Ad groups:

- Private event venue
- Rooftop event venue
- Birthday/proposal venue
- Corporate event space

Core keywords:

- "private event space los angeles"
- "rooftop event venue los angeles"
- "private room los angeles"
- "birthday venue los angeles"
- "proposal venue los angeles"
- "corporate event venue los angeles"
- "private party venue la"
- "event space with city views los angeles"

## Campaign 3: Brand Search

Budget: $10 to $25/day

Landing page:
`https://skydeckla.com/?utm_source=google&utm_medium=cpc&utm_campaign=brand_search&utm_content={creative}&utm_term={keyword}`

Keywords:

- "sky deck la"
- "skydeck la"
- "skyla los angeles"
- "sky la rooftop"
- "skyla rooftop"

## Campaign 4: Performance Max

Launch after at least 20 to 30 conversions or after conversion tracking is verified.

Budget: $50 to $100/day

Asset groups:

- Tickets and skyline views
- Date night and golden hour
- Private rooms and events
- Membership

Use final URL expansion cautiously. Keep it focused on:

- `/`
- `/checkout.html`
- `/experiences.html`
- `/members.html`

## Responsive Search Ad Copy

Headlines:

- Sky LA Tickets
- Los Angeles Above It All
- 360 Views Of Los Angeles
- Rooftop Views On Wilshire
- Tickets From $29
- Golden Hour Above LA
- Date Night Above The City
- Visit LA's New Sky Deck
- Views Near LACMA
- Views Near Academy Museum
- Private Rooms Above LA
- Rooftop Event Space LA
- Book Sky LA
- Open Daily
- Skip The Usual Rooftop

Descriptions:

- See Los Angeles from a rooftop observation deck on Wilshire. Book timed-entry tickets online.
- Panoramic views, cafe, lounge, and golden-hour visits. Tickets start at $29.
- Plan a date night, weekend visit, or private celebration above Los Angeles.
- Reserve private rooms, champagne experiences, and group events with skyline views.

## Extensions / Assets

Sitelinks:

- Buy Tickets - https://skydeckla.com/checkout.html
- Private Experiences - https://skydeckla.com/experiences.html
- Membership - https://skydeckla.com/members.html
- Cafe And Lounge - https://skydeckla.com/cafe.html

Callouts:

- Tickets From $29
- Open Daily
- Timed Entry
- Cafe And Lounge
- Private Rooms
- Golden Hour Views

Structured snippets:

- Experiences: Observation Deck, Rooftop Cafe, Golden Hour, Private Rooms, Membership
- Nearby: LACMA, Academy Museum, Petersen Museum, Miracle Mile, Wilshire Blvd

## First 14 Days Optimization

- Day 1: Confirm `/ads-config.js` has production IDs, tags fire, and purchases/leads appear in Google Ads.
- Day 3: Pause keywords with high spend and no checkout/lead activity.
- Day 7: Split budget toward the best performing campaign.
- Day 10: Add search terms as exact match winners or negatives.
- Day 14: Launch Performance Max only if conversion tracking is verified.

## Pre-Launch Claim Review

Before enabling spend, verify public claims against the latest site and operations state:

- Ticket prices are still `$29` and `$37`.
- Hours and availability are current.
- The canonical public brand remains `Sky LA`, while search campaigns still capture `Sky Deck LA` and `Skyla Los Angeles` aliases.
- Private rooms, date night, bar service, and membership are intentionally advertised as lead-generating or coming-soon offers.
