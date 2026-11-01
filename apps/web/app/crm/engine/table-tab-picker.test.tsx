import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MAIN_TABLE_TAB, TableTabPicker } from "./table-tab-picker";

const tabs = [
  { id: "open", title: "باز" },
  { id: "done", title: "انجام‌شده" },
];

describe("table tab picker", () => {
  it("shows that every tab is visible by default", () => {
    const html = renderToStaticMarkup(<TableTabPicker tabs={tabs} hidden={[]} onChange={() => undefined} />);
    expect(html).toContain("تب‌های قابل نمایش");
    expect(html).toContain("همه");
  });

  it("counts the tabs the viewer kept", () => {
    const html = renderToStaticMarkup(
      <TableTabPicker tabs={tabs} hidden={[MAIN_TABLE_TAB, "done"]} onChange={() => undefined} />
    );
    expect(html).toContain("۱ از ۳");
  });
});
