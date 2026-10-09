import { Link } from "react-router";
import { BrandWordmark } from "./BrandWordmark";

/** Content column shared by the dashboard, team, and join pages. */
export const PAGE_COLUMN = "mx-auto w-full max-w-3xl px-6";

export function Brand() {
  return (
    <Link to="/dashboard" className="flex items-center">
      <BrandWordmark />
    </Link>
  );
}
