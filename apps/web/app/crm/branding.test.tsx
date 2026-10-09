import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLogo } from "@plane/ui";
import { COMPANY_LOGO_ALT, COMPANY_LOGO_FULL, COMPANY_LOGO_SYMBOL } from "@plane/constants";

describe("company branding", () => {
  it("renders the emblem with an accessible company name", () => {
    const markup = renderToStaticMarkup(<BrandLogo className="brand-mark" />);
    expect(markup).toContain(COMPANY_LOGO_SYMBOL);
    expect(markup).toContain(`alt="${COMPANY_LOGO_ALT}"`);
    expect(markup).toContain('data-company-logo="symbol"');
  });

  it("uses the full company logo for large surfaces", () => {
    const markup = renderToStaticMarkup(<BrandLogo variant="full" width={240} />);
    expect(markup).toContain(COMPANY_LOGO_FULL);
    expect(markup).toContain('data-company-logo="full"');
    expect(markup).toContain('width="240"');
  });

  it("keeps decorative loading logos out of the accessibility tree", () => {
    const markup = renderToStaticMarkup(<BrandLogo decorative />);
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
  });
});
