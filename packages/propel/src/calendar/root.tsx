/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";
import { DayPicker, faIR } from "react-day-picker/persian";
import { ChevronLeftOutline } from "@makeplane/propel/icons";

import { cn } from "../utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, showOutsideDays = true, ...props }: CalendarProps) {
  const currentYear = new Date().getFullYear();
  const thirtyYearsAgoFirstDay = new Date(currentYear - 30, 0, 1);
  const thirtyYearsFromNowFirstDay = new Date(currentYear + 30, 11, 31);
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={faIR}
      dir="rtl"
      numerals="arabext"
      captionLayout="dropdown"
      labels={{
        labelMonthDropdown: () => "ماه",
        labelYearDropdown: () => "سال",
        labelNext: () => "ماه بعد",
        labelPrevious: () => "ماه قبل",
      }}
      className={cn("persian-shared-calendar p-3", className)}
      weekStartsOn={6}
      components={{
        Chevron: ({ className: chevronClassName, ...chevronProps }) => (
          <ChevronLeftOutline
            className={cn(
              "size-4 rtl:-scale-x-100",
              { "rotate-180": chevronProps.orientation === "right", "-rotate-90": chevronProps.orientation === "down" },
              chevronClassName
            )}
            {...chevronProps}
          />
        ),
      }}
      startMonth={thirtyYearsAgoFirstDay}
      endMonth={thirtyYearsFromNowFirstDay}
      {...props}
    />
  );
}
