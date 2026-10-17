import { IdentifierBadge, PersianDateTimePicker, SearchableSelect } from "@plane/ui";
import { useState } from "react";
import { Navigate } from "react-router";
import { errorMessage, useCurrentUser, useMembers, useWorkspaceAccess } from "../api";
import { useAbsences, useAccessMutation } from "../access/api";
import { AccessModal } from "../access/components";
import type { Absence } from "../access/types";
import { Button, PageHeader, SearchBox, Skeleton } from "../components";
import { persianDate } from "../utils";
import { matchesRecordSearch } from "../identifiers";

const statusNames = { active: "فعال", upcoming: "آینده", ended: "پایان‌یافته", cancelled: "لغوشده" };
export default function AbsencesPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data, isLoading, error } = useAbsences(access?.can("Absence.View") ?? false);
  const { data: members = [] } = useMembers();
  const mutation = useAccessMutation();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{
    id?: string;
    user: string;
    startsAt: string;
    endsAt: string;
    reason: string;
  }>();
  const edit = (row: Absence) =>
    setEditing({
      id: row.id,
      user: row.user,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      reason: row.reason,
    });
  if (accessLoading) return <Skeleton rows={5} />;
  if (!access?.can("Absence.View")) return <Navigate to="/my-work" replace />;
  return (
    <div>
      <PageHeader
        eyebrow="ساختار سازمانی"
        title="مدیریت عدم حضور"
        description="عدم حضور توسط مدیر بالادستی یا مدیر دارای مجوز ثبت می‌شود. بازه‌های هم‌پوشان پذیرفته نمی‌شوند."
        actions={
          access.can("Absence.Create") && (
            <Button onClick={() => setEditing({ user: "", startsAt: "", endsAt: "", reason: "" })}>ثبت عدم حضور</Button>
          )
        }
      />
      {error && <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>}
      <SearchBox value={query} onChange={setQuery} placeholder="جستجوی شناسه، کاربر یا علت عدم حضور…" />
      {isLoading ? (
        <Skeleton rows={5} />
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>کاربر</th>
                <th>بازه</th>
                <th>علت</th>
                <th>وضعیت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {data?.absences
                .filter((row) => matchesRecordSearch(query, [row.id, row.user, row.user_name, row.reason]))
                .map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.user_name}
                      <IdentifierBadge value={row.id} label="شناسه عدم حضور" />
                    </td>
                    <td>
                      {persianDate(row.starts_at, {
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: currentUser?.timeZone,
                      })}{" "}
                      —{" "}
                      {persianDate(row.ends_at, {
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: currentUser?.timeZone,
                      })}
                    </td>
                    <td>{row.reason}</td>
                    <td>{statusNames[row.current_status]}</td>
                    <td className="row-actions">
                      {row.can_edit && (
                        <Button variant="secondary" onClick={() => edit(row)}>
                          ویرایش
                        </Button>
                      )}
                      {row.can_end && (
                        <Button
                          variant="secondary"
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate({ path: `absences/${row.id}/`, method: "delete" })}
                        >
                          پایان عدم حضور
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <AccessModal
          title={editing.id ? "ویرایش عدم حضور" : "ثبت عدم حضور"}
          busy={mutation.isPending}
          onClose={() => setEditing(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                mutation.isPending ||
                !editing.user ||
                !Number.isFinite(Date.parse(editing.startsAt)) ||
                !Number.isFinite(Date.parse(editing.endsAt)) ||
                Date.parse(editing.endsAt) <= Date.parse(editing.startsAt)
              )
                return;
              mutation.mutate(
                {
                  path: editing.id ? `absences/${editing.id}/` : "absences/",
                  method: editing.id ? "patch" : "post",
                  body: {
                    ...(editing.id ? {} : { user: editing.user }),
                    starts_at: new Date(editing.startsAt).toISOString(),
                    ends_at: new Date(editing.endsAt).toISOString(),
                    reason: editing.reason,
                  },
                },
                { onSuccess: () => setEditing(undefined) }
              );
            }}
          >
            <label htmlFor="crm-absences-select-1">
              <span>کاربر</span>
              <SearchableSelect
                id="crm-absences-select-1"
                label="کاربر"
                disabled={Boolean(editing.id) || mutation.isPending}
                value={editing.user}
                onChange={(user) => setEditing({ ...editing, user })}
                options={members
                  .filter(
                    (row) =>
                      row.id === editing.user || (row.isActive !== false && data?.manageable_user_ids.includes(row.id))
                  )
                  .map((row) => ({ id: row.id, title: row.displayName, description: row.email }))}
              />
            </label>
            <fieldset className="crm-date-field">
              <legend>شروع</legend>
              <PersianDateTimePicker
                timeZone={currentUser?.timeZone}
                label="شروع"
                required
                disabled={mutation.isPending}
                value={editing.startsAt}
                onChange={(startsAt) => setEditing({ ...editing, startsAt })}
              />
            </fieldset>
            <fieldset className="crm-date-field">
              <legend>پایان</legend>
              <PersianDateTimePicker
                timeZone={currentUser?.timeZone}
                label="پایان"
                required
                disabled={mutation.isPending}
                value={editing.endsAt}
                onChange={(endsAt) => setEditing({ ...editing, endsAt })}
              />
            </fieldset>
            <label>
              <span>علت</span>
              <textarea
                disabled={mutation.isPending}
                value={editing.reason}
                onChange={(event) => setEditing({ ...editing, reason: event.target.value })}
              />
            </label>
            {editing.startsAt && editing.endsAt && Date.parse(editing.endsAt) <= Date.parse(editing.startsAt) && (
              <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>
            )}
            {mutation.isError && <p role="alert">{errorMessage(mutation.error, "ذخیره عدم حضور انجام نشد.")}</p>}
            <footer>
              <Button
                type="submit"
                disabled={
                  mutation.isPending ||
                  !editing.user ||
                  !editing.startsAt ||
                  !editing.endsAt ||
                  Date.parse(editing.endsAt) <= Date.parse(editing.startsAt)
                }
              >
                ذخیره
              </Button>
            </footer>
          </form>
        </AccessModal>
      )}
    </div>
  );
}
