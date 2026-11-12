// Админка: вторая линия защиты после proxy.js. Без входа — 401, без роли модератора или админа — 403.
import AdminNav from "@/components/admin/AdminNav";
import { ROLE_LABELS } from "@/lib/roles";
import { requirePageRole } from "@/lib/server/session";

export const metadata = { title: "Админка — PicPac" };

export default async function AdminLayout({ children }) {
  const auth = await requirePageRole(["moderator", "admin"], "/admin");
  return (
    <div className="admin">
      <div className="row between wrap admin-head">
        <AdminNav isAdmin={auth.activeRole === "admin"} />
        <span className="chip">{ROLE_LABELS[auth.activeRole]}</span>
      </div>
      {children}
    </div>
  );
}
