/** Published, indexable categories; one bounded page per XML document. */
import type { APIRoute } from "astro";
import { normalizeResourceCanonicalPath } from "@scalius/shared/seo-canonical";
import { paginatedSitemapResponse } from "@/lib/sitemap-utils";
import { getSitemapCategories } from "@/lib/api/categories";

export const prerender = false;

export const GET: APIRoute = ({ url }) => paginatedSitemapResponse(
  url,
  getSitemapCategories,
  (row) => normalizeResourceCanonicalPath("category", row.canonicalPath) ?? `/categories/${row.slug}`,
  "Category sitemap is temporarily unavailable",
);
