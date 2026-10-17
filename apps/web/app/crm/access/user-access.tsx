import { useState } from "react";
import { normalizePersianSearch, PersianDateTimePicker, SearchableSelect } from "@plane/ui";
import { useCurrentUser, useOrganizationPermissions, useWorkspaceAccess, errorMessage } from "../api";
import { Button, Skeleton } from "../components";
import { persianDate } from "../utils";
import { permissionPresentation } from "./permission-labels";
import { useAccessMutation, useUserAccess, useUserExceptions } from "./api";
import type { PermissionException } from "./types";

export function UserAccessPanel({ userId }: { userId: string }) {
  const { data: currentUser } = useCurrentUser();
  const { data: access } = useWorkspaceAccess();
  const effectiveQuery = useUserAccess(userId, access?.can("Access.EffectivePermission.View") ?? false);
  const exceptionQuery = useUserExceptions(userId, access?.can("Access.UserException.View") ?? false);
  const {
    data: permissions = [],
    isLoading: permissionsLoading,
    error: permissionsError,
  } = useOrganizationPermissions(
    undefined,
    Boolean(access?.can("Permission.View") || access?.can("Access.UserException.Manage"))
  );
  const mutation = useAccessMutation();
  const [permission, setPermission] = useState("");
  const [effect, setEffect] = useState<"ALLOW" | "DENY">("ALLOW");
  const [roleQuery, setRoleQuery] = useState("");
  const [directQuery, setDirectQuery] = useState("");
  const [editing, setEditing] = useState<PermissionException>();
  const [editPeriod, setEditPeriod] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formError, setFormError] = useState("");
  const [conflictConfirmed, setConflictConfirmed] = useState(false);
  const present = (id: string, code: string, name?: string, category?: string, description?: string) =>
    permissionPresentation(
      permissions.find((row) => row.id === id) ?? {
        id,
        code,
        name: name ?? "",
        category: category ?? code.split(".")[0],
        description: description ?? "",
        isActive: true,
        isDelegatable: false,
      }
    );
  const exceptions = (exceptionQuery.data ?? []).filter((row) => row.is_active);
  const grants = (effectiveQuery.data?.role_grants ?? []).map((row) =>
    Object.assign({}, row, present(row.id, row.code, row.name, row.category, row.description))
  );
  const visibleGrants = grants.filter((row) =>
    normalizePersianSearch(
      `${row.name} ${row.category} ${row.description} ${row.code} ${row.role_names?.join(" ")}`
    ).includes(normalizePersianSearch(roleQuery))
  );
  const direct = exceptions
    .map((row) => ({
      row,
      permission: present(
        row.permission,
        row.permission_code,
        row.permission_name,
        row.permission_category,
        row.permission_description
      ),
    }))
    .filter(({ permission: item }) =>
      normalizePersianSearch(`${item.name} ${item.category} ${item.description} ${item.code}`).includes(
        normalizePersianSearch(directQuery)
      )
    );
  const now = Date.now();
  const activeNow = (row: PermissionException) =>
    (!row.starts_at || Date.parse(row.starts_at) <= now) && (!row.ends_at || Date.parse(row.ends_at) > now);
  const conflicting =
    effect === "DENY"
      ? exceptions.find(
          (row) => row.id !== editing?.id && row.permission === permission && row.effect === "ALLOW" && activeNow(row)
        )
      : undefined;
  const reset = () => {
    setEditing(undefined);
    setPermission("");
    setEffect("ALLOW");
    setEditPeriod(false);
    setFormError("");
    setConflictConfirmed(false);
    mutation.reset();
  };
  const edit = (row: PermissionException) => {
    reset();
    setEditing(row);
    setPermission(row.permission);
    setEffect(row.effect);
    setStartsAt(row.starts_at ?? "");
    setEndsAt(row.ends_at ?? "");
  };
  if (!access || (!access.can("Access.UserException.View") && !access.can("Access.EffectivePermission.View")))
    return null;
  return (
    <section className="panel user-access-panel">
      <h2>دسترسی کاربر</h2>
      {access.can("Access.EffectivePermission.View") && (
        <section>
          <h3>مجوزهای ناشی از نقش‌ها</h3>
          <label>
            <span>جستجوی مجوزهای نقش</span>
            <input type="search" value={roleQuery} onChange={(event) => setRoleQuery(event.target.value)} />
          </label>
          {effectiveQuery.error ? (
            <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>
          ) : effectiveQuery.isLoading ? (
            <Skeleton rows={4} />
          ) : !visibleGrants.length ? (
            <p role="status">مجوزی از نقش‌های فعال برای این جستجو وجود ندارد.</p>
          ) : (
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>دسته / مجوز</th>
                    <th>نقش‌های اعطاکننده</th>
                    <th>نتیجهٔ نهایی</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGrants
                    // eslint-disable-next-line unicorn/no-array-sort -- This filtered copy supports browsers without Array.toSorted.
                    .sort((a, b) => a.category.localeCompare(b.category, "fa"))
                    .map((row) => {
                      const final = effectiveQuery.data?.explanations.find((item) => item.code === row.code);
                      return (
                        <tr key={row.id}>
                          <td>
                            <small>{row.category}</small>
                            <b>{row.name}</b>
                          </td>
                          <td>{row.role_names?.join("، ")}</td>
                          <td>
                            {final?.granted ? "مجاز" : "غیرمجاز"}
                            {final?.source === "user_deny" && <small>منع مستقیم؛ منشأ نقش حفظ شده است.</small>}
                            {final?.has_conflict && <small>تعارض؛ منع اولویت دارد.</small>}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {access.can("Access.UserException.Manage") && (
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            if (mutation.isPending || !permission) return;
            const originalStart = editPeriod ? startsAt || null : (editing?.starts_at ?? null);
            const originalEnd = editPeriod ? endsAt || null : (editing?.ends_at ?? null);
            if (
              exceptions.some(
                (row) =>
                  row.id !== editing?.id &&
                  row.permission === permission &&
                  row.effect === effect &&
                  row.starts_at === originalStart &&
                  row.ends_at === originalEnd
              )
            ) {
              setFormError("این دسترسی و بازه زمانی قبلاً ثبت شده است؛ همان مورد را ویرایش کنید.");
              return;
            }
            if (originalStart && originalEnd && Date.parse(originalEnd) <= Date.parse(originalStart)) {
              setFormError("زمان پایان باید بعد از زمان شروع باشد.");
              return;
            }
            if (conflicting && !conflictConfirmed) {
              setFormError("پیش از ذخیره این محدودیت، تداخل دسترسی را تأیید کنید.");
              return;
            }
            mutation.mutate(
              {
                path: `users/${userId}/exceptions/${editing ? `${editing.id}/` : ""}`,
                method: editing ? "patch" : "post",
                body: { permission, effect, ...(editPeriod ? { starts_at: originalStart, ends_at: originalEnd } : {}) },
              },
              { onSuccess: reset }
            );
          }}
        >
          <h3>{editing ? "ویرایش دسترسی مستقیم" : "افزودن دسترسی مستقیم"}</h3>
          <label htmlFor="direct-permission">
            <span>مجوز</span>
            <SearchableSelect
              id="direct-permission"
              label="مجوز"
              loading={permissionsLoading}
              error={permissionsError ? "فهرست دسترسی‌ها دریافت نشد." : undefined}
              value={permission}
              disabled={mutation.isPending}
              onChange={(id) => {
                setPermission(id);
                setConflictConfirmed(false);
                setFormError("");
              }}
              options={permissions.map(permissionPresentation).map((row) => ({
                id: row.id,
                title: row.name,
                description: `${row.category} ${row.description} ${row.code}`,
                disabled: !row.isActive,
              }))}
            />
          </label>
          <label>
            <span>نوع اثر</span>
            <select
              disabled={mutation.isPending}
              value={effect}
              onChange={(event) => {
                setEffect(event.target.value as "ALLOW" | "DENY");
                setConflictConfirmed(false);
              }}
            >
              <option value="ALLOW">اجازه</option>
              <option value="DENY">منع</option>
            </select>
          </label>
          {editing && (editing.starts_at || editing.ends_at) && (
            <div className="form-message">
              <p>این رکورد زمان‌دار است؛ بازهٔ قبلی هنگام ذخیره حفظ می‌شود.</p>
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => setEditPeriod(!editPeriod)}>
                ویرایش بازهٔ قبلی
              </Button>
              {editPeriod && (
                <>
                  <fieldset className="crm-date-field">
                    <legend>شروع اختیاری</legend>
                    <PersianDateTimePicker
                      timeZone={currentUser?.timeZone}
                      label="شروع اختیاری"
                      disabled={mutation.isPending}
                      value={startsAt}
                      onChange={setStartsAt}
                    />
                  </fieldset>
                  <fieldset className="crm-date-field">
                    <legend>پایان اختیاری</legend>
                    <PersianDateTimePicker
                      timeZone={currentUser?.timeZone}
                      label="پایان اختیاری"
                      disabled={mutation.isPending}
                      value={endsAt}
                      onChange={setEndsAt}
                    />
                  </fieldset>
                </>
              )}
            </div>
          )}
          {conflicting && (
            <div className="form-message" role="alert">
              <p>برای این مجوز اجازهٔ مستقیم ثبت شده است؛ ثبت منع باعث می‌شود نتیجهٔ نهایی غیرمجاز شود.</p>
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => edit(conflicting)}>
                ویرایش اجازهٔ موجود
              </Button>
              <label className="active-toggle">
                <input
                  type="checkbox"
                  disabled={mutation.isPending}
                  checked={conflictConfirmed}
                  onChange={(event) => setConflictConfirmed(event.target.checked)}
                />
                <span>اثر منع را تأیید می‌کنم</span>
              </label>
            </div>
          )}
          {(formError || mutation.error) && (
            <p role="alert">{formError || errorMessage(mutation.error, "ذخیره دسترسی انجام نشد.")}</p>
          )}
          <footer>
            <Button
              type="submit"
              disabled={mutation.isPending || !permission || Boolean(conflicting && !conflictConfirmed)}
            >
              {editing ? "ذخیره دسترسی" : "افزودن دسترسی"}
            </Button>
            {editing && (
              <Button variant="secondary" disabled={mutation.isPending} onClick={reset}>
                انصراف از ویرایش
              </Button>
            )}
          </footer>
        </form>
      )}
      {access.can("Access.UserException.View") && (
        <section>
          <h3>دسترسی‌های مستقیم</h3>
          <label>
            <span>جستجوی دسترسی‌های مستقیم</span>
            <input type="search" value={directQuery} onChange={(event) => setDirectQuery(event.target.value)} />
          </label>
          {exceptionQuery.error ? (
            <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>
          ) : exceptionQuery.isLoading ? (
            <Skeleton rows={4} />
          ) : !direct.length ? (
            <p role="status">دسترسی مستقیمی برای این جستجو وجود ندارد.</p>
          ) : (
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>دسته / مجوز</th>
                    <th>نوع اثر</th>
                    <th>وضعیت</th>
                    <th>نتیجهٔ نهایی</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {direct
                    // eslint-disable-next-line unicorn/no-array-sort -- This filtered copy supports browsers without Array.toSorted.
                    .sort((a, b) => a.permission.category.localeCompare(b.permission.category, "fa"))
                    .map(({ row, permission: item }) => {
                      const final = effectiveQuery.data?.explanations.find(
                        (entry) => entry.code === row.permission_code
                      );
                      return (
                        <tr key={row.id}>
                          <td>
                            <small>{item.category}</small>
                            <b>{item.name}</b>
                          </td>
                          <td>{row.effect === "ALLOW" ? "اجازه" : "منع"}</td>
                          <td>
                            {activeNow(row)
                              ? "فعال"
                              : row.ends_at && Date.parse(row.ends_at) <= now
                                ? "منقضی"
                                : "آینده"}
                            {(row.starts_at || row.ends_at) && (
                              <small>
                                {row.starts_at
                                  ? persianDate(row.starts_at, {
                                      year: "numeric",
                                      hour: "2-digit",
                                      timeZone: currentUser?.timeZone,
                                    })
                                  : "بدون شروع"}{" "}
                                —{" "}
                                {row.ends_at
                                  ? persianDate(row.ends_at, {
                                      year: "numeric",
                                      hour: "2-digit",
                                      timeZone: currentUser?.timeZone,
                                    })
                                  : "بدون پایان"}
                              </small>
                            )}
                          </td>
                          <td>
                            {final ? (final.granted ? "مجاز" : "غیرمجاز") : "نیاز به مجوز مشاهدهٔ نتیجه"}
                            {final?.has_conflict && <small>تعارض اجازه و منع؛ منع اولویت دارد.</small>}
                          </td>
                          <td className="row-actions">
                            {access.can("Access.UserException.Manage") && (
                              <>
                                <Button variant="secondary" disabled={mutation.isPending} onClick={() => edit(row)}>
                                  ویرایش دسترسی
                                </Button>
                                <Button
                                  variant="danger"
                                  disabled={mutation.isPending}
                                  onClick={() =>
                                    mutation.mutate({ path: `users/${userId}/exceptions/${row.id}/`, method: "delete" })
                                  }
                                >
                                  حذف دسترسی
                                </Button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {effectiveQuery.data?.explanations
        .filter((row) => row.source === "delegation" && row.granted)
        .map((row) => (
          <p key={row.code}>
            جانشینی موقت: {present(row.id, row.code, row.name, row.category).name}{" "}
            {row.delegations?.map((entry) => `${entry.manager_name} در ${entry.unit_name}`).join("، ")}
          </p>
        ))}
    </section>
  );
}
