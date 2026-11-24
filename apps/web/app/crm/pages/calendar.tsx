import { jalaliToDateOnly, parseDateOnly, zonedDateTime } from "@plane/ui";
import { useMemo, useState } from "react";
import { jalaaliMonthLength } from "jalaali-js";
import { useCurrentUser } from "../api";
import { useWorkCalendar } from "../api/work-calendar";
import { PageHeader } from "../components";
import { IssueCalendar } from "../issue-calendar";
import { LayerChips } from "../work-calendar/components";
import { WorkCalendarDayDialog } from "../work-calendar/day-dialog";
import { ALL_LAYERS, dayChips } from "../work-calendar/model";
import type { LayerId } from "../work-calendar/model";

/** First and last Gregorian dates of the Jalali month containing `value`. */
export function monthRange(value: string) {
  const parsed = parseDateOnly(value)!;
  return {
    start: jalaliToDateOnly(parsed.jy, parsed.jm, 1),
    end: jalaliToDateOnly(parsed.jy, parsed.jm, jalaaliMonthLength(parsed.jy, parsed.jm)),
  };
}

export default function CalendarPage() {
  const { data: currentUser } = useCurrentUser();
  const [date, setDate] = useState(() => zonedDateTime(new Date())!.date);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [personId, setPersonId] = useState("");
  const [layers, setLayers] = useState<Set<LayerId>>(ALL_LAYERS);
  const range = useMemo(() => monthRange(date), [date]);
  const { data: calendar, isLoading } = useWorkCalendar(personId || undefined, range.start, range.end);

  return (
    <div className="work-calendar-page">
      <PageHeader
        eyebrow="برنامه تیم"
        title="تقویم"
        description="یک بار برای انتخاب روز و دو بار برای دیدن جزئیات و ثبت رویداد روی همان روز کلیک کنید."
      />
      <IssueCalendar
        issues={[]}
        projects={[]}
        timeZone={currentUser?.timeZone}
        isLoading={isLoading}
        value={date}
        onValueChange={setDate}
        onDayDoubleClick={(selectedDate) => {
          setDate(selectedDate);
          setOpenDate(selectedDate);
        }}
        emptyHidden
        hideIssueCount
        renderDay={(day) => <LayerChips chips={dayChips(calendar, day, layers)} />}
      />
      {openDate && (
        <WorkCalendarDayDialog
          date={openDate}
          personId={personId}
          onPersonChange={setPersonId}
          layers={layers}
          onLayersChange={setLayers}
          onClose={() => setOpenDate(null)}
        />
      )}
    </div>
  );
}
