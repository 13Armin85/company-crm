import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { UnitRow } from "./settings-page";

describe("unit reminder editors", () => {
  it("does not mount hidden form controls for collapsed units", () => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <UnitRow
          unit={{ id: "one", title: "پشتیبانی", reminder: null, allow_personal: true }}
          base={{ enabled: true, time: "17:00", weekdays: [0, 1, 2, 3, 5, 6] }}
        />
      </QueryClientProvider>
    );
    client.clear();
    expect(html).toContain("پشتیبانی");
    expect(html).toContain("<summary>");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<fieldset");
  });
});
