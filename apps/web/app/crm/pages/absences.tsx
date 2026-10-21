import { EngineRecordForm } from "../engine/record-form";
import { useState } from "react";
import { Navigate } from "react-router";
import { useCurrentUser, useWorkspaceAccess } from "../api";
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
      <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام کاربر یا علت عدم حضور…" />
      {isLoading ? (
        <Skeleton rows={5} />
      ) : (
        <div className="table-card">
          <SurfaceTable code="leave">
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
                    <td>{row.user_name}</td>
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
          </SurfaceTable>
        </div>
      )}
      {editing && (
        <AccessModal
          title={editing.id ? "ویرایش عدم حضور" : "ثبت عدم حضور"}
          busy={mutation.isPending}
          onClose={() => setEditing(undefined)}
        >
          <EngineRecordForm
            code="leave"
            id={editing.id || ""}
            onSaved={() => setEditing(undefined)}
            onCancel={() => setEditing(undefined)}
          />
        </AccessModal>
      )}
    </div>
  );
}
import { SurfaceTable } from "../engine/surface";
