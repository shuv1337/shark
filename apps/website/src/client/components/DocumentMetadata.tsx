import { useEffect } from "react";
import { useLocation } from "react-router";
import { BRAND } from "../../shared/brand";
import { PAGE_SEO, seoPageForPath } from "../../shared/seo";

function meta(name: string, content: string): HTMLMetaElement {
  const element = document.createElement("meta");
  element.name = name;
  element.content = content;
  element.dataset.seo = "true";
  return element;
}

function propertyMeta(property: string, content: string): HTMLMetaElement {
  const element = document.createElement("meta");
  element.setAttribute("property", property);
  element.content = content;
  element.dataset.seo = "true";
  return element;
}

/** Private in-app metadata; SHark intentionally publishes no structured data. */
export function DocumentMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    // An address the router does not know renders the 404 page, so it gets the
    // 404 title rather than keeping whichever page the reader came from.
    const metadata = PAGE_SEO[seoPageForPath(pathname) ?? "notFound"];

    document.head.querySelectorAll("[data-seo]").forEach((element) => {
      element.remove();
    });

    const title = document.createElement("title");
    title.textContent = metadata.title;
    title.dataset.seo = "true";
    document.head.append(
      title,
      meta("description", metadata.description),
      meta("robots", "noindex, nofollow"),
      meta("application-name", BRAND.productName),
      propertyMeta("og:title", metadata.title),
      propertyMeta("og:description", metadata.description),
      propertyMeta("og:image", "/ogimage.png"),
    );
  }, [pathname]);

  return null;
}
