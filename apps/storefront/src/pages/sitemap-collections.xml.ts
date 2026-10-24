/** Published, indexable collections; one bounded page per XML document. */
import type { APIRoute } from "astro";
import { normalizeResourceCanonicalPath } from "@scalius/shared/seo-canonical";
import { paginatedSitemapResponse } from "@/lib/sitemap-utils";
import { getSitemapCollections } from "@/lib/api/collections";

export const prerender = false;

export const GET: APIRoute = ({ url }) => paginatedSitemapResponse(
  url,
  getSitemapCollections,
  (row) => normalizeResourceCanonicalPath("collection", row.canonicalPath) ?? `/collections/${encodeURIComponent(row.id)}`,
  "Collection sitemap is temporarily unavailable",
);
