/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useTheme as useNextTheme } from "next-themes";
import { LogOutOutline, PaletteOutline } from "@makeplane/propel/icons";
import { Menu } from "@headlessui/react";
import { API_BASE_URL } from "@plane/constants";
import { WorkspaceAvatar } from "@makeplane/propel/components/workspace-avatar";
import { AuthService } from "@plane/services";
import { getFileURL } from "@plane/utils";
import { useTheme, useUser } from "@/hooks/store";

const authService = new AuthService();

export const AdminSidebarDropdown = observer(function AdminSidebarDropdown() {
  const { isSidebarCollapsed } = useTheme();
  const { currentUser, signOut } = useUser();
  const { resolvedTheme, setTheme } = useNextTheme();
  const [csrfToken, setCsrfToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    void authService.requestCSRFToken().then((data) => setCsrfToken(data?.csrf_token));
  }, []);
  return (
    <>
      <div className="admin-brand" title="هم‌کار | مدیریت سامانه">
        <span className="admin-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {!isSidebarCollapsed && (
          <div>
            <strong>هم‌کار</strong>
            <small>مدیریت سامانه · God mode</small>
          </div>
        )}
      </div>
      <Menu as="div" className="admin-account relative">
        <Menu.Button className="admin-account-button" aria-label="حساب مدیر و ظاهر برنامه">
          <WorkspaceAvatar
            alt={currentUser?.display_name ?? "مدیر سامانه"}
            fallback={currentUser?.display_name?.[0]?.toUpperCase() ?? "م"}
            src={getFileURL(currentUser?.avatar_url ?? "")}
            size="sm"
          />
          {!isSidebarCollapsed && (
            <div className="min-w-0">
              <span className="block truncate text-white">{currentUser?.display_name || "مدیر سامانه"}</span>
              <small className="block truncate text-slate-400" dir="ltr">
                {currentUser?.email}
              </small>
            </div>
          )}
        </Menu.Button>
        <Menu.Items className="absolute start-0 z-40 mt-2 w-56 rounded-xl border border-subtle bg-surface-1 p-2 text-12 text-primary shadow-lg outline-none">
          <Menu.Item
            as="button"
            type="button"
            className="flex w-full items-center gap-2 rounded-lg p-2 hover:bg-layer-1-hover"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <PaletteOutline className="size-4" />
            {resolvedTheme === "dark" ? "ظاهر روشن" : "ظاهر تیره"}
          </Menu.Item>
          <form method="POST" action={API_BASE_URL + "/api/instances/admins/sign-out/"} onSubmit={() => signOut()}>
            <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />
            <Menu.Item
              as="button"
              type="submit"
              disabled={!csrfToken}
              className="flex w-full items-center gap-2 rounded-lg p-2 hover:bg-layer-1-hover"
            >
              <LogOutOutline className="size-4" />
              خروج از حساب
            </Menu.Item>
          </form>
        </Menu.Items>
      </Menu>
    </>
  );
});
