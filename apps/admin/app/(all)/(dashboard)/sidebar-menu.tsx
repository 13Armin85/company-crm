/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import { observer } from "mobx-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/hooks/store";
import { useSidebarMenu } from "@/hooks/use-sidebar-menu";
import { isAdminRouteActive } from "@/components/common/header/core";

export const AdminSidebarMenu = observer(function AdminSidebarMenu() {
  const pathname = usePathname();
  const { isSidebarCollapsed, toggleSidebar } = useTheme();
  const sidebarMenu = useSidebarMenu();
  return (
    <nav className="admin-nav" aria-label="تنظیمات سامانه">
      {!isSidebarCollapsed && <div className="admin-nav-caption">مدیریت سامانه</div>}
      {sidebarMenu.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="admin-nav-link"
          aria-label={item.name}
          aria-current={isAdminRouteActive(pathname ?? "", item.href) ? "page" : undefined}
          title={isSidebarCollapsed ? item.name : item.description}
          onClick={() => {
            if (window.innerWidth < 768) toggleSidebar(true);
          }}
        >
          <item.Icon className="size-4 shrink-0" />
          {!isSidebarCollapsed && <span>{item.name}</span>}
        </Link>
      ))}
    </nav>
  );
});
