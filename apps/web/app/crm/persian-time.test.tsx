import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PersianDateTimePicker, PersianTimePicker } from "@plane/ui";

describe("absence time controls", () => {
  it.each([
    ["Asia/Tehran", "۰۰", "۱۵"],
    ["UTC", "۲۰", "۴۵"],
  ])("shows the saved instant in the user's %s timezone", (timeZone, hour, minute) => {
    const html = renderToStaticMarkup(
      <PersianDateTimePicker label="شروع" value="2026-10-10T20:45:00Z" timeZone={timeZone} onChange={() => undefined} />
    );
    expect(html).toContain(
      `aria-label="ساعت شروع" aria-valuemin="0" aria-valuemax="23" aria-valuenow="${timeZone === "UTC" ? 20 : 0}" value="${hour}"`
    );
    expect(html).toContain(`value="${minute}"`);
    expect(html).toContain('aria-label="دقیقه شروع"');
    expect(html).toContain('value="2026-10-10T20:45:00Z"');
  });

  it("supports exact minutes outside the quick choices and exposes keyboard bounds", () => {
    const html = renderToStaticMarkup(<PersianTimePicker label="پایان" value="23:59" onChange={() => undefined} />);
    expect(html).toContain(
      'role="spinbutton" aria-label="دقیقه پایان" aria-valuemin="0" aria-valuemax="59" aria-valuenow="59" value="۵۹"'
    );
    expect(html).toContain('aria-label="افزایش ساعت پایان"');
    expect(html).toContain('aria-label="کاهش دقیقه پایان"');
    expect(html.match(/aria-pressed="true"/g)).toBeNull();
  });

  it("disables the whole time field and never submits the form from its buttons", () => {
    const html = renderToStaticMarkup(
      <PersianTimePicker label="شروع" value="09:30" onChange={() => undefined} disabled />
    );
    expect(html).toContain('<fieldset class="persian-time-picker" disabled=""');
    expect(html.match(/<button type="button"/g)).toHaveLength(8);
    expect(html).toContain('aria-label="۳۰ دقیقه شروع" aria-pressed="true"');
  });
});
