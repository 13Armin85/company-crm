import { ArrowRight, SearchX } from "lucide-react";
import { Link } from "react-router";
export default function NotFoundPage() {
  return (
    <div className="not-found">
      <span>
        <SearchX size={28} />
      </span>
      <b>۴۰۴</b>
      <h1>این صفحه پیدا نشد</h1>
      <p>نشانی واردشده وجود ندارد یا جابه‌جا شده است.</p>
      <Link to="/">
        <ArrowRight size={16} /> بازگشت به خانه
      </Link>
    </div>
  );
}
