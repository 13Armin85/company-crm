import { useState } from "react";
import { Navigate } from "react-router";
import { useMembers, useWorkspaceAccess } from "../api";
import { useAbsences, useAccessMutation } from "../access/api";
import { AccessModal } from "../access/components";
import type { Absence } from "../access/types";
import { Button, PageHeader, Skeleton } from "../components";
import { persianDate } from "../utils";

const statusNames = { active: "فعال", upcoming: "آینده", ended: "پایان‌یافته", cancelled: "لغوشده" };
const localDate = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function AbsencesPage() {
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data, isLoading, error } = useAbsences(access?.can("Absence.View") ?? false);
  const { data: members = [] } = useMembers();
  const mutation = useAccessMutation();
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
      startsAt: localDate(row.starts_at),
      endsAt: localDate(row.ends_at),
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
      {error && <p role="alert">دریافت عدم حضورها انجام نشد.</p>}
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
              {data?.absences.map((row) => (
                <tr key={row.id}>
                  <td>{row.user_name}</td>
                  <td>
                    {persianDate(row.starts_at, { year: "numeric" })} — {persianDate(row.ends_at, { year: "numeric" })}
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
      <section className="panel">
        <h2>جانشینی‌های فعال</h2>
        {data?.delegations.length ? (
          data.delegations.map((row) => (
            <p key={row.unit_id}>
              {row.user_name}، جانشین {row.manager_name} در {row.unit_name} · {row.reason} · تا{" "}
              {persianDate(row.ends_at, { year: "numeric" })}
            </p>
          ))
        ) : (
          <p>جانشینی فعالی وجود ندارد.</p>
        )}
      </section>
      {editing && (
        <AccessModal
          title={editing.id ? "ویرایش عدم حضور" : "ثبت عدم حضور"}
          busy={mutation.isPending}
          onClose={() => setEditing(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editing.endsAt <= editing.startsAt) return;
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
            <label>
              <span>کاربر</span>
              <select
                required
                disabled={Boolean(editing.id)}
                value={editing.user}
                onChange={(event) => setEditing({ ...editing, user: event.target.value })}
              >
                <option value="">انتخاب کاربر</option>
                {members
                  .filter(
                    (row) =>
                      row.id === editing.user || (row.isActive !== false && data?.manageable_user_ids.includes(row.id))
                  )
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>شروع</span>
              <input
                type="datetime-local"
                dir="ltr"
                required
                value={editing.startsAt}
                onChange={(event) => setEditing({ ...editing, startsAt: event.target.value })}
              />
            </label>
            <label>
              <span>پایان</span>
              <input
                type="datetime-local"
                dir="ltr"
                required
                value={editing.endsAt}
                onChange={(event) => setEditing({ ...editing, endsAt: event.target.value })}
              />
            </label>
            <label>
              <span>علت</span>
              <textarea
                value={editing.reason}
                onChange={(event) => setEditing({ ...editing, reason: event.target.value })}
              />
            </label>
            {editing.startsAt && editing.endsAt && editing.endsAt <= editing.startsAt && (
              <p role="alert">پایان باید بعد از شروع باشد.</p>
            )}
            <footer>
              <Button
                type="submit"
                disabled={
                  mutation.isPending || !editing.startsAt || !editing.endsAt || editing.endsAt <= editing.startsAt
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
