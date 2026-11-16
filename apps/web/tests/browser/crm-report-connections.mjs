/* eslint-disable no-await-in-loop -- The browser scenarios share a page and select a working day by checking candidates sequentially. */
/** Local integration only: record one tagged absence, verify reports, end it through the UI. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(resolve(".cache/browser/node_modules/playwright/index.mjs")).href);
const base = "http://localhost:3005",
  authBase = "http://localhost:3000";
const env = Object.fromEntries(
  (await readFile(".env.dev", "utf8"))
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const at = l.indexOf("=");
      return [l.slice(0, at), l.slice(at + 1).replace(/^(['"])(.*)\1$/, "$2")];
    })
);
const slug = env.INTERNAL_WORKSPACE_SLUG || "dev-workspace";
const output = resolve("tmp/report-connections-browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fa-IR" });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(180000);
const checks = [],
  errors = [],
  failures = [];
let signedIn = false,
  absenceId,
  ended = false;
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (signedIn && r.status() >= 400) failures.push({ path: new URL(r.url()).pathname, status: r.status() });
});
// The existing local API trusts port 3000; the separate Vite preview serves the same code at 3005.
await page.route(base + "/api/**", (route) => {
  const r = route.request();
  return route.continue(
    ["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) ? { headers: { ...r.headers(), origin: authBase } } : {}
  );
});
const check = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
async function json(response, status = 200) {
  assert.equal(response.status(), status, (await response.text()).slice(0, 600));
  return response.json();
}
async function api(path, method = "GET", data) {
  const csrf = await json(await context.request.get(authBase + "/auth/get-csrf-token/"));
  return context.request.fetch(authBase + `/api/workspaces/${slug}/` + path, {
    method,
    headers: { "X-CSRFTOKEN": csrf.csrf_token },
    ...(data ? { data } : {}),
  });
}
async function navigate(path, title, first = false) {
  if (first) await page.goto(base + path);
  else
    await page.evaluate((nextPath) => {
      history.pushState({}, "", nextPath);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  await page.waitForFunction(
    (expectedTitle) =>
      document.querySelector(".page-content h1")?.textContent.includes(expectedTitle) &&
      !document.querySelector(".page-content .skeleton-row"),
    title
  );
}
try {
  await page.goto(authBase + "/login");
  await page.locator("input[name=email]").fill(env.DEV_ADMIN_EMAIL);
  await page.locator("input[name=password]").fill(env.DEV_ADMIN_PASSWORD);
  await page.locator(".auth-submit").click();
  await page.locator(".app-shell").waitFor();
  signedIn = true;
  const me = await json(await context.request.get(authBase + "/api/users/me/"));
  const catalog = await json(await api("reports/sources/"));
  for (const code of ["leave", "records", "projects", "portal_requests"])
    assert(catalog.sources.some((s) => s.code === code));
  for (const source of catalog.sources)
    await json(await api("reports/run/", "POST", { source: source.code, definition: source.default }));
  check("every report source executes successfully against the actual local API");
  const today = await json(await api("daily-reports/today/"));
  let day;
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(today.date + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    const candidate = await json(await api(`daily-reports/day/${key}/`));
    if (candidate.schedule.is_working && !candidate.leaves.length && !(candidate.absences || []).length) {
      day = candidate;
      break;
    }
  }
  assert(day, "A recent working day without absence is required");
  const tag = "آزمون اتصال گزارش " + Date.now();
  const created = await json(
    await api("organization/absences/", "POST", {
      user: me.id,
      starts_at: day.date + "T" + day.schedule.start + "+03:30",
      ends_at: day.date + "T" + day.schedule.end + "+03:30",
      reason: tag,
    }),
    201
  );
  absenceId = created.id;
  const reread = await json(await api(`daily-reports/day/${day.date}/`));
  assert.equal(reread.requirement, "not_required");
  assert(reread.absences.some((a) => a.id === absenceId));
  check("a real absence recorded in the organization immediately updates daily-report context");
  await navigate("/reports/source/leave", "مرخصی و عدم حضور", true);
  const row = page.locator(".rp-table tbody tr").filter({ has: page.locator(`a[href='/edit/leave/${absenceId}']`) });
  await row.waitFor();
  assert.equal(await row.count(), 1);
  await page.locator(".rp-connections a[href='/absences']").waitFor();
  await page.screenshot({ path: resolve(output, "leave-report-desktop.png") });
  check("recorded absence appears once in the leave report and links to its original form");
  await navigate(`/daily-report?date=${day.date}`, "گزارش کار روزانه");
  await page.locator('[aria-label="عدم حضور ثبت‌شدهٔ این روز"]').waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await page.screenshot({ path: resolve(output, "daily-absence-mobile.png"), fullPage: true });
  check("daily-report mobile view displays the recorded absence separately from leave requests");
  await navigate("/absences", "مدیریت عدم حضور");
  await page.getByPlaceholder("جستجوی نام کاربر یا علت عدم حضور…").fill(tag);
  const absenceRow = page.locator("tbody tr").filter({ hasText: tag });
  await absenceRow.waitFor();
  await absenceRow.getByRole("button", { name: "پایان عدم حضور", exact: true }).click();
  await absenceRow.getByText("پایان‌یافته", { exact: true }).waitFor();
  ended = true;
  await navigate("/reports/source/leave", "مرخصی و عدم حضور");
  await row.getByText("پایان‌یافته", { exact: true }).first().waitFor();
  check("ending the absence through the UI invalidates the cached report and shows its new status");
  await page.getByRole("button", { name: "به‌روزرسانی گزارش", exact: true }).click();
  await row.waitFor();
  check("manual report refresh preserves the report definition and connected record");
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (absenceId && !ended) await api(`organization/absences/${absenceId}/`, "DELETE").catch(() => {});
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify({ checks, errors, failures, absenceId, ended }, null, 2)
  );
  await browser.close();
}
