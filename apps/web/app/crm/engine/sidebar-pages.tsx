import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, LayoutGrid, Plus } from "lucide-react";
import { AccessModal } from "../access/components";
import { api, errorMessage } from "../api";
import { Button } from "../components";
import { ErrorNotice } from "../error-state";
import { useUIStore } from "../store";
import { enginePath, useEngineCatalog, useEngineSlug } from "./api";
import type { EntityDefinition } from "./api";

const VISIBLE_PAGES = 8;
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,59}$/;

/** Tables built in the form designer; system tables already have their own menu items. */
export function customPages(entities: EntityDefinition[] = []) {
  return entities
    .filter((entity) => !entity.parent && !entity.adapter && entity.is_active)
    .sort((a, b) => a.title.localeCompare(b.title, "fa"));
}

export const suggestCode = () => `page-${Math.random().toString(36).slice(2, 7)}`;

const defaultDraft = {
  tabs: [],
  sections: [{ id: "main", title: "اطلاعات اصلی", columns: 2, bindings: [{ field: "title" }] }],
};

export function NewPageDialog({ onClose, initialTitle = "" }: { onClose: () => void; initialTitle?: string }) {
  const slug = useEngineSlug();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState(initialTitle);
  const [code, setCode] = useState(suggestCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const validCode = CODE_PATTERN.test(code);

  const create = async () => {
    setBusy(true);
    setError(null);
    const base = enginePath(slug);
    try {
      // A page is a table plus a published form, so records can be added right away.
      await api.post(`${base}/definitions/entities/`, { code, title: title.trim() });
      const saved = (await api.put(`${base}/forms/${code}/`, { revision: 0, draft: defaultDraft })).data as {
        revision: number;
      };
      await api.post(`${base}/forms/${code}/`, { revision: saved.revision, change_note: "ساخت صفحه" });
      await client.invalidateQueries({ queryKey: ["entity-engine", slug] });
      useUIStore.getState().toast(`صفحهٔ «${title.trim()}» ساخته شد`);
      onClose();
      navigate(`/entities/${code}`);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccessModal title="ساخت صفحهٔ جدید" onClose={onClose} busy={busy}>
      <form
        className="sidebar-new-page"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && validCode && !busy) void create();
        }}
      >
        <p>
          برای هر نوع اطلاعات یک صفحه بسازید؛ مثل قرارداد، فاکتور یا تأمین‌کننده. بعداً از «طراحی فرم‌ها و جدول‌ها» فیلدها و
          ارتباط‌هایش را اضافه کنید.
        </p>
        <label>
          نام صفحه
          <input
            required
            maxLength={255}
            value={title}
            placeholder="مثلاً قرارداد"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          کد انگلیسی
          <input
            required
            dir="ltr"
            maxLength={60}
            value={code}
            aria-invalid={!validCode}
            onChange={(event) => setCode(event.target.value.toLowerCase())}
          />
          <small>
            در آدرس صفحه استفاده می‌شود و بعداً قابل تغییر نیست؛ فقط حروف کوچک انگلیسی، عدد و خط تیره (مثلاً contract).
          </small>
        </label>
        <ErrorNotice message={error ? errorMessage(error, "ساخت صفحه انجام نشد.") : undefined} />
        <footer className="engine-actions">
          <Button type="submit" disabled={busy || !title.trim() || !validCode}>
            {busy ? "در حال ساخت…" : "ساخت صفحه"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            انصراف
          </Button>
        </footer>
      </form>
    </AccessModal>
  );
}

export function SidebarPages({
  canCreate,
  collapsed,
  onNavigate,
}: {
  canCreate: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const catalog = useEngineCatalog();
  const [creating, setCreating] = useState(false);
  const pages = customPages(catalog.data?.entities);
  if (!pages.length && !canCreate) return null;
  return (
    <div className="recent-projects sidebar-pages">
      <p>
        صفحه‌ها{" "}
        {canCreate && (
          <button type="button" aria-label="ساخت صفحهٔ جدید" title="ساخت صفحهٔ جدید" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </button>
        )}
      </p>
      {pages.slice(0, VISIBLE_PAGES).map((page) => (
        <NavLink
          key={page.code}
          to={`/entities/${page.code}`}
          title={collapsed ? page.title : undefined}
          onClick={onNavigate}
        >
          <FileText size={15} aria-hidden="true" />
          <span>{page.title}</span>
        </NavLink>
      ))}
      {pages.length > VISIBLE_PAGES && (
        <NavLink to="/entities" end title={collapsed ? "همه صفحه‌ها" : undefined} onClick={onNavigate}>
          <LayoutGrid size={15} aria-hidden="true" />
          <span>همه صفحه‌ها ({pages.length.toLocaleString("fa-IR")})</span>
        </NavLink>
      )}
      {!pages.length && canCreate && (
        <button type="button" className="sidebar-pages-empty" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden="true" />
          <span>اولین صفحه را بسازید</span>
        </button>
      )}
      {creating && <NewPageDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
