"use client";

// 사용자 보고(2026-08-22): "업로드 할 수 있는 창이 안 보입니다" — 지금까지 쓰던 맨 <input
// type="file">은 브라우저가 내부적으로 "파일 선택" 버튼을 그리는데(::-webkit-file-upload-button),
// 이 프로젝트 전역에 깔린 Tailwind Preflight의 버튼 스타일 초기화가 그 내부 버튼에도 적용돼
// 사실상 투명하고 눌러도 반응 없는 상태로 렌더링되고 있었다(실측 재현: 클릭해도 OS 파일 선택
// 창이 열리지 않음, "선택된 파일 없음" 텍스트만 보임 — 사용자가 캡처해 보내준 화면과 정확히
// 일치). 네이티브 input은 화면에서 완전히 숨기고, 확실히 보이고 클릭되는 일반 버튼으로 열게
// 바꿨다 — 모든 업로드 위젯(6개+)이 이 컴포넌트 하나를 공유한다.
// 사용자 재지시(2026-08-25): "파일 찾기 창이 안 보여" — 작은 버튼+텍스트 조합이 업로드 영역
// 이라는 게 눈에 잘 안 띈다는 취지로 보고, 클릭도 되고 드래그 앤 드랍도 되는 큰 점선 테두리
// 드롭존으로 재설계 — "여기에 파일을 드래그하거나 클릭해 선택하세요"가 명확히 보이게 한다.
import { RefObject, useState, DragEvent } from "react";

export function FileInputTrigger({
  inputRef,
  accept,
  multiple,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  multiple?: boolean;
}) {
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  function applyFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setFileNames(Array.from(files).map((f) => f.name));
    if (inputRef.current) {
      // 사용자 지시: 드래그 앤 드랍으로 받은 파일도 기존 <input type="file">에 그대로 반영해,
      // 업로드 버튼을 누르는 기존 로직(fileInputRef.current?.files 읽기)이 손댈 필요 없이 그대로 동작.
      const dt = new DataTransfer();
      Array.from(files).forEach((f) => dt.items.add(f));
      inputRef.current.files = dt.files;
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    applyFiles(e.dataTransfer.files);
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => setFileNames(Array.from(e.target.files ?? []).map((f) => f.name))}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-4 text-center transition ${
          isDragOver ? "border-zinc-400 bg-zinc-50" : "border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50"
        }`}
      >
        <span className="text-sm font-medium text-zinc-700">파일을 여기로 드래그하거나 클릭해 선택하세요</span>
        <span className="min-w-0 max-w-full truncate text-xs text-zinc-500">
          {fileNames.length === 0 ? "선택된 파일 없음" : fileNames.length === 1 ? fileNames[0] : `${fileNames.length}개 파일 선택됨`}
        </span>
      </div>
    </div>
  );
}
