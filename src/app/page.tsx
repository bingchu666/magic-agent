import { redirect } from "next/navigation";
import { DEFAULT_PRODUCT_PATH } from "@/lib/routes";

export default function HomePage() {
  redirect(DEFAULT_PRODUCT_PATH);
}
