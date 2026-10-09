import { useState } from "react";
import { useOrganizationPermissions, useWorkspaceAccess, errorMessage } from "../api";
import { Button, Skeleton } from "../components";
import { persianDate } from "../utils";
import { useAccessMutation, useUserAccess, useUserExceptions } from "./api";
import type { PermissionException } from "./types";

const localDateTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const sources: Record<string, string> = {
  role: "نقش",
  user_allow: "اجازه مستقیم",
  user_deny: "منع مستقیم",
  delegation: "جانشینی موقت",
  no_access: "بدون دسترسی",
};

export function UserAccessPanel({ userId }: { userId: string }) {
  const { data: access } = useWorkspaceAccess();
  const {
    data: effective,
    isLoading,
    error: effectiveError,
  } = useUserAccess(userId, access?.can("Access.EffectivePermission.View") ?? false);
  const { data: exceptions = [], error: exceptionError } = useUserExceptions(
    userId,
    access?.can("Access.UserException.View") ?? false
  );
  const { data: permissions = [] } = useOrganizationPermissions(undefined, access?.can("Permission.View") ?? false);
  const mutation = useAccessMutation();
  const [permission, setPermission] = useState("");
  const [effect, setEffect] = useState<"ALLOW" | "DENY">("ALLOW");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string>();
  const resetForm = () => {
    setEditing(undefined);
    setPermission("");
    setEffect("ALLOW");
    setStartsAt("");
    setEndsAt("");
    mutation.reset();
  };
  const editException = (row: PermissionException) => {
    mutation.reset();
    setEditing(row.id);
    setPermission(row.permission);
    setEffect(row.effect);
    setStartsAt(localDateTime(row.starts_at));
    setEndsAt(localDateTime(row.ends_at));
  };
  if (!access?.can("Access.UserException.View") && !access?.can("Access.EffectivePermission.View")) return null;
  return (
    <section className="panel user-access-panel">
      <h2>دسترسی کاربر</h2>
      {(effectiveError || exceptionError) && <p role="alert">دریافت اطلاعات دسترسی انجام نشد.</p>}
      {access.can("Access.UserException.View") && (
        <>
          <h3>استثناهای مستقیم</h3>
          {exceptions
            .filter((row) => row.is_active)
            .map((row) => (
              <article key={row.id}>
                <code dir="ltr">{row.permission_code}</code>
                <b>{row.effect === "ALLOW" ? "اجازه" : "منع"}</b>
                <span>
                  {row.starts_at ? persianDate(row.starts_at, { year: "numeric" }) : "بدون شروع"} —{" "}
                  {row.ends_at ? persianDate(row.ends_at, { year: "numeric" }) : "بدون پایان"}
                </span>
                {access.can("Access.UserException.Manage") && (
                  <>
                    <Button variant="secondary" disabled={mutation.isPending} onClick={() => editException(row)}>
                      ویرایش استثنا
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({ path: `users/${userId}/exceptions/${row.id}/`, method: "delete" })
                      }
                    >
                      حذف استثنا
                    </Button>
                  </>
                )}
              </article>
            ))}
        </>
      )}
      {access.can("Access.UserException.Manage") && (
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(
              {
                path: `users/${userId}/exceptions/${editing ? `${editing}/` : ""}`,
                method: editing ? "patch" : "post",
                body: {
                  permission,
                  effect,
                  starts_at: startsAt ? new Date(startsAt).toISOString() : null,
                  ends_at: endsAt ? new Date(endsAt).toISOString() : null,
                },
              },
              {
                onSuccess: resetForm,
              }
            );
          }}
        >
          <label>
            <span>مجوز</span>
            <select dir="ltr" value={permission} onChange={(event) => setPermission(event.target.value)} required>
              <option value="">انتخاب مجوز</option>
              {permissions
                .filter((row) => row.isActive)
                .map((row) => (
                  <option value={row.id} key={row.id}>
                    {row.code} — {row.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>نوع استثنا</span>
            <select value={effect} onChange={(event) => setEffect(event.target.value as "ALLOW" | "DENY")}>
              <option value="ALLOW">اجازه (ALLOW)</option>
              <option value="DENY">منع (DENY)</option>
            </select>
          </label>
          <label>
            <span>شروع اختیاری</span>
            <input
              type="datetime-local"
              dir="ltr"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </label>
          <label>
            <span>پایان اختیاری</span>
            <input type="datetime-local" dir="ltr" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </label>
          <Button
            type="submit"
            disabled={!permission || mutation.isPending || Boolean(startsAt && endsAt && endsAt <= startsAt)}
          >
            {editing ? "ذخیره استثنا" : "افزودن استثنا"}
          </Button>
          {editing && (
            <Button variant="secondary" disabled={mutation.isPending} onClick={resetForm}>
              انصراف از ویرایش
            </Button>
          )}
          {mutation.error && <p role="alert">{errorMessage(mutation.error, "ذخیره استثنا انجام نشد.")}</p>}
        </form>
      )}
      {access.can("Access.EffectivePermission.View") && (
        <>
          <h3>مجوزهای مؤثر و منبع آن‌ها</h3>
          <label>
            <span>جستجوی مجوز</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {isLoading ? (
            <Skeleton rows={4} />
          ) : (
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>مجوز</th>
                    <th>نتیجه</th>
                    <th>منبع</th>
                  </tr>
                </thead>
                <tbody>
                  {effective?.explanations
                    .filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(query.toLowerCase()))
                    .map((row) => (
                      <tr key={row.code}>
                        <td>
                          <b>{row.name}</b>
                          <code dir="ltr">{row.code}</code>
                        </td>
                        <td>
                          {row.granted ? "مجاز" : "غیرمجاز"}
                          {row.has_conflict && <small>تعارض اجازه و منع؛ منع اولویت دارد.</small>}
                        </td>
                        <td>
                          {sources[row.source]}
                          {row.role_names && <small>{row.role_names.join("، ")}</small>}
                          {row.delegations?.map((delegation) => (
                            <small key={delegation.unit_id}>
                              جانشین {delegation.manager_name} در {delegation.unit_name} · {delegation.reason} · تا{" "}
                              {persianDate(delegation.ends_at, { year: "numeric" })}
                            </small>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
