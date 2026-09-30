// 사용자 입력·권한으로 인한 오류(API가 400으로 응답) — 서버 오류(500)와 구분.
export class ClientError extends Error {}
