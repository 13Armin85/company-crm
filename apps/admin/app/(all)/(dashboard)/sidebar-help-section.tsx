/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import { observer } from "mobx-react";
import { ArrowNarrowLeftOutline, HelpOutline, NewTabOutline } from "@makeplane/propel/icons";
import { Menu } from "@headlessui/react";
import { WEB_BASE_URL } from "@plane/constants";
import { useInstance, useTheme } from "@/hooks/store";

const helpOptions = [
  { name: "مستندات Plane", href: "https://docs.plane.so/" },
  { name: "انجمن کاربران", href: "https://forum.plane.so" },
  { name: "گزارش اشکال", href: "https://github.com/makeplane/plane/issues/new/choose" },
];

export const AdminSidebarHelpSection = observer(function AdminSidebarHelpSection() {
  const { isSidebarCollapsed, toggleSidebar } = useTheme();
  const { instance } = useInstance();
  return (
    <div className="admin-sidebar-footer">
      <a href={WEB_BASE_URL + "/"} aria-label="بازگشت به هم‌کار" title="بازگشت به هم‌کار">
        <NewTabOutline className="size-4 shrink-0" />
        {!isSidebarCollapsed && <span>بازگشت به هم‌کار</span>}
      </a>
      <Menu as="div" className="relative">
        <Menu.Button aria-label="راهنما" title="راهنما">
          <HelpOutline className="size-4" />
        </Menu.Button>
        <Menu.Items className="absolute bottom-full end-0 mb-2 w-48 rounded-xl border border-subtle bg-surface-1 p-2 text-primary shadow-lg outline-none">
          {helpOptions.map((item) => (
            <Menu.Item key={item.href}>
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg hover:bg-layer-1-hover"
              >
                {item.name}
              </a>
            </Menu.Item>
          ))}
          <div className="border-t border-subtle px-2 pt-2 text-placeholder" dir="ltr">
            v{instance?.current_version}
          </div>
        </Menu.Items>
      </Menu>
      <button
        type="button"
        aria-label={isSidebarCollapsed ? "باز کردن منو" : "جمع کردن منو"}
        title={isSidebarCollapsed ? "باز کردن منو" : "جمع کردن منو"}
        onClick={() => toggleSidebar(!isSidebarCollapsed)}
      >
        <ArrowNarrowLeftOutline className={"size-4 " + (isSidebarCollapsed ? "rotate-180" : "")} />
      </button>
    </div>
  );
});
