import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./primitives";

describe("CRM button accessibility and native controls", () => {
  it("preserves accessible names and native form attributes", () => {
    const html = renderToStaticMarkup(
      <Button aria-label="حذف صفحهٔ قراردادها" aria-describedby="consequence" name="remove-page" form="page-actions">
        حذف صفحه
      </Button>
    );
    expect(html).toContain('aria-label="حذف صفحهٔ قراردادها"');
    expect(html).toContain('aria-describedby="consequence"');
    expect(html).toContain('form="page-actions"');
    expect(html).toContain('name="remove-page"');
  });
  it("defaults to a non-submitting button and forwards disabled state and custom classes", () => {
    const html = renderToStaticMarkup(
      <Button disabled className="page-action" variant="danger">
        حذف
      </Button>
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('class="button button-danger page-action"');
  });
});
