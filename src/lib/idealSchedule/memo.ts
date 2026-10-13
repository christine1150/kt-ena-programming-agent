// 서버 안에서 잠깐(TTL) 결과를 기억하는 작은 도구(편성 계산 속도용). 같은 키로 동시에 부르면 한 번만 읽고 모두 그 결과를 받는다.
// 실패(예외)는 기억하지 않는다. 값이 바뀔 수 있는 데이터는 짧은 TTL로만 쓰고, 설정·편성안처럼 저장 직후 바로 반영돼야 하는 것은 쓰지 않는다.
const store = new Map<string, { at: number; value: Promise<unknown> }>();

export function memoTtl<T>(key: string, ttlMs: number, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const hit = store.get(key);
  if (hit && now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { at: now(), value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

export function clearMemo(prefix = ""): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
