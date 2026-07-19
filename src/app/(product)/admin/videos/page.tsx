import { AdminOnly } from "@/features/admin/AdminOnly";
import { AdminVideosWorkspace } from "@/features/admin/AdminVideosWorkspace";

export default function AdminVideosPage() {
  return (
    <AdminOnly>
      <AdminVideosWorkspace />
    </AdminOnly>
  );
}
