import { renderToStaticMarkup } from "react-dom/server";
import { ScrollableTable } from "@plane/ui";
import { describe, expect, it } from "vitest";

describe("shared wide tables", () => {
  it("preserves table semantics and gives keyboard users a scroll region", () => {
    const html = renderToStaticMarkup(
      <ScrollableTable className="report">
        <thead>
          <tr>
            <th scope="col">عنوان</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <a href="/record">درخواست مشتری</a>
            </td>
          </tr>
        </tbody>
      </ScrollableTable>
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("overflow:auto");
    expect(html).toContain('<th scope="col">عنوان</th>');
    expect(html).toContain('href="/record"');
    expect(html).toContain("width:max-content");
  });
});
