import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  toast: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
  useMutation: (options: unknown) => options,
}));
vi.mock("./store", () => ({
  useUIStore: Object.assign(
    (selector: (value: { workspaceSlug: string }) => unknown) => selector({ workspaceSlug: "test" }),
    { getState: () => ({ toast: state.toast }) }
  ),
}));
vi.mock("@headlessui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@headlessui/react")>()),
  Combobox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComboboxInput: () => <input />,
  ComboboxButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  ComboboxOptions: ({ children, className }: { children: ReactNode; className: string }) => (
    <div className={className}>{children}</div>
  ),
  ComboboxOption: ({ children, className }: { children: ReactNode; className: string }) => (
    <div className={className}>{children}</div>
  ),
}));

import { useCreateIssue, useUpdateAppearance, useUpdateIssueStatus } from "./api";
import { SearchableSelect } from "@plane/ui";

beforeEach(() => vi.clearAllMocks());

describe("user-facing action feedback", () => {
  it.each([
    ["create task", () => useCreateIssue("test")],
    ["change status", () => useUpdateIssueStatus("test")],
    ["save preferences", () => useUpdateAppearance()],
  ] as const)("confirms %s with ordinary user language", async (_name, hook) => {
    const mutation = hook() as unknown as { onSuccess: () => void | Promise<void> };
    await mutation.onSuccess();
    expect(state.toast).toHaveBeenCalledWith("تغییرات با موفقیت انجام شد");
  });
  it("lets narrow status controls open a wider list with single-line options", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect
        label="وضعیت"
        value="started"
        onChange={() => undefined}
        wrapOptions={false}
        options={[{ id: "started", title: "در حال انجام" }]}
      />
    );
    expect(html).toContain("selector-single-options-nowrap");
    expect(html).toContain("در حال انجام");
  });
  it("keeps the existing wrapping behavior for other selectors", () => {
    const html = renderToStaticMarkup(
      <SearchableSelect
        label="کاربر"
        value="user"
        onChange={() => undefined}
        options={[{ id: "user", title: "نام کاربر", description: "توضیح کاربر" }]}
      />
    );
    expect(html).not.toContain("selector-single-options-nowrap");
    expect(html).toContain("توضیح کاربر");
  });
});
