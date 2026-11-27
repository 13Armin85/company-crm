import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoteWidget } from "./widget";

describe("personal dashboard note", () => {
  it("has an inline editor and save action", () => {
    const html = renderToStaticMarkup(<NoteWidget text="یادداشت من" onSave={async () => {}} />);
    expect(html).toContain("یادداشت شخصی");
    expect(html).toContain("ذخیره یادداشت");
    expect(html).toContain("یادداشت من");
  });
});
