import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("./api", () => ({
  useAccess: () => ({
    data: { permissions: state.permissions, can: (code: string) => state.permissions.includes(code) },
    isLoading: false,
  }),
}));

import { PermissionGate, PermissionRoute } from "./permission-gate";
import { usePermission, useAnyPermission, useAllPermissions } from "./use-permission";
import { MultiSelector, passwordError } from "./components";
import { useUIStore } from "../store";

function PermissionProbe() {
  const single = usePermission("User.Edit");
  const any = useAnyPermission(["User.Edit", "User.Delete"]);
  const all = useAllPermissions(["User.Edit", "User.Delete"]);
  return <span>{`${single}/${any}/${all}`}</span>;
}

describe("effective permission UI", () => {
  it("uses only backend permission codes and fails closed", () => {
    state.permissions = [];
    expect(renderToStaticMarkup(<PermissionProbe />)).toContain("false/false/false");
    state.permissions = ["User.Edit"];
    expect(renderToStaticMarkup(<PermissionProbe />)).toContain("true/true/false");
    state.permissions = ["User.Edit", "User.Delete"];
    expect(renderToStaticMarkup(<PermissionProbe />)).toContain("true/true/true");
  });

  it("hides protected actions and displays the provided fallback", () => {
    state.permissions = [];
    expect(
      renderToStaticMarkup(
        <PermissionGate permission="User.Delete" fallback={<span>Denied</span>}>
          <button>Delete user</button>
        </PermissionGate>
      )
    ).toBe("<span>Denied</span>");
    state.permissions = ["User.Delete"];
    expect(
      renderToStaticMarkup(
        <PermissionGate permission="User.Delete">
          <button>Delete user</button>
        </PermissionGate>
      )
    ).toContain("Delete user");
  });

  it("protects the route even when opened directly", () => {
    state.permissions = [];
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PermissionRoute permission="User.View">
          <div>Protected roster</div>
        </PermissionRoute>
      </MemoryRouter>
    );
    expect(html).not.toContain("Protected roster");
    state.permissions = ["User.View"];
    expect(
      renderToStaticMarkup(
        <MemoryRouter>
          <PermissionRoute permission="User.View">
            <div>Protected roster</div>
          </PermissionRoute>
        </MemoryRouter>
      )
    ).toContain("Protected roster");
  });

  it("disables every role control for an inactive user", () => {
    const html = renderToStaticMarkup(
      <MultiSelector
        label="Roles"
        disabled
        options={[{ id: "a", title: "Manager" }]}
        selected={["a"]}
        onChange={() => undefined}
      />
    );
    expect(html).toContain('fieldset class="compact-selector" disabled=""');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });

  it("requires matching passwords before submitting", () => {
    expect(passwordError("StrongPassword!2026", "WrongPassword!2026")).not.toBe("");
    expect(passwordError("StrongPassword!2026", "")).not.toBe("");
    expect(passwordError("tiny", "tiny")).not.toBe("");
    expect(passwordError("StrongPassword!2026", "StrongPassword!2026")).toBe("");
  });

  it("clears user and workspace UI state on logout", () => {
    useUIStore.setState({
      workspaceSlug: "company",
      dirtyForms: ["profile"],
      createOpen: true,
      commandOpen: true,
      notificationOpen: true,
    });
    useUIStore.getState().resetSession();
    expect(useUIStore.getState()).toMatchObject({
      workspaceSlug: undefined,
      dirtyForms: [],
      createOpen: false,
      commandOpen: false,
      notificationOpen: false,
    });
  });
});
