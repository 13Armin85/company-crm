import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOCAL_TAB_PREFIX, MAIN_TABLE_TAB, TableTabPicker } from "./table-tab-picker";

const tabs = [
  { id: "open", title: "باز" },
  { id: "done", title: "انجام‌شده" },
];

describe("table tab picker", () => {
  it("shows that every tab is visible by default", () => {
    const html = renderToStaticMarkup(<TableTabPicker tabs={tabs} hidden={[]} onChange={() => undefined} />);
    expect(html).toContain("تب‌های من");
    expect(html).toContain("همه");
  });

  it("counts the tabs the viewer kept", () => {
    const html = renderToStaticMarkup(
      <TableTabPicker tabs={tabs} hidden={[MAIN_TABLE_TAB, "done"]} onChange={() => undefined} />
    );
    expect(html).toContain("۱ از ۳");
  });

  it("counts personal tabs with the shared ones", () => {
    const html = renderToStaticMarkup(
      <TableTabPicker
        tabs={[...tabs, { id: `${LOCAL_TAB_PREFIX}mine`, title: "فوری‌های من" }]}
        hidden={["open"]}
        onChange={() => undefined}
      />
    );
    expect(html).toContain("۳ از ۴");
  });
});
