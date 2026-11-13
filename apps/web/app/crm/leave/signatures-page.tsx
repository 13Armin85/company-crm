/** Admin page: upload or replace users' signature images (Signature.Manage) and see each access. */
import { useState } from "react";
import { Navigate } from "react-router";
import { useWorkspaceAccess } from "../api";
import { useSlug } from "../api/client";
import { signatureImageUrl, useSignatureHistory, useSignatures, useUploadSignature } from "../api/leave";
import { Button, PageHeader, Skeleton } from "../components";
import { SignatureHistoryList } from "./components";
import { SIGNATURE_NOTICE } from "./model";

export default function SignaturesPage() {
  const slug = useSlug();
  const { data: access, isLoading } = useWorkspaceAccess();
  const allowed = access?.can("Signature.Manage") ?? false;
  const rows = useSignatures(allowed);
  const upload = useUploadSignature();
  const [selected, setSelected] = useState<string>();
  const [shown, setShown] = useState<string>();
  const history = useSignatureHistory(selected);
  if (isLoading) return <Skeleton rows={5} />;
  if (!allowed) return <Navigate to="/leave-requests" replace />;
  return (
    <div className="leave-page" dir="rtl">
      <PageHeader
        eyebrow="مرخصی"
        title="تصویر امضای کاربران"
        description="فقط PNG یا JPG تا ۱ مگابایت. پس از جایگزینی، کاربر باید دوباره اجازهٔ درج تصویر را بدهد."
      />
      <p className="leave-notice">{SIGNATURE_NOTICE}</p>
      {!rows.data ? (
        <Skeleton rows={5} />
      ) : (
        <table className="leave-table">
          <thead>
            <tr>
              <th>کاربر</th>
              <th>وضعیت تصویر</th>
              <th>اجازهٔ کاربر</th>
              <th>اقدام</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.results.map(({ user, signature }) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>
                  {signature
                    ? `بارگذاری‌شده در ${new Date(signature.uploaded_at).toLocaleDateString("fa-IR")}`
                    : "ندارد"}
                </td>
                <td>{signature ? (signature.has_consent ? "داده است" : "نداده است") : "—"}</td>
                <td className="leave-actions">
                  <label className="button button-secondary">
                    {signature ? "جایگزینی" : "بارگذاری"}
                    <input
                      hidden
                      type="file"
                      accept="image/png,image/jpeg"
                      disabled={upload.isPending}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate({ userId: user.id, file });
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {signature && (
                    <Button variant="ghost" onClick={() => setShown(shown === user.id ? undefined : user.id)}>
                      {shown === user.id ? "بستن تصویر" : "دیدن تصویر"}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setSelected(user.id)}>
                    سابقه
                  </Button>
                  {shown === user.id && (
                    <img
                      className="leave-signature-thumb"
                      src={signatureImageUrl(slug, user.id)}
                      alt={`امضای ${user.name}`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && (
        <section className="leave-card" aria-label="سابقهٔ امضا">
          <h2>سابقهٔ تصویر امضا</h2>
          {history.data ? <SignatureHistoryList events={history.data} /> : <Skeleton rows={3} />}
        </section>
      )}
    </div>
  );
}
