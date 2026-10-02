/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { index, layout, route } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

/**
 * Main Routes Configuration
 * This file serves as the entry point for the route configuration.
 *
 * Every route nests under the pathless app/layout.tsx shell; root.tsx stays
 * shell-thin (see the note in app/root.tsx).
 */
export default [
  route("login", "./crm/pages/auth.tsx"),
  layout("./crm/layout.tsx", [
    index("./crm/pages/home.tsx"),
    route("projects", "./crm/pages/projects.tsx"),
    route("projects/:id", "./crm/pages/project-detail.tsx"),
    route("issues", "./crm/pages/issues.tsx"),
    route("my-work", "./crm/pages/my-work.tsx"),
    route("inbox", "./crm/pages/inbox.tsx"),
    route("calendar", "./crm/pages/calendar.tsx"),
    route("team", "./crm/pages/team.tsx"),
    route("team/:userId", "./crm/pages/user-profile.tsx"),
    route("organization", "./crm/pages/organization.tsx"),
    route("roles", "./crm/pages/roles.tsx"),
    route("routing", "./crm/pages/routing.tsx"),
    route("settings", "./crm/pages/settings.tsx"),
    route("*", "./crm/pages/not-found.tsx"),
  ]),
] satisfies RouteConfig;
