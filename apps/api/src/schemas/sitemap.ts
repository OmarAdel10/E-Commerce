import { z } from "@hono/zod-openapi";
import { SITEMAP_MAX_PAGE, SITEMAP_PAGE_SIZE } from "@scalius/shared/sitemap-pagination";
import { marketPresenceQueryField } from "./markets";

/** All catalog sitemap reads share bounded pages and expose their complete count. */
export const sitemapQuerySchema = z.object({
  presence: marketPresenceQueryField,
  page: z.coerce.number().int().min(1).max(SITEMAP_MAX_PAGE).optional().default(1).openapi({ description: "Page number" }),
  limit: z.coerce.number().int().min(1).max(SITEMAP_PAGE_SIZE).optional().default(SITEMAP_PAGE_SIZE).openapi({ description: "Items per page" }),
});
