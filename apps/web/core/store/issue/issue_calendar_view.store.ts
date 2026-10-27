/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observable, action, makeObservable, runInAction, computed } from "mobx";

// helpers
import { computedFn } from "mobx-utils";
import type { ICalendarPayload, ICalendarWeek } from "@plane/types";
import { generatePersianCalendarData, gregorianDate, persianCalendarDate } from "./persian-calendar";
// types
import type { IIssueRootStore } from "./root.store";

export interface ICalendarStore {
  calendarFilters: {
    activeMonthDate: Date;
    activeWeekDate: Date;
  };
  calendarPayload: ICalendarPayload | null;

  // action
  updateCalendarFilters: (filters: Partial<{ activeMonthDate: Date; activeWeekDate: Date }>) => void;
  updateCalendarPayload: (date: Date) => void;
  regenerateCalendar: () => void;

  // computed
  allWeeksOfActiveMonth:
    | {
        [weekNumber: string]: ICalendarWeek;
      }
    | undefined;
  activeWeekNumber: number;
  allDaysOfActiveWeek: ICalendarWeek | undefined;
  getStartAndEndDate: (layout: "week" | "month") => { startDate: string; endDate: string } | undefined;
}

export class CalendarStore implements ICalendarStore {
  loader: boolean = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: any | null = null;

  // observables
  calendarFilters: { activeMonthDate: Date; activeWeekDate: Date } = {
    activeMonthDate: new Date(),
    activeWeekDate: new Date(),
  };
  calendarPayload: ICalendarPayload | null = null;
  // root store
  rootStore;

  constructor(_rootStore: IIssueRootStore) {
    makeObservable(this, {
      loader: observable.ref,
      error: observable.ref,

      // observables
      calendarFilters: observable.ref,
      calendarPayload: observable.ref,

      // actions
      updateCalendarFilters: action,
      updateCalendarPayload: action,
      regenerateCalendar: action,

      //computed
      allWeeksOfActiveMonth: computed,
      activeWeekNumber: computed,
      allDaysOfActiveWeek: computed,
    });

    this.rootStore = _rootStore;
    this.initCalendar();
  }

  get allWeeksOfActiveMonth() {
    if (!this.calendarPayload) return undefined;

    const { activeMonthDate } = this.calendarFilters;

    const { jy: year, jm: month } = persianCalendarDate(activeMonthDate);

    // Get the weeks for the current month
    const weeks = this.calendarPayload[`y-${year}`]?.[`m-${month}`];

    // If no weeks exist, return undefined
    if (!weeks) return undefined;

    // Create a new object to store the reordered weeks
    const reorderedWeeks: { [weekNumber: string]: ICalendarWeek } = {};

    // Get all week numbers and sort them
    const weekNumbers = Object.keys(weeks).map((key) => parseInt(key.replace("w-", "")));
    weekNumbers.sort((a, b) => a - b);

    // Reorder weeks based on start_of_week
    weekNumbers.forEach((weekNumber) => {
      const weekKey = `w-${weekNumber}`;
      reorderedWeeks[weekKey] = weeks[weekKey];
    });

    return reorderedWeeks;
  }

  get activeWeekNumber() {
    const { jy, jm, jd } = persianCalendarDate(this.calendarFilters.activeWeekDate);
    const firstWeekday = (gregorianDate(jy, jm, 1).getDay() + 1) % 7;
    return Math.floor((jd - 1 + firstWeekday) / 7);
  }

  get allDaysOfActiveWeek() {
    if (!this.calendarPayload) return undefined;

    const { activeWeekDate } = this.calendarFilters;
    const { jy: year, jm: month, jd: dayOfMonth } = persianCalendarDate(activeWeekDate);

    // Check if calendar data exists for this year and month
    const yearData = this.calendarPayload[`y-${year}`];
    if (!yearData) return undefined;

    const monthData = yearData[`m-${month}`];
    if (!monthData) return undefined;

    return Object.values(monthData).find((week) =>
      Object.values(week).some((day) => day.is_current_month && day.day === dayOfMonth)
    );
  }

  getStartAndEndDate = computedFn((layout: "week" | "month") => {
    switch (layout) {
      case "week": {
        if (!this.allDaysOfActiveWeek) return;
        const dates = Object.keys(this.allDaysOfActiveWeek);
        return { startDate: dates[0], endDate: dates[dates.length - 1] };
      }
      case "month": {
        if (!this.allWeeksOfActiveMonth) return;
        const weeks = Object.keys(this.allWeeksOfActiveMonth);
        const firstWeekDates = Object.keys(this.allWeeksOfActiveMonth[weeks[0]]);
        const lastWeekDates = Object.keys(this.allWeeksOfActiveMonth[weeks[weeks.length - 1]]);

        return { startDate: firstWeekDates[0], endDate: lastWeekDates[lastWeekDates.length - 1] };
      }
    }
  });

  updateCalendarFilters = (filters: Partial<{ activeMonthDate: Date; activeWeekDate: Date }>) => {
    this.updateCalendarPayload(filters.activeMonthDate || filters.activeWeekDate || new Date());

    runInAction(() => {
      this.calendarFilters = {
        ...this.calendarFilters,
        ...filters,
      };
    });
  };

  updateCalendarPayload = (date: Date) => {
    if (!this.calendarPayload) return null;

    const nextDate = new Date(date);
    runInAction(() => {
      this.calendarPayload = generatePersianCalendarData(this.calendarPayload, nextDate);
    });
  };

  initCalendar = () => {
    const newCalendarPayload = generatePersianCalendarData(null, new Date());

    runInAction(() => {
      this.calendarPayload = newCalendarPayload;
    });
  };

  regenerateCalendar = () => {
    const { activeMonthDate } = this.calendarFilters;
    const newCalendarPayload = generatePersianCalendarData(null, activeMonthDate);

    runInAction(() => {
      this.calendarPayload = newCalendarPayload;
    });
  };
}
