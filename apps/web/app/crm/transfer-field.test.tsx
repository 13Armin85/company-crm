import { renderToStaticMarkup } from "react-dom/server";
import { SearchableSelect } from "@plane/ui";
import { describe, expect, it, vi } from "vitest";

describe("member transfer input", () => {
  it("keeps the current assignee readable when they cannot be selected as a recipient", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect
        value="current"
        selectedLabel="Current assignee"
        options={[{ id: "next", title: "New recipient" }]}
        label="Transfer to another person"
        optionClassName="member-transfer-options"
        onChange={vi.fn()}
      />
    );
    expect(html).toContain('value="Current assignee"');
    expect(html).toContain('data-transfer-field=""');
  });
});
