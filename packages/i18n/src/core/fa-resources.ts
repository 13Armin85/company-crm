/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import accessibility from "../locales/fa/accessibility.json";
import auth from "../locales/fa/auth.json";
import automation from "../locales/fa/automation.json";
import common from "../locales/fa/common.json";
import cycle from "../locales/fa/cycle.json";
import editor from "../locales/fa/editor.json";
import emptyState from "../locales/fa/empty-state.json";
import home from "../locales/fa/home.json";
import inbox from "../locales/fa/inbox.json";
import integration from "../locales/fa/integration.json";
import module from "../locales/fa/module.json";
import navigation from "../locales/fa/navigation.json";
import notification from "../locales/fa/notification.json";
import page from "../locales/fa/page.json";
import powerK from "../locales/fa/power-k.json";
import project from "../locales/fa/project.json";
import projectSettings from "../locales/fa/project-settings.json";
import settings from "../locales/fa/settings.json";
import stickies from "../locales/fa/stickies.json";
import template from "../locales/fa/template.json";
import tour from "../locales/fa/tour.json";
import update from "../locales/fa/update.json";
import wiki from "../locales/fa/wiki.json";
import workItem from "../locales/fa/work-item.json";
import workItemType from "../locales/fa/work-item-type.json";
import workflow from "../locales/fa/workflow.json";
import workspace from "../locales/fa/workspace.json";
import workspaceSettings from "../locales/fa/workspace-settings.json";

import type { TNamespace } from "../constants/namespaces";

const faResources: Record<TNamespace, Record<string, unknown>> = {
  accessibility,
  auth,
  automation,
  common,
  cycle,
  editor,
  "empty-state": emptyState,
  home,
  inbox,
  integration,
  module,
  navigation,
  notification,
  page,
  "power-k": powerK,
  project,
  "project-settings": projectSettings,
  settings,
  stickies,
  template,
  tour,
  update,
  wiki,
  "work-item": workItem,
  "work-item-type": workItemType,
  workflow,
  workspace,
  "workspace-settings": workspaceSettings,
};

export default faResources;
