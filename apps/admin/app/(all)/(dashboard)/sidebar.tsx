/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
// hooks
import { useTheme } from "@/hooks/store";
// components
import { AdminSidebarDropdown } from "./sidebar-dropdown";
import { AdminSidebarHelpSection } from "./sidebar-help-section";
import { AdminSidebarMenu } from "./sidebar-menu";

export const AdminSidebar = observer(function AdminSidebar() {
  // store
  const { isSidebarCollapsed, toggleSidebar } = useTheme();

  const ref = useRef<HTMLDivElement>(null);

  useOutsideClickDetector(ref, () => {
    if (isSidebarCollapsed === false) {
      if (window.innerWidth < 768) {
        toggleSidebar(!isSidebarCollapsed);
      }
    }
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        toggleSidebar(true);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [toggleSidebar]);

  return (
    <aside className="admin-sidebar" data-collapsed={!!isSidebarCollapsed} aria-label="مدیریت هم‌کار">
      <div ref={ref} className="admin-sidebar-inner">
        <AdminSidebarDropdown />
        <AdminSidebarMenu />
        <AdminSidebarHelpSection />
      </div>
    </aside>
  );
});
