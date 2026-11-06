// Local visual QA only: renders the existing checkout form while ticket sales
// stay locked. It changes nothing but the /checkout page render. Purchase APIs
// and the Convex gateway still enforce `siteConfig.launched`, so reviewing an
// order or starting payment keeps failing closed. Production builds and Vercel
// deployments never honor the flag.
export const localAdmissionPreviewFlag = "SKYLA_LOCAL_ADMISSION_PREVIEW";

type PreviewEnv = Partial<Record<"NODE_ENV" | "VERCEL" | typeof localAdmissionPreviewFlag, string>>;

export function localAdmissionPreviewEnabled(env: PreviewEnv = process.env) {
  return (
    env.NODE_ENV === "development" &&
    env.VERCEL !== "1" &&
    env[localAdmissionPreviewFlag] === "1"
  );
}
