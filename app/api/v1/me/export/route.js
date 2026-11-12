// GET /api/v1/me/export — все мои данные одним JSON-файлом (профиль, проекты, фото, корзина, заказы,
// обращения, уведомления, журнал моих действий). Доступно любой роли вошедшего пользователя.
import { rateLimited, requireUser, serverError, tooMany } from "@/lib/server/api";
import { exportUserData } from "@/lib/server/account";

export async function GET(request) {
  const { ctx, response } = await requireUser(request, ["client", "moderator", "admin"]);
  if (response) return response;
  if (await rateLimited(`export:${ctx.userId}`, 10, 3600)) return tooMany(3600);
  try {
    const data = await exportUserData(ctx.admin, ctx.userId);
    await ctx.audit("account.export", "user", ctx.userId, "success", { orders: data.orders.length, projects: data.projects.length });
    return new Response(JSON.stringify({ ok: true, ...data }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="picpac-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(e?.message);
    await ctx.audit("account.export", "user", ctx.userId, "error");
    return serverError();
  }
}
