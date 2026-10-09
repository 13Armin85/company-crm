import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";
import appStyles from "@/styles/index.css?url";
import vazirmatn from "@plane/tailwind-config/fonts/Vazirmatn-Variable.woff2?url";
import { COMPANY_BRAND_VERSION } from "@plane/constants";
import appleTouchIcon from "@/app/assets/favicon/apple-touch-icon.png?url";
import favicon16 from "@/app/assets/favicon/favicon-16x16.png?url";
import favicon32 from "@/app/assets/favicon/favicon-32x32.png?url";
import faviconIco from "@/app/assets/favicon/favicon.ico?url";

export const links: LinksFunction = () => [
  { rel: "icon", type: "image/png", sizes: "32x32", href: favicon32 },
  { rel: "icon", type: "image/png", sizes: "16x16", href: favicon16 },
  { rel: "shortcut icon", href: faviconIco },
  { rel: "apple-touch-icon", sizes: "180x180", href: appleTouchIcon },
  { rel: "manifest", href: `/site.webmanifest.json?v=${COMPANY_BRAND_VERSION}` },
  { rel: "stylesheet", href: appStyles },
  { rel: "preload", href: vazirmatn, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
];

export const meta: MetaFunction = () => [
  { title: "هم‌کار | مدیریت هوشمند پروژه‌ها" },
  { name: "description", content: "سامانه یکپارچه مدیریت پروژه، وظایف و تیم" },
  { name: "theme-color", content: "#111827" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "خطای پیش‌بینی‌نشده‌ای رخ داد.";
  return (
    <main className="fatal-error">
      <span>!</span>
      <h1>مشکلی پیش آمد</h1>
      <p>{message}</p>
      <button onClick={() => window.location.reload()}>تلاش دوباره</button>
    </main>
  );
}
