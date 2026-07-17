import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listCafeItems, ticketPackages } from "@skyla/payments";
import { ArrowLink, PublicHero, PublicPageShell } from "@/components/public-page-shell";

export const metadata: Metadata = {
  title: "Cafe",
  description:
    "Sky LA cafe menu with ceremonial matcha, single-origin coffee, light bites, and Deck + Drink ticket upgrade pricing."
};

const descriptions: Record<string, string> = {
  m1: "Stone-ground ceremonial matcha with oat or whole milk. Served hot or iced.",
  m2: "Three preparations side by side: usucha, house latte, and hojicha.",
  m3: "Roasted Japanese green tea with brown sugar syrup and oat milk.",
  m4: "Ceremonial matcha over vanilla soft serve for a creamy dessert drink.",
  c1: "Brewed to order through a V60 with rotating small-batch roasters.",
  c2: "Cold-steeped concentrate with dark chocolate and oat milk.",
  c3: "A double shot cut with equal parts steamed whole milk.",
  c4: "Double espresso with steamed oat milk and a whisper of vanilla.",
  c5: "Single shot of the house espresso blend.",
  c6: "Double shot of the house espresso blend.",
  c7: "Double shot with foamed whole milk.",
  c8: "Ristretto shots with micro-foamed whole milk.",
  c9: "Double espresso stretched with hot water. Served hot or iced.",
  c10: "Double espresso over tonic water with lemon.",
  b1: "Classic French laminated dough, baked golden every morning.",
  b2: "Almond flour tea cake with ceremonial matcha.",
  b3: "Fudge-dense brownie made with dark chocolate.",
  b4: "Buttery shortcrust, vanilla custard, and seasonal fruit.",
  b5: "Light olive oil cake fragrant with California citrus.",
  b6: "Buttery shortbread with roasted hojicha and sea salt.",
  b7: "House oats, seasonal compote, granola, and coconut cream.",
  b8: "Sourdough, avocado, chili flake, microgreens, and lemon."
};

const categoryLabels = {
  matcha: {
    eyebrow: "The matcha program",
    title: "Ceremonial grade, always.",
    copy: "Prepared for morning clarity, golden-hour pauses, and slow sips by the glass."
  },
  coffee: {
    eyebrow: "The coffee program",
    title: "Single-origin and rotating.",
    copy: "Espresso drinks and pour-overs made to order, aligned with the same server-owned catalog as POS."
  },
  bites: {
    eyebrow: "Light bites",
    title: "Something to go with the view.",
    copy: "A simple pastry and snack list built for lingering without turning the deck into a dining room."
  }
} as const;

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(cents / 100);
}

const cafeGroups = listCafeItems()
  .reduce(
    (groups, item) => {
      groups[item.category].push(item);
      return groups;
    },
    { matcha: [], coffee: [], bites: [] } as Record<keyof typeof categoryLabels, Array<ReturnType<typeof listCafeItems>[number]>>
  );

export default function CafePage() {
  const drinkPackage = ticketPackages.drink;

  return (
    <PublicPageShell active="cafe">
      <PublicHero
        eyebrow="Sky LA top floor"
        title={
          <>
            Sip Above{" "}
            <span>the City</span>
          </>
        }
        copy="Handcrafted matcha, single-origin coffee, and light bites served with a 360-degree view of Los Angeles."
        image="/images/lounge-window.webp"
        imageAlt="Sky LA lounge windows above Los Angeles"
        actions={<ArrowLink href="/checkout?package=drink">Deck + Drink</ArrowLink>}
      />

      <section className="publicIntro cafeIntroNative">
        <div>
          <p className="sectionLabel">Cafe</p>
          <h2>Craft meets altitude, with simple transparent pricing.</h2>
        </div>
        <p>
          Choose a drink for the deck, settle into the lounge, or add the Deck
          + Drink package when you book your timed visit. The menu is made for
          lingering without turning the view into a formal dining room.
        </p>
      </section>

      <section className="cafeNativeGallery" aria-label="Cafe setting">
        <Image src="/images/lounge-couch.jpeg" alt="Sky LA curved lounge seating" width={560} height={380} />
        <Image src="/images/bar.jpg" alt="Sky LA bar and cafe counter" width={560} height={380} />
        <Image src="/images/view-westside.jpg" alt="Westside view from Sky LA" width={560} height={380} />
      </section>

      <section className="cafeMenuNative">
        {Object.entries(categoryLabels).map(([category, label]) => (
          <article key={category} className="cafeMenuGroup" id={category}>
            <div className="publicBandHeader">
              <p className="sectionLabel">{label.eyebrow}</p>
              <h2>{label.title}</h2>
              <p>{label.copy}</p>
            </div>
            <div className="cafeMenuGrid">
              {cafeGroups[category as keyof typeof categoryLabels].map((item) => (
                <div key={item.key} className="cafeMenuItem">
                  <div>
                    <h3>{item.name}</h3>
                    <p>{descriptions[item.key]}</p>
                  </div>
                  <strong>{money(item.priceCents)}</strong>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="publicCta">
        <div>
          <p className="sectionLabel">Upgrade</p>
          <h2>Add a drink package to your timed visit.</h2>
          <p>
            {drinkPackage.name} is {money(drinkPackage.priceCents)} and includes
            deck access plus one cafe drink.
          </p>
        </div>
        <div className="publicHeroActions">
          <ArrowLink href="/checkout?package=drink">Choose Deck + Drink</ArrowLink>
          <Link className="secondaryAction" href="/about" prefetch={false}>
            See the Space
          </Link>
        </div>
      </section>
    </PublicPageShell>
  );
}
