"use client";

import { SignIn } from "@clerk/nextjs";

export function StaffSignIn({ returnTo }: { returnTo: "/admin" | "/pos" | "/pos-next" }) {
  return (
    <SignIn
      path="/staff-sign-in"
      routing="path"
      forceRedirectUrl={returnTo}
      appearance={{
        variables: {
          colorBackground: "#0c0d10",
          colorForeground: "#ffffff",
          colorInput: "#111216",
          colorInputForeground: "#ffffff",
          colorPrimary: "#d8b653"
        }
      }}
    />
  );
}
