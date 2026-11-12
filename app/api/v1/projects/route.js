// /api/v1/projects — мои проекты (черновики книг и печати).
// GET — список; POST { productSlug, title?, options? } — новый проект. Только для роли client.
import { limitWrite, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { findProduct, loadCatalog, normalizeOptions } from "@/lib/server/catalog";
import { json, jsonError } from "@/lib/server/http";
import { optionsSchema, PROJECT_FIELDS, shapeProject, withoutLocalEdits } from "@/lib/server/projects";

const createSchema = z.strictObject({
  productSlug: z.string().regex(/^[a-z0-9-]{2,40}$/, "Выберите продукт из каталога."),
  title: z.string().trim().max(100, "Название — до 100 символов.").optional(),
  options: optionsSchema.optional(),
});

export async function GET(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { data, error } = await ctx.db
    .from("projects")
    .select(`${PROJECT_FIELDS}, project_photos(count)`)
    .eq("user_id", ctx.userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return serverError();
  return json({
    ok: true,
    items: data.map((r) => ({ ...shapeProject(r), photoCount: r.project_photos?.[0]?.count || 0 })),
  });
}

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const limited = await limitWrite("project-create", ctx.userId, 60, 60);
  if (limited) return limited;
  const { body, response: bad } = await parseBody(request, createSchema);
  if (bad) return bad;

  const catalog = await loadCatalog();
  const product = findProduct(catalog, body.productSlug);
  if (!product) return jsonError(400, "invalid_input", "Такого продукта нет в каталоге.", { fields: { productSlug: "Выберите продукт из каталога." } });
  const { options, error } = normalizeOptions(product, withoutLocalEdits(body.options || {}));
  if (error) return jsonError(400, "invalid_input", error, { fields: { options: error } });

  const { count } = await ctx.db.from("projects").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
  if ((count || 0) >= 100) {
    await ctx.audit("project.create", "project", null, "denied", { reason: "too_many_projects" });
    return jsonError(409, "too_many_projects", "У вас уже 100 проектов. Удалите ненужные черновики.");
  }

  const { data, error: e2 } = await ctx.admin
    .from("projects")
    .insert({ user_id: ctx.userId, product_slug: product.slug, title: body.title || product.name, options })
    .select(PROJECT_FIELDS)
    .single();
  if (e2) {
    await ctx.audit("project.create", "project", null, "error", { product: product.slug });
    return serverError();
  }
  await ctx.audit("project.create", "project", data.id, "success", { product: product.slug });
  return json({ ok: true, project: shapeProject(data, []) }, 201);
}
