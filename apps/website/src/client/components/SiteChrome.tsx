import { Link } from "react-router";
import { BrandWordmark } from "./BrandWordmark";
import { focusRing } from "./ui";

/** Content column shared by the pages inside the app shell. */
export const PAGE_COLUMN = "mx-auto w-full max-w-3xl px-6";

/**
 * Brand mark for the few pages outside the app shell that still need one. The
 * shell draws its own, linked to the board; this one goes to the board too so
 * the mark means the same thing wherever it appears in the app.
 */
export function Brand() {
  return (
    <Link className={`flex items-center rounded-md ${focusRing}`} to="/board">
      <BrandWordmark />
    </Link>
  );
}
