import { describe, expect, it } from "vitest";
import { guideForPath } from "./page-help";

describe("page guide selection", () => {
  it("has a specific guide for every CRM and portal route", () => {
    const routes = [
      "/",
      "/login",
      "/projects",
      "/projects/1",
      "/issues",
      "/my-work",
      "/inbox",
      "/calendar",
      "/workflow-inbox",
      "/team",
      "/team/1",
      "/organization",
      "/roles",
      "/roles/1/permissions",
      "/routing",
      "/help",
      "/absences",
      "/leave-requests",
      "/leave-requests/1",
      "/leave-templates",
      "/signatures",
      "/portal-settings",
      "/portal-settings/requests/1",
      "/daily-report",
      "/daily-report/team",
      "/daily-report/settings",
      "/reports",
      "/reports/source/task",
      "/reports/saved/1",
      "/settings",
      "/settings/engine",
      "/entities",
      "/entities/test",
      "/entities/test/1",
      "/edit/test/1",
      "/portal",
      "/portal/new",
      "/portal/requests/1",
      "/portal/settings",
      "/portal/login",
      "/portal/setup",
    ];
    for (const path of routes) {
      const result = guideForPath(path);
      expect(result.title, path).not.toBe("این صفحه");
      expect(result.purpose.length, path).toBeGreaterThan(15);
      expect(result.steps.length, path).toBeGreaterThan(1);
    }
  });
  it("uses the detail guide before the parent route", () => {
    expect(guideForPath("/roles/role-1/permissions").title).toBe("مجوزهای نقش");
    expect(guideForPath("/daily-report/team").title).toBe("گزارش روزانهٔ تیم");
    expect(guideForPath("/leave-requests/42").title).toBe("جزئیات درخواست مرخصی");
  });

  it("covers custom data pages and their edit forms", () => {
    expect(guideForPath("/entities/contracts/23").steps).toContain(
      "ردیف را باز کنید تا جزئیات یا فرم ویرایش را ببینید."
    );
    expect(guideForPath("/edit/contracts/23").title).toBe("ویرایش رکورد");
  });

  it("uses the specific customer portal guide", () => {
    expect(guideForPath("/portal/new").title).toBe("ثبت درخواست");
    expect(guideForPath("/portal/requests/123").title).toBe("جزئیات درخواست مشتری");
    expect(guideForPath("/portal/login").title).toBe("ورود به درگاه مشتری");
  });
});
