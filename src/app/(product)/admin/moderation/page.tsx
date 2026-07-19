import { AdminOnly } from "@/features/admin/AdminOnly";
import { ModerationWorkspace } from "@/features/admin/ModerationWorkspace";

export default function AdminModerationPage() {
  return (
    <AdminOnly>
      <ModerationWorkspace />
    </AdminOnly>
  );
}
