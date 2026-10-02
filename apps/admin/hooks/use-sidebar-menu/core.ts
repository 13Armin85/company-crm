/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { BrainCog } from "lucide-react";
// plane imports
import { ImageOutline, LockOutline, MailOutline, SettingsOutline, WorkspaceOutline } from "@makeplane/propel/icons";
// types
import type { TSidebarMenuItem } from "./types";

export type TCoreSidebarMenuKey = "general" | "email" | "workspace" | "authentication" | "ai" | "image";

export const coreSidebarMenuLinks: Record<TCoreSidebarMenuKey, TSidebarMenuItem> = {
  general: {
    Icon: SettingsOutline,
    name: "تنظیمات عمومی",
    description: "نام سامانه و اطلاعات اصلی",
    href: `/general/`,
  },
  email: {
    Icon: MailOutline,
    name: "ایمیل",
    description: "تنظیم ارسال ایمیل و SMTP",
    href: `/email/`,
  },
  workspace: {
    Icon: WorkspaceOutline,
    name: "فضاهای کاری",
    description: "مدیریت فضاهای کاری سامانه",
    href: `/workspace/`,
  },
  authentication: {
    Icon: LockOutline,
    name: "ورود و امنیت",
    description: "روش‌های ورود و دسترسی کاربران",
    href: `/authentication/`,
  },
  ai: {
    Icon: BrainCog,
    name: "هوش مصنوعی",
    description: "تنظیم سرویس هوش مصنوعی",
    href: `/ai/`,
  },
  image: {
    Icon: ImageOutline,
    name: "کتابخانه تصاویر",
    description: "دسترسی به سرویس‌های تصاویر",
    href: `/image/`,
  },
};
