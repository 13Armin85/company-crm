import { Link } from "react-router";
import { BookOpen, CircleHelp, GitBranch, LayoutDashboard, LifeBuoy, Settings2 } from "lucide-react";
import { PageHeader } from "../components";
import "../../../styles/help.css";

const sections = [
  {
    id: "start",
    title: "شروع کار و صفحهٔ خانه",
    icon: LayoutDashboard,
    text: "خانه داشبورد شماست. تب‌ها و ویجت‌ها نمایی از کارها، گزارش‌ها، تقویم و تیم را نشان می‌دهند. با «ویرایش چیدمان» می‌توانید تب، ویجت و ترتیب آن‌ها را تغییر دهید. مدیر می‌تواند از منوی داشبورد، پیش‌فرض هر نقش را تنظیم کند.",
    links: [{ title: "رفتن به خانه", to: "/" }],
  },
  {
    id: "work",
    title: "کارها، پروژه‌ها و صندوق ورودی",
    icon: BookOpen,
    text: "پروژه‌ها محل ثبت و پیگیری کارهای مرتبط هستند. «کارهای من» وظایف و وضعیت‌های مربوط به شما را نشان می‌دهد؛ «همه کارها» برای کاربران مجاز، نمای گسترده‌تری دارد. اعلان‌ها و درخواست‌های تازه را در صندوق ورودی ببینید. تقویم برای دیدن زمان‌بندی و عدم حضور برای ثبت یا بررسی مرخصی است.",
    links: [
      { title: "پروژه‌ها", to: "/projects" },
      { title: "کارهای من", to: "/my-work" },
      { title: "صندوق ورودی", to: "/inbox" },
      { title: "تقویم", to: "/calendar" },
    ],
  },
  {
    id: "routing",
    title: "ارجاع هوشمند و گردش کار",
    icon: GitBranch,
    text: "در ارجاع هوشمند، کارهای منتظر پذیرش را بر اساس نقش و واحد سازمانی ببینید و در صورت داشتن مجوز، مسئولیت آن‌ها را بپذیرید. مدیران می‌توانند قانون‌های ارجاع بسازند تا کارها به صف مناسب هدایت شوند. ساختار سازمانی، اعضای تیم و نقش‌ها نیز از منوی اصلی در دسترس‌اند.",
    links: [
      { title: "ارجاع هوشمند", to: "/routing" },
      { title: "ساختار سازمانی", to: "/organization" },
      { title: "نقش‌ها", to: "/roles" },
    ],
  },
  {
    id: "design",
    title: "فرم‌ها، جدول‌ها و تب‌های شخصی",
    icon: Settings2,
    text: "در «طراحی فرم‌ها و جدول‌ها» ورودی‌ها، ترتیب نمایش، مقدار اولیه، قواعد و ستون‌های جدول را تنظیم کنید. برای تغییر یک ورودی، آن را در فهرست ورودی‌ها ویرایش کنید؛ برای تنظیم رفتار همان ورودی در یک فرم، آن را در چیدمان انتخاب کنید. در «تب‌های من» با برداشتن تیک ستون‌ها، فقط ستون‌های دلخواه را در جدول فعال نگه دارید. انتشار تغییرات سراسری به مجوز مدیر نیاز دارد.",
    links: [{ title: "طراحی فرم‌ها و جدول‌ها", to: "/settings/engine" }],
  },
  {
    id: "account",
    title: "تنظیمات و دسترسی",
    icon: CircleHelp,
    text: "از تنظیمات، اطلاعات و ترجیحات حساب و فضای کاری را مدیریت کنید. نمایش بخش‌ها و امکان ویرایش به نقش و مجوزهای شما وابسته است. اگر گزینه‌ای را نمی‌بینید، از مدیر فضای کاری بخواهید دسترسی نقش شما را بررسی کند.",
    links: [{ title: "تنظیمات", to: "/settings" }],
  },
];

export default function HelpPage() {
  return (
    <div className="crm-help" dir="rtl">
      <PageHeader
        eyebrow="مرکز راهنما"
        title="راهنما و پشتیبانی"
        description="راهنمای بخش‌های سامانه و مسیرهای اصلی کار"
      />
      <div className="crm-help-intro">
        <LifeBuoy size={28} aria-hidden="true" />
        <div>
          <h2>از کجا شروع کنم؟</h2>
          <p>موضوع مورد نظر را انتخاب کنید. لینک‌های هر بخش شما را مستقیم به همان صفحه می‌برند.</p>
        </div>
      </div>
      <nav className="crm-help-index" aria-label="موضوعات راهنما">
        {sections.map((section) => (
          <a href={`#${section.id}`} key={section.id}>
            {section.title}
          </a>
        ))}
      </nav>
      <div className="crm-help-grid">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <section className="crm-help-card" id={section.id} key={section.id}>
              <div className="crm-help-card-heading">
                <Icon size={20} aria-hidden="true" />
                <h2>{section.title}</h2>
              </div>
              <p>{section.text}</p>
              <div className="crm-help-links">
                {section.links.map((link) => (
                  <Link key={link.to} to={link.to}>
                    {link.title}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <p className="crm-help-footer">
        برای خطاهای مربوط به دسترسی، داده یا عملکرد سامانه، نام صفحه و شرح مشکل را به مدیر فضای کاری بدهید.
      </p>
    </div>
  );
}
