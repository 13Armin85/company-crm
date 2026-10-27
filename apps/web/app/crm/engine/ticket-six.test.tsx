import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { SchemaDrivenForm } from "@plane/ui";
import { DuplicateFeedback, duplicateDetails } from "./duplicate-feedback";

describe("Ticket 6 duplicate feedback", () => {
  it("keeps an existing record link and its inactive status visible", () => {
    const details = duplicateDetails({
      response: {
        data: {
          duplicates: [
            {
              message: "این مقدار قبلاً ثبت شده است (غیرفعال)",
              record_url: "/entities/customer/record-1",
              inactive: true,
            },
          ],
        },
      },
    });
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DuplicateFeedback details={details} />
      </MemoryRouter>
    );
    expect(markup).toContain('href="/entities/customer/record-1"');
    expect(markup).toContain("غیرفعال");
  });
  it("never turns an external or executable URL into a duplicate-record link", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DuplicateFeedback details={[{ message: "رکورد موجود", record_url: "javascript:alert(1)" }]} />
      </MemoryRouter>
    );
    expect(markup).not.toContain("href=");
    expect(duplicateDetails({ response: { data: { duplicates: [null, "invalid", { message: 12 }] } } })).toEqual([]);
  });
});

it("renders the locked user password as a password input", () => {
  const markup = renderToStaticMarkup(
    <SchemaDrivenForm
      schema={{
        entity: "user",
        title: "کاربر",
        schema_version: 1,
        fields: [
          {
            id: "password",
            code: "password",
            title: "رمز عبور",
            kind: "short_text",
            config: { secret: true, required: true },
            binding: { field: "password" },
            is_active: true,
          },
        ],
        layout: { tabs: [], sections: [{ id: "main", columns: 1, bindings: [{ field: "password" }] }] },
      }}
      values={{ password: "" }}
      onChange={() => {}}
    />
  );
  expect(markup).toContain('type="password"');
});
