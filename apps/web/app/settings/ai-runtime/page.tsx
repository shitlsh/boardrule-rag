import { redirect } from "next/navigation";

/** @deprecated 已合并至「模型管理 → 提取模型 / 聊天模型」 */
export default function AiRuntimeRedirectPage() {
  redirect("/models/extraction");
}
