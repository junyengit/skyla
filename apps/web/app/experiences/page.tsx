import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { ArrowLink, PublicHero, PublicPageShell } from "@/components/public-page-shell";
import { ExperienceInquiryClient } from "@/components/experience-inquiry-client";

export const metadata: Metadata = {
  title: "Experiences",
  description:
    "Explore Sky LA private rooms, date-night packages, champagne service, and event inquiry options above Los Angeles."
};

const stats = [
  ["24hr", "Event replies", "The events team follows up after accepted inquiries."],
  ["2-12", "Private rooms", "Flexible spaces for couples, families, and smaller groups."],
  ["6100", "Wilshire address", "One Miracle Mile location above Los Angeles."],
  ["360", "City views", "A full observation-deck backdrop for each visit."]
];

const barItems = [
  {
    name: "Champagne Toast",
    category: "Signature",
    price: "$28 / glass",
    image: "/images/bar.jpg",
    imageAlt: "Sky LA bar service",
    copy:
      "A chilled pour of house-selected Brut Champagne in the lounge, designed for the first toast above the city."
  },
  {
    name: "Champagne and Caviar",
    category: "Prestige",
    price: "From $145",
    image: "/images/champagne-caviar.jpg",
    imageAlt: "Champagne and caviar service",
    copy:
      "A bottle service moment with caviar, blinis, creme fraiche, and a personal host for a slower Sky LA visit."
  },
  {
    name: "Premium Beers",
    category: "On tap and bottled",
    price: "$12 - $16",
    image: "/images/beer.jpg",
    imageAlt: "Premium beer selection",
    copy:
      "Imported lagers and California craft ales selected for the bar, patio, and private-room service program."
  }
];

const datePerks = [
  "Priority entry and escorted arrival",
  "Reserved window seats at golden hour",
  "Champagne for two",
  "Seasonal board and dessert",
  "Keepsake photo print"
];

const roomCards = [
  {
    name: "The Family Suite",
    tag: "Private Suite",
    price: "$250 room fee",
    image: "/images/private-room.jpg",
    imageAlt: "Family Suite at Sky LA",
    copy:
      "A private enclosed room for up to 12 guests with a dedicated waitress, family-friendly drinks, and space away from the main lounge.",
    perks: [
      "Up to 12 guests",
      "Dedicated waitress",
      "Family drink and snack menu",
      "High chairs available"
    ]
  },
  {
    name: "Champagne Rooms",
    tag: "The Prestige Room",
    price: "From $350",
    image: "/images/lounge-suite.jpg",
    imageAlt: "Private Champagne Room with city views",
    copy:
      "Intimate rooms for two to eight guests with bottle service, curated small bites, a personal host, and deck access included.",
    perks: [
      "Two to eight guests",
      "Champagne bottle service",
      "Curated small bites",
      "Two-hour reserved block"
    ]
  }
];

export default function ExperiencesPage() {
  return (
    <PublicPageShell active="experiences">
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','27223205867364422');fbq('track','PageView');`}
      </Script>
      <Script src="/ads-config.js" strategy="afterInteractive" />
      <Script src="/ads-tracking.js?v=1" strategy="afterInteractive" />

      <PublicHero
        eyebrow="Curated experiences"
        title={
          <>
            Beyond
            <span>the View</span>
          </>
        }
        copy="Champagne service, craft drinks, private rooms, and curated evenings for two, all above Los Angeles."
        image="/images/lounge-window.webp"
        imageAlt="Sky LA lounge windows above Los Angeles"
        actions={<ArrowLink href="#reserve">Request Event Details</ArrowLink>}
      />

      <section className="experienceStats" aria-label="Experience highlights">
        {stats.map(([value, label, copy]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
            <p>{copy}</p>
          </div>
        ))}
      </section>

      <section className="experienceAnchorRow" aria-label="Experience sections">
        <Link href="#the-bar" prefetch={false}>
          The Bar
        </Link>
        <Link href="#date-night" prefetch={false}>
          Date Night
        </Link>
        <Link href="#private-rooms" prefetch={false}>
          Private Rooms
        </Link>
      </section>

      <section className="publicIntro experienceIntro">
        <div>
          <p className="sectionLabel">Experience program</p>
          <h2>Designed for slower arrivals, private moments, and hosted groups.</h2>
        </div>
        <p>
          The experience program is moving out of the legacy browser-storage
          path. Requests now go through a server API first, then into Convex
          when the secure database is connected.
        </p>
      </section>

      <section className="experienceSection" id="the-bar">
        <div className="publicBandHeader">
          <p className="sectionLabel">Sky LA bar</p>
          <h2>Premium pours above the city.</h2>
          <p>Bar service is planned for the main lounge and outdoor patios.</p>
        </div>
        <div className="experienceCardGrid">
          {barItems.map((item) => (
            <article className="experienceCard" key={item.name}>
              <Image src={item.image} alt={item.imageAlt} width={640} height={420} />
              <div>
                <p className="sectionLabel">{item.category}</p>
                <h3>{item.name}</h3>
                <p>{item.copy}</p>
                <strong>{item.price}</strong>
                <span>Coming soon</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="experienceFeature" id="date-night">
        <div className="experienceFeatureMedia">
          <Image src="/images/hero-lounge.jpg" alt="Sky LA lounge seating at dusk" fill sizes="(max-width: 820px) 100vw, 48vw" />
        </div>
        <div className="experienceFeatureCopy">
          <p className="sectionLabel">For two</p>
          <h2>The Date Experience</h2>
          <p>
            A curated evening above the city with reserved window seats,
            champagne on arrival, a seasonal board, dessert, and a keepsake
            photo.
          </p>
          <ul>
            {datePerks.map((perk) => (
              <li key={perk}>{perk}</li>
            ))}
          </ul>
          <div className="experiencePriceRow">
            <strong>$195</strong>
            <span>per couple, entry included</span>
          </div>
          <Link className="primaryAction" href="#reserve" prefetch={false}>
            Request Availability
          </Link>
        </div>
      </section>

      <section className="experienceSection" id="private-rooms">
        <div className="publicBandHeader">
          <p className="sectionLabel">Private rooms</p>
          <h2>Dedicated rooms for groups and hosted visits.</h2>
          <p>Private spaces can support family visits, champagne service, corporate events, and small celebrations.</p>
        </div>
        <div className="experienceRoomGrid">
          {roomCards.map((room) => (
            <article className="experienceRoom" key={room.name}>
              <div className="experienceRoomMedia">
                <Image src={room.image} alt={room.imageAlt} fill sizes="(max-width: 820px) 100vw, 50vw" />
              </div>
              <div className="experienceRoomCopy">
                <p className="sectionLabel">{room.tag}</p>
                <h3>{room.name}</h3>
                <p>{room.copy}</p>
                <ul>
                  {room.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <strong>{room.price}</strong>
              </div>
            </article>
          ))}
        </div>
        <div className="experienceNotice">
          <strong>Private events and full buyouts</strong>
          <span>
            Corporate events, milestone celebrations, and full-deck buyouts are
            available through the events team.
          </span>
        </div>
      </section>

      <section className="experienceInquiry" id="reserve">
        <div className="publicBandHeader">
          <p className="sectionLabel">Reserve an experience</p>
          <h2>Tell us what you are planning.</h2>
          <p>The form only shows success after the server accepts the inquiry.</p>
        </div>
        <ExperienceInquiryClient />
      </section>
    </PublicPageShell>
  );
}
