import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchableSelect } from "../../../../../../packages/ui/src/form-fields/searchable-select";
import { CompactMultiSelector } from "../../../../../../packages/ui/src/form-fields/compact-multi-selector";
import "../../../../../../packages/tailwind-config/crm-theme.css";
import "../../../../styles/engine.css";

function Fixture() {
  const [column, setColumn] = useState("79");
  const [mode, setMode] = useState("block");
  const [roles, setRoles] = useState<string[]>([]);
  return (
    <main className="page-content" style={{ minHeight: 3500 }}>
      <div style={{ height: 1400 }} />
      <div className="engine-workspace">
        <section className="engine-workspace-main">
          <div className="engine-workspace-panel">
            <div className="engine-rules-card">
              <div className="engine-rules-form">
                <label>
                  نام گروه یکتا
                  <input defaultValue="آزمایش" />
                </label>
                <SearchableSelect
                  label="افزودن ستون به گروه"
                  value={column}
                  options={Array.from({ length: 80 }, (_, index) => ({ id: String(index), title: `ستون ${index}` }))}
                  onChange={setColumn}
                />
                <SearchableSelect
                  label="روش اجرا"
                  value={mode}
                  options={[
                    { id: "block", title: "مسدود کن" },
                    { id: "warn", title: "فقط هشدار بده" },
                  ]}
                  onChange={setMode}
                />
                <CompactMultiSelector
                  label="نقش‌های مجاز"
                  options={[
                    { id: "admin", title: "مدیر" },
                    { id: "member", title: "عضو" },
                  ]}
                  selected={roles}
                  onChange={setRoles}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
