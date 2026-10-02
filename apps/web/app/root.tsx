import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction, MetaFunction } from "react-router";
import appStyles from "@/styles/index.css?url";
import vazirmatn from "../../../packages/tailwind-config/fonts/Vazirmatn-Variable.woff2?url";

export const links: LinksFunction = () => [
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
