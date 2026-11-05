import type { Metadata } from "next";
import { currentLiabilityWaiverVersion } from "@skyla/payments";
import { siteConfig } from "@skyla/config";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Liability Waiver and Assumption of Risk",
  description:
    "Sky LA's pre-launch acknowledgment of risk and release of liability for observation deck visits."
};

export default function LiabilityWaiverPage() {
  return (
    <LegalPage
      title="Liability Waiver And Assumption Of Risk"
      updated="August 6, 2026"
      intro={
        <>
          <p>
            <strong>Pre-launch attorney-review draft.</strong> This waiver is not
            effective and ticket sales remain unavailable until California venue
            counsel approves the final document.
          </p>
          <p>Document version: {currentLiabilityWaiverVersion}</p>
          <p>
            Please read carefully. The final agreement will affect legal rights
            and is intended to include a release of claims arising from ordinary
            negligence to the fullest extent permitted by California law.
          </p>
        </>
      }
      sections={[
        {
          title: "Visit And Participants",
          body: (
            <p>
              This agreement applies to a ticketed visit to the elevated outdoor
              observation deck, indoor lounge, and visitor areas operated as Sky
              LA at {siteConfig.address.full}. It covers only the adult accepting
              it and any minor that adult is legally authorized to represent. One
              purchaser cannot accept a waiver for another adult.
            </p>
          )
        },
        {
          title: "Voluntary Visit And Authority",
          items: [
            "I voluntarily choose to participate in the visit and represent that I am at least 18 years old.",
            "If I accept for a minor, I represent that I am the minor's parent or court-appointed legal guardian and have authority to act for that minor.",
            "I understand that every other adult guest must separately accept the final waiver before admission."
          ]
        },
        {
          title: "Acknowledgment Of Risks",
          items: [
            "Elevators, stairs, evacuation from an upper floor, steps, thresholds, glass, railings, wet or uneven surfaces, glare, slips, trips, and falls.",
            "Wind, rain, heat, cold, sun, changing weather, reduced visibility, and windblown or falling objects in outdoor areas.",
            "Crowd movement, collisions, the conduct of other visitors, food or beverage allergens, hot beverages, broken containers, and spills.",
            "Illness, medical events, delayed emergency access associated with an upper-floor location, and other risks reasonably associated with an observation deck and lounge."
          ]
        },
        {
          title: "Assumption Of Inherent Risks",
          body: (
            <p>
              I knowingly and voluntarily assume the inherent and reasonably
              foreseeable risks of the visit, whether known or unknown, except
              to the extent a risk results from conduct that cannot lawfully be
              released.
            </p>
          )
        },
        {
          title: "Release Of Ordinary-Negligence Claims",
          body: (
            <p>
              <strong>
                To the fullest extent permitted by California law, I release and
                agree not to sue the parties identified in the final, approved
                waiver for claims for bodily injury, death, or property damage
                arising from their ordinary negligence in connection with the
                visit.
              </strong>
            </p>
          )
        },
        {
          title: "Claims Not Released",
          body: (
            <p>
              This agreement does not release or limit liability for gross
              negligence, recklessness, intentional or willful misconduct,
              fraud, violation of law, or any right or remedy that cannot legally
              be waived. It does not waive rights under the California Consumer
              Legal Remedies Act.
            </p>
          )
        },
        {
          title: "Safety And Emergency Assistance",
          items: [
            "I agree to follow posted rules and reasonable staff instructions, supervise minors in my care, remain in visitor areas, and not climb, sit, lean, or place objects on barriers.",
            "I authorize Sky LA to contact emergency responders and share reasonably available information needed for emergency assistance.",
            "I understand that this authorization does not require Sky LA to provide medical care or release negligent medical treatment."
          ]
        },
        {
          title: "California Law And Severability",
          body: (
            <p>
              California law governs the final agreement. An unenforceable
              provision will be narrowed or severed only to the minimum extent
              necessary, and the remaining provisions will continue in effect.
            </p>
          )
        },
        {
          title: "Electronic Acceptance",
          items: [
            "I will have an opportunity to read the entire approved agreement before payment.",
            "I understand that the approved agreement releases claims arising from ordinary negligence.",
            "I agree to conduct the transaction electronically and may request a copy of the accepted agreement.",
            "The acceptance record will identify the document version, order, purchaser, and server-recorded date and time."
          ]
        },
        {
          title: "Contact",
          body: (
            <p>
              Questions about this draft? Email us at{" "}
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
            </p>
          )
        }
      ]}
    />
  );
}
