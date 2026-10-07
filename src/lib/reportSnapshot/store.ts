// ReportSnapshot 저장소(단계 14, 서버 전용).
//
// 지금은 이미 운영 중인 mart_llm_text_cache 테이블(kind='report_snapshot', cache_key=스냅샷 ID, as_of_date=null)을 쓴다 —
// 새 마이그레이션 없이 동작하게 하려는 선택이다. 이 테이블은 "캐시"라 비워질 수 있으므로, 저장된 스냅샷이 없으면 조용히
// 다른 내용을 만들어 내지 않고 "원본이 없음"을 알려 화면에서 다시 만들게 한다. 전용 report_snapshots 테이블은 승인 후 별도 마이그레이션 대상이다.
// as_of_date를 비워 두는 것은 일간 마트 재적재(refresh_daily_dashboard_mart)가 날짜 기준으로 지우는 행에서 빠지게 하기 위해서다.
import type { ReportSnapshot } from "./types";

export const SNAPSHOT_KIND = "report_snapshot";
export const SNAPSHOT_ID_RE = /^rs-[0-9a-f]{12}$/;

export interface SnapshotStore {
  /** 같은 ID가 이미 있으면 덮어쓰지 않는다(불변). 저장하지 못하면 throw. */
  put(s: ReportSnapshot): Promise<void>;
  get(id: string): Promise<ReportSnapshot | null>;
}

export function createMemoryStore(): SnapshotStore & { size(): number } {
  const m = new Map<string, string>();
  return {
    async put(s) {
      if (!m.has(s.id)) m.set(s.id, JSON.stringify(s));
    },
    async get(id) {
      const t = m.get(id);
      return t ? (JSON.parse(t) as ReportSnapshot) : null;
    },
    size: () => m.size,
  };
}
