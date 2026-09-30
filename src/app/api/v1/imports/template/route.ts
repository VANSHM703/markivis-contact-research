import { targetListTemplate } from "@/domain/imports/target-list";
import { apiRoute } from "@/lib/api/respond";

/** The target list CSV template: every column, with one fictional example row. */
export const GET = apiRoute("records.view", async () =>
  new Response(targetListTemplate(), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="target-list-template.csv"' },
  }),
);
