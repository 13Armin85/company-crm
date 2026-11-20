import { Link, useParams } from "react-router";
import { useNavigationDocument } from "../navigation";
import { PageHeader } from "../components";
import { categoryEntries } from "../navigation-paths";
import HomePage from "./home";
import NotFoundPage from "./not-found";

export default function CategoryPage() {
  const { category: code } = useParams();
  const document = useNavigationDocument();
  const category = document?.categories.find((item) => item.id === code);
  if (!category) return <NotFoundPage />;
  if (category.items.some((item) => item.path === "/")) return <HomePage />;
  return (
    <section>
      <PageHeader title={category.title} />
      <nav className="quick-links" aria-label={category.title}>
        {categoryEntries(document, category.id).map((item) => (
          <Link className="button button-secondary" key={item.code} to={item.to}>
            {item.label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
