// Avail(권리) 현황·확인 처리 API (관리자 전용, 단계 06).
// GET : 현황 요약(권리 건수·확인 대기·해석 설정·중복 후보·보충 속성 충돌·검증 상태). ?link=키워드 로 콘텐츠 연결 후보 검색.
// POST: 운영자 확인 기록 — 해석 확인, 조건 확인(메모·홀드백·승인·기소진), 중복 확인, 콘텐츠 연결, 보충 속성 적용.
// 확인은 모두 기록으로 남으며, 확인한 권리 행이 바뀌면(새 revision) 이전 확인은 효력을 잃는다.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { can, roleOfSession } from "@/lib/admin/permissions";
import { applyAddenda, seedConfirmations } from "@/lib/avail/addenda";
import { currentGrants } from "@/lib/avail/inventory";
import { DEFAULT_INTERPRETATION, type InterpKey } from "@/lib/avail/interpretation";
import { proposeLinks } from "@/lib/avail/identity";
import { US_DRAMA_1ST_WINDOW } from "@/lib/avail/seeds/usDrama1stWindow";
import { loadAvailState, saveAddenda, saveConfirmation, saveInterpretation, saveLink } from "@/lib/avail/store";
import { buildOverview } from "@/lib/avail/summary";
import { supabase } from "@/lib/supabase";

const TOPICS = ["memo", "holdback", "approval", "usage_baseline", "duplicate"] as const;

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  const loaded = await loadAvailState();
  const link = new URL(request.url).searchParams.get("link")?.trim();
  if (link) {
    if (link.length < 2) return NextResponse.json({ ok: false, message: "두 글자 이상 입력해 주세요." }, { status: 400 });
    const grants = currentGrants(loaded.state.revisions).filter((g) => g.content.titleRaw.includes(link) || g.content.aliases.some((a) => a.includes(link)));
    const titles = [...new Map(grants.map((g) => [g.content.canonicalKey, g])).values()].slice(0, 10);
    const { data: programs } = await supabase.from("programs").select("id, canonical_name, channel_id").ilike("canonical_name", `%${link.replace(/[%_\s]/g, "")}%`).limit(60);
    const rows = (programs ?? []).map((p) => ({ id: String(p.id), name: String(p.canonical_name) }));
    return NextResponse.json({
      ok: true,
      items: titles.map((g) => ({ canonicalKey: g.content.canonicalKey, title: g.content.titleRaw, candidates: proposeLinks({ title: g.content.titleRaw, aliases: g.content.aliases }, rows).slice(0, 8) })),
    });
  }
  return NextResponse.json({ ok: true, ...buildOverview(loaded, new Date().toISOString()), loadError: loaded.error });
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  if (!can(roleOfSession(admin), "rights_edit")) return NextResponse.json({ ok: false, message: "권리(Avail) 정보를 바꿀 권한이 없습니다." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ ok: false, message: "action이 필요합니다." }, { status: 400 });
  const actor = admin.email ?? "admin";
  const loaded = await loadAvailState();
  if (!loaded.available) return NextResponse.json({ ok: false, message: "Avail 테이블이 아직 적용되지 않았습니다(마이그레이션 20261013010000 적용 후 사용할 수 있습니다)." }, { status: 503 });
  const done = (r: { ok: boolean; message?: string }) => (r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, message: r.message }, { status: 500 }));
  const current = currentGrants(loaded.state.revisions);

  switch (body.action) {
    case "confirm_interpretation": {
      const key = body.key as InterpKey;
      const setting = DEFAULT_INTERPRETATION[key];
      if (!setting || !(setting.plausible as unknown[]).includes(body.value)) return NextResponse.json({ ok: false, message: "알 수 없는 해석 항목 또는 값입니다." }, { status: 400 });
      return done(await saveInterpretation(key, body.value, actor));
    }
    case "confirm_condition": {
      const topic = String(body.topic ?? "");
      const g = current.find((x) => x.grantId === body.grantId);
      if (!g) return NextResponse.json({ ok: false, message: "권리를 찾지 못했습니다." }, { status: 404 });
      if (!(TOPICS as readonly string[]).includes(topic)) return NextResponse.json({ ok: false, message: "확인할 수 없는 항목입니다." }, { status: 400 });
      const evidence = typeof body.evidence === "string" ? body.evidence.trim() : "";
      if ((topic === "approval" || topic === "usage_baseline") && !evidence) return NextResponse.json({ ok: false, message: "승인·기소진 확인에는 증빙(문서·근거) 내용이 필요합니다." }, { status: 400 });
      return done(await saveConfirmation({ grantId: g.grantId, rowHash: g.rowHash, topic, value: topic === "usage_baseline" ? "zero" : typeof body.value === "string" ? body.value : null, evidence: evidence || null }, actor));
    }
    case "confirm_duplicate": {
      const g = current.find((x) => x.grantId === body.grantId);
      const value = String(body.value ?? "");
      if (!g || !(value === "distinct" || /^same:.+/.test(value))) return NextResponse.json({ ok: false, message: "권리와 확인 값(distinct 또는 same:대표ID)이 필요합니다." }, { status: 400 });
      if (value.startsWith("same:") && !current.some((x) => x.grantId === value.slice(5))) return NextResponse.json({ ok: false, message: "대표 권리를 찾지 못했습니다." }, { status: 404 });
      return done(await saveConfirmation({ grantId: g.grantId, rowHash: g.rowHash, topic: "duplicate", value, evidence: null }, actor));
    }
    case "link_content": {
      if (typeof body.programId !== "string" || typeof body.canonicalKey !== "string" || !current.some((g) => g.content.canonicalKey === body.canonicalKey)) return NextResponse.json({ ok: false, message: "프로그램과 Avail 제목 키가 필요합니다." }, { status: 400 });
      return done(await saveLink({ programId: body.programId, canonicalKey: body.canonicalKey }, actor));
    }
    case "seed_addenda": {
      if (body.name !== "us_drama_1st_window") return NextResponse.json({ ok: false, message: "알 수 없는 보충 속성 묶음입니다." }, { status: 400 });
      const saved = await saveAddenda(US_DRAMA_1ST_WINDOW, actor);
      if (!saved.ok) return done(saved);
      // 운영자가 전달한 사실(신규 구매·전 채널 방영 가능)을 확인 기록으로 남긴다. 원본과 충돌하는 권리는 제외한다.
      const sc = seedConfirmations(applyAddenda(current, US_DRAMA_1ST_WINDOW).grants, US_DRAMA_1ST_WINDOW);
      const have = new Set(loaded.state.confirmations.map((c) => `${c.grantId}|${c.rowHash}|${c.topic}`));
      let n = 0;
      for (const c of sc.confirmations) {
        if (have.has(`${c.grantId}|${c.rowHash}|${c.topic}`)) continue;
        const r = await saveConfirmation({ grantId: c.grantId, rowHash: c.rowHash, topic: c.topic, value: c.value, evidence: c.evidence }, actor);
        if (!r.ok) return done(r);
        n++;
      }
      return NextResponse.json({ ok: true, confirmationsAdded: n, skippedForConflict: sc.skippedForConflict });
    }
    case "confirm_group": {
      // 같은 문구의 메모·홀드백을 한꺼번에 확인한다(권리 담당자가 그 문구를 확인한 뒤에만 사용)
      const topic = String(body.topic ?? "");
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if ((topic !== "memo" && topic !== "holdback") || !text) return NextResponse.json({ ok: false, message: "topic(memo|holdback)과 문구가 필요합니다." }, { status: 400 });
      const code = topic === "memo" ? "MEMO_REVIEW" : "HOLDBACK_REVIEW";
      const targets = current.filter((g) => g.status === "active" && g.conditions.some((c) => c.code === code && c.raw === text));
      if (targets.length === 0) return NextResponse.json({ ok: false, message: "해당 문구의 권리를 찾지 못했습니다." }, { status: 404 });
      for (const g of targets) {
        const r = await saveConfirmation({ grantId: g.grantId, rowHash: g.rowHash, topic, value: null, evidence: typeof body.evidence === "string" ? body.evidence.trim() || null : null }, actor);
        if (!r.ok) return done(r);
      }
      return NextResponse.json({ ok: true, confirmed: targets.length });
    }
    case "confirm_baseline_group": {
      // 소재코드 접두로 묶어 '지금까지 방영 없음'(기소진 0)을 확인한다. 증빙 필수.
      const prefix = typeof body.codePrefix === "string" ? body.codePrefix.trim() : "";
      const evidence = typeof body.evidence === "string" ? body.evidence.trim() : "";
      if (prefix.length < 4 || !evidence) return NextResponse.json({ ok: false, message: "소재코드 접두(4자 이상)와 증빙 내용이 필요합니다." }, { status: 400 });
      const targets = current.filter((g) => g.status === "active" && (g.content.sourceCode ?? "").startsWith(prefix) && g.rules.count.limit.state === "value");
      if (targets.length === 0) return NextResponse.json({ ok: false, message: "해당 접두의 권리를 찾지 못했습니다." }, { status: 404 });
      for (const g of targets) {
        const r = await saveConfirmation({ grantId: g.grantId, rowHash: g.rowHash, topic: "usage_baseline", value: "zero", evidence }, actor);
        if (!r.ok) return done(r);
      }
      return NextResponse.json({ ok: true, confirmed: targets.length });
    }
    default:
      return NextResponse.json({ ok: false, message: "알 수 없는 action입니다." }, { status: 400 });
  }
}
