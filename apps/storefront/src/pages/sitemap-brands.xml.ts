/** Published, indexable brands; one bounded page per XML document. */
import type { APIRoute } from "astro";
import { normalizeResourceCanonicalPath } from "@scalius/shared/seo-canonical";
import { paginatedSitemapResponse } from "@/lib/sitemap-utils";
import { getSitemapBrands } from "@/lib/api/brands";

export const prerender = false;

export const GET: APIRoute = ({ url }) => paginatedSitemapResponse(
  url,
  getSitemapBrands,
  (row) => normalizeResourceCanonicalPath("brand", row.canonicalPath) ?? `/brands/${row.slug}`,
  "Brand sitemap is temporarily unavailable",
);
