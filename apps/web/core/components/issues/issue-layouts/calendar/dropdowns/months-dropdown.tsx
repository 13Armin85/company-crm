/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { usePopper } from "react-popper";
import { Popover, Transition } from "@headlessui/react";
import { ChevronLeftOutline, ChevronRightOutline } from "@makeplane/propel/icons";
//hooks
// icons
// constants
import { persianDigits, persianMonths } from "@plane/ui";
import { useCalendarView } from "@/hooks/store/use-calendar-view";
import { gregorianDate, persianCalendarDate, shiftPersianMonth } from "@/store/issue/persian-calendar";
import type { ICycleIssuesFilter } from "@/store/issue/cycle";
import type { IModuleIssuesFilter } from "@/store/issue/module";
import type { IProjectIssuesFilter } from "@/store/issue/project";
import type { IProjectViewIssuesFilter } from "@/store/issue/project-views";
// helpers

interface Props {
  issuesFilterStore: IProjectIssuesFilter | IModuleIssuesFilter | ICycleIssuesFilter | IProjectViewIssuesFilter;
}
export const CalendarMonthsDropdown = observer(function CalendarMonthsDropdown(props: Props) {
  const { issuesFilterStore } = props;

  const issueCalendarView = useCalendarView();

  const calendarLayout = issuesFilterStore.issueFilters?.displayFilters?.calendar?.layout ?? "month";

  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: "auto",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  const { activeMonthDate } = issueCalendarView.calendarFilters;
  const active = persianCalendarDate(activeMonthDate);

  const getWeekLayoutHeader = (): string => {
    const allDaysOfActiveWeek = issueCalendarView.allDaysOfActiveWeek;

    if (!allDaysOfActiveWeek) return "نمای هفتگی";

    const daysList = Object.keys(allDaysOfActiveWeek);

    const firstDay = allDaysOfActiveWeek[daysList[0]]?.date;
    const lastDay = allDaysOfActiveWeek[daysList[daysList.length - 1]]?.date;

    if (!firstDay || !lastDay) return "نمای هفتگی";
    const first = persianCalendarDate(firstDay);
    const last = persianCalendarDate(lastDay);
    const firstLabel = `${persianMonths[first.jm - 1]} ${persianDigits(first.jy)}`;
    const lastLabel = `${persianMonths[last.jm - 1]} ${persianDigits(last.jy)}`;
    return first.jy === last.jy && first.jm === last.jm ? firstLabel : `${firstLabel} – ${lastLabel}`;
  };

  const handleDateChange = (date: Date) => {
    issueCalendarView.updateCalendarFilters({
      activeMonthDate: date,
    });
  };

  return (
    <Popover className="relative">
      <Popover.Button as={React.Fragment}>
        <button
          type="button"
          ref={setReferenceElement}
          className="text-18 font-semibold outline-none"
          disabled={calendarLayout === "week"}
        >
          {calendarLayout === "month"
            ? `${persianMonths[active.jm - 1]} ${persianDigits(active.jy)}`
            : getWeekLayoutHeader()}
        </button>
      </Popover.Button>
      <Transition
        as={React.Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <Popover.Panel className="fixed z-50">
          <div
            ref={setPopperElement}
            style={styles.popper}
            {...attributes.popper}
            className="w-56 divide-y divide-subtle-1 rounded-sm border border-subtle bg-surface-1 p-3 shadow-raised-200"
          >
            <div className="flex items-center justify-between gap-2 pb-3">
              <button
                type="button"
                className="grid place-items-center"
                onClick={() => {
                  const previousYear = shiftPersianMonth(activeMonthDate, -12);
                  handleDateChange(previousYear);
                }}
              >
                <ChevronLeftOutline height={14} width={14} className="rtl:-scale-x-100" />
              </button>
              <span className="text-11">{persianDigits(active.jy)}</span>
              <button
                type="button"
                className="grid place-items-center"
                onClick={() => {
                  const nextYear = shiftPersianMonth(activeMonthDate, 12);
                  handleDateChange(nextYear);
                }}
              >
                <ChevronRightOutline height={14} width={14} className="rtl:-scale-x-100" />
              </button>
            </div>
            <div className="grid grid-cols-4 items-stretch justify-items-stretch gap-4 pt-3">
              {persianMonths.map((month, index) => (
                <button
                  key={month}
                  type="button"
                  className="rounded-sm py-0.5 text-11 hover:bg-layer-1"
                  onClick={() => {
                    const newDate = gregorianDate(active.jy, index + 1, 1);
                    handleDateChange(newDate);
                  }}
                >
                  {month}
                </button>
              ))}
            </div>
          </div>
        </Popover.Panel>
      </Transition>
    </Popover>
  );
});
