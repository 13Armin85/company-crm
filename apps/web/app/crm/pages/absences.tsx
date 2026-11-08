import { ErrorNotice } from "../error-state";
import { EngineRecordForm } from "../engine/record-form";
import { useState } from "react";
import { Navigate } from "react-router";
import { useCurrentUser, useWorkspaceAccess, errorMessage } from "../api";
import { useAccessMutation } from "../access/api";
import { AccessModal } from "../access/components";
import type { Absence } from "../access/types";
import { Button, PageHeader, SearchBox, Skeleton } from "../components";
import { persianDate } from "../utils";
import { useAbsencesTable } from "../table-hooks";
import { useDebouncedValue, useTablePaging } from "../table-query";
import { TablePagination } from "../table-pagination";

const statusNames = { active: "فعال", upcoming: "آینده", ended: "پایان‌یافته", cancelled: "لغوشده" };
export default function AbsencesPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const mutation = useAccessMutation();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query);
  const paging = useTablePaging("absences", search);
  const table = useAbsencesTable({ q: search, ...paging, enabled: access?.can("Absence.View") ?? false });
  const { isLoading, error } = table;
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
      <ErrorNotice message={error && errorMessage(error, "دریافت فهرست عدم حضورها انجام نشد")} />
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
              {table.data?.rows.map((row) => (
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
          <TablePagination
            page={table.data?.page ?? 1}
            pages={table.data?.pages ?? 1}
            count={table.data?.count ?? 0}
            pageSize={paging.pageSize}
            onPage={paging.setPage}
            onPageSize={paging.setPageSize}
            loading={table.isFetching}
            label="مورد"
          />
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
