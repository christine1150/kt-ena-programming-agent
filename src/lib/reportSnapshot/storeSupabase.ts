// ReportSnapshot 운영 저장소(단계 14, 서버 전용) — 기존 mart_llm_text_cache 테이블 사용. 설명은 store.ts 머리말 참고.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { SNAPSHOT_ID_RE, SNAPSHOT_KIND, type SnapshotStore } from "./store";
import { SNAPSHOT_SCHEMA_VERSION, type ReportSnapshot } from "./types";

export function createSupabaseStore(client: SupabaseClient = supabase): SnapshotStore {
  return {
    async put(s) {
      const { error } = await client
        .from("mart_llm_text_cache")
        .upsert({ cache_key: s.id, kind: SNAPSHOT_KIND, as_of_date: null, text_value: JSON.stringify(s) }, { onConflict: "cache_key", ignoreDuplicates: true });
      if (error) throw new Error(`보고서 원본을 저장하지 못했습니다: ${error.message}`);
    },
    async get(id) {
      if (!SNAPSHOT_ID_RE.test(id)) return null;
      const { data, error } = await client.from("mart_llm_text_cache").select("text_value").eq("cache_key", id).eq("kind", SNAPSHOT_KIND).maybeSingle();
      if (error) throw new Error(`보고서 원본을 읽지 못했습니다: ${error.message}`);
      const text = data?.text_value;
      if (typeof text !== "string" || text.length === 0) return null;
      const snap = JSON.parse(text) as ReportSnapshot;
      // 다른 구조 버전이나 ID가 어긋난 행은 쓰지 않는다 — 렌더러가 기대하는 모양이 아닐 수 있다.
      if (snap.id !== id || snap.schema !== SNAPSHOT_SCHEMA_VERSION) return null;
      return snap;
    },
  };
}

