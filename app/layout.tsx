import type { Metadata, Viewport } from "next";
import { DESC, KEYWORDS, TITLE } from "@/lib/shim/site-defaults";


// the reference page's own keywords (used while «الكلمات الدلاليه» is empty)

// static defaults (the control panel /cp uses them); the chat page sets its own from the settings (app/page.tsx generateMetadata)
export const metadata: Metadata = {
  title: TITLE, description: DESC, keywords: KEYWORDS,
  openGraph: { title: TITLE, description: DESC, images: ["/prv1.png"] },
  other: { google: "notranslate" },
  icons: { icon: "/favicon.ico" },
};


// Same as the original: a fixed 400px-wide mobile layout.
// initialScale: undefined drops the initial-scale=1 Next adds by default. With it, a phone narrower than 400px (e.g. 360) shows only 360px of the 400px layout and the user has to pinch it smaller;
// without it the browser fits the 400px layout to the screen, as the original markup does (the original is exactly: width=400, maximum-scale=5).
export const viewport: Viewport = { width: 400, initialScale: undefined, maximumScale: 5 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The original document is lang="ar" with no dir attribute; keep it identical.
    <html lang="ar" style={{ height: "100%" }}>
      <head>
        {/* Original stylesheets, copied verbatim from the reference site (public/css). */}
        <link rel="stylesheet" href="/css/legacy-1.css" />
        <link rel="stylesheet" href="/css/legacy-2.css" />
        <link rel="stylesheet" href="/css/legacy-3.css" />
        <link rel="stylesheet" href="/css/legacy-4.css" />
        {/* Inline `!important` declarations from the original markup (React cannot express them in style=). */}
        <link rel="stylesheet" href="/css/legacy-imp.css" />
        {/* Phone stage (added): below 600px the page is a 400px column scaled to the screen. Nothing applies at 600px and wider. */}
        <link rel="stylesheet" href="/css/phone-stage.css" />
        {/* the colours and «كود head» tags come from the page (app/page.tsx), which knows the domain it was asked from */}
      </head>
      <body
        className="bg"
        style={{
          backgroundColor: "#40404f",
          height: "100%",
          maxHeight: "100%",
          minHeight: "100%",
          margin: 0,
          padding: 0,
          overflow: "hidden",
        }}
      >
        {children}
      </body>
    </html>
  );
}
