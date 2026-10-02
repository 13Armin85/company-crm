/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
// icons
import { Menu } from "lucide-react";
import { SettingsOutline } from "@makeplane/propel/icons";
// plane internal packages
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@makeplane/propel/components/breadcrumb";
// hooks
import { useTheme } from "@/hooks/store";
// local imports
import { CORE_HEADER_SEGMENT_LABELS, generateBreadcrumbItems } from "./core";
import { EXTENDED_HEADER_SEGMENT_LABELS } from "./extended";

export const HamburgerToggle = observer(function HamburgerToggle() {
  const { isSidebarCollapsed, toggleSidebar } = useTheme();
  return (
    <button
      type="button"
      aria-label="باز کردن منوی مدیریت"
      aria-expanded={!isSidebarCollapsed}
      className="group flex size-7 cursor-pointer items-center justify-center rounded-sm bg-layer-1 transition-all hover:bg-layer-1-hover md:hidden"
      onClick={() => toggleSidebar(!isSidebarCollapsed)}
    >
      <Menu size={14} className="text-secondary transition-all group-hover:text-primary" />
    </button>
  );
});

const HEADER_SEGMENT_LABELS = {
  ...CORE_HEADER_SEGMENT_LABELS,
  ...EXTENDED_HEADER_SEGMENT_LABELS,
};

export const AdminHeader = observer(function AdminHeader() {
  const pathName = usePathname();

  const breadcrumbItems = generateBreadcrumbItems(pathName || "", HEADER_SEGMENT_LABELS);

  return (
    <div className="admin-header relative z-10 flex w-full shrink-0 items-center justify-between gap-2 border-b border-subtle">
      <div className="flex min-w-0 flex-grow items-center gap-2 overflow-x-auto whitespace-nowrap">
        <HamburgerToggle />
        <div>
          <Breadcrumb aria-label="مسیر صفحه">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  label="مدیریت سامانه"
                  icon={<SettingsOutline className="h-4 w-4 text-tertiary" />}
                  render={<Link href="/general/" />}
                />
              </BreadcrumbItem>
              {breadcrumbItems.map(
                (item) =>
                  item.title && (
                    <Fragment key={item.title}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbLink label={item.title} render={<Link href={item.href} />} />
                      </BreadcrumbItem>
                    </Fragment>
                  )
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>
    </div>
  );
});
