// 라인업 자료 관리(/lineup/manage) — 엑셀 업로드(미리보기 → 반영)·업로드 되돌리기·변경 이력. 권한 lineup_edit(관리자만, 사용자 결정 2026-11-24).
// /admin 아래에 두지 않은 이유: 나중에 PD에게 편집을 열 때 주소를 옮기지 않으려고(권한표 한 줄만 바꾼다).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/adminAuth";
import { can, roleOfSession } from "@/lib/admin/permissions";
import { loadOutlets } from "@/lib/lineup/repo";
import ManageView from "./ManageView";

export const metadata: Metadata = { title: "라인업 자료 관리" };
export const dynamic = "force-dynamic";

export default async function LineupManagePage() {
  const session = await getCurrentSession();
  if (!can(roleOfSession(session), "lineup_edit")) redirect("/lineup");
  const outlets = await loadOutlets();
  return <ManageView ownChannels={outlets.filter((o) => o.side === "own").map((o) => ({ code: o.code, name: o.display_name }))} />;
}
