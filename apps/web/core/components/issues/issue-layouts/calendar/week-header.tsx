/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
const weekdays = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

type Props = {
  isLoading: boolean;
  showWeekends: boolean;
};

export const CalendarWeekHeader = observer(function CalendarWeekHeader(props: Props) {
  const { isLoading, showWeekends } = props;
  return (
    <div
      className={`relative sticky top-0 z-[1] grid divide-subtle-1 text-13 font-medium md:divide-x-[0.5px] ${
        showWeekends ? "grid-cols-7" : "grid-cols-6"
      }`}
    >
      {isLoading && (
        <div className="absolute h-[1.5px] w-3/4 animate-[bar-loader_2s_linear_infinite] bg-accent-primary" />
      )}
      {weekdays.map((day, index) => {
        if (!showWeekends && index === 6) return null;
        return (
          <div key={day} className="flex h-11 items-center justify-center bg-layer-1 px-4 md:justify-end">
            {day}
          </div>
        );
      })}
    </div>
  );
});
