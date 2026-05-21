import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronLeft, ChevronRight, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import { formatDdMmYyyy, isoDate } from "../lib/format";
import type { PhotoDateEntry } from "../lib/types";

const POSES = ["front", "side"] as const;
type Pose = (typeof POSES)[number];

function DropZone({
  pose,
  file,
  preview,
  onFile,
  onClear,
  uploading,
}: {
  pose: Pose;
  file: File | null;
  preview: string | null;
  onFile: (f: File) => void;
  onClear: () => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) onFile(f);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{pose}</span>
      <div
        className={`relative rounded-2xl border-2 border-dashed transition-colors overflow-hidden
          ${dragging ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-700 bg-zinc-900"}
          ${!preview ? "flex items-center justify-center min-h-48 cursor-pointer" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !preview && inputRef.current?.click()}
      >
        {preview ? (
          <>
            <img src={preview} alt={`${pose} preview`} className="w-full object-cover max-h-80" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-zinc-600">
            <Upload size={28} />
            <span className="text-sm">Tap or drop photo</span>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-zinc-900/70 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {file && <p className="text-[11px] text-zinc-600 truncate">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
    </div>
  );
}

function CompareGrid({
  left,
  right,
  onSwap,
}: {
  left: PhotoDateEntry;
  right: PhotoDateEntry;
  onSwap: () => void;
}) {
  const sharedPoses = POSES.filter(
    (p) => left.poses.includes(p) && right.poses.includes(p)
  );
  const anyPoses = POSES.filter(
    (p) => left.poses.includes(p) || right.poses.includes(p)
  );
  const poses = sharedPoses.length > 0 ? sharedPoses : anyPoses;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm font-semibold text-zinc-200">
          <span>{formatDdMmYyyy(left.date)}</span>
          <span className="text-zinc-600">vs</span>
          <span>{formatDdMmYyyy(right.date)}</span>
        </div>
        <button
          type="button"
          onClick={onSwap}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
        >
          <RotateCcw size={12} />
          Swap
        </button>
      </div>

      {poses.map((pose) => (
        <div key={pose} className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wide">{pose}</span>
          <div className="grid grid-cols-2 gap-2">
            {[left, right].map((entry) => (
              <div key={entry.date} className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
                {entry.poses.includes(pose) ? (
                  <img
                    src={api.photos.url(entry.date, pose)}
                    alt={`${entry.date} ${pose}`}
                    className="w-full object-cover"
                    style={{ aspectRatio: "3/4" }}
                  />
                ) : (
                  <div
                    className="w-full flex items-center justify-center bg-zinc-900 text-zinc-700 text-xs"
                    style={{ aspectRatio: "3/4" }}
                  >
                    No photo
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                  <span className="text-[10px] text-zinc-300">{formatDdMmYyyy(entry.date)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Photos() {
  const TODAY = isoDate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["photos-list"],
    queryFn: () => api.photos.list(),
    staleTime: 60_000,
  });

  const dates = data?.dates ?? [];

  // Upload state
  const [uploadDate, setUploadDate] = useState(TODAY);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [sideFile, setSideFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [sidePreview, setSidePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!frontFile && !sideFile) throw new Error("Select at least one photo");
      const uploads = [];
      if (frontFile) uploads.push(api.photos.upload(uploadDate, "front", frontFile));
      if (sideFile) uploads.push(api.photos.upload(uploadDate, "side", sideFile));
      await Promise.all(uploads);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos-list"] });
      setFrontFile(null); setSideFile(null);
      setFrontPreview(null); setSidePreview(null);
      setUploadError(null);
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ date, pose }: { date: string; pose: string }) => api.photos.delete(date, pose),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos-list"] }),
  });

  function handleFile(pose: Pose, file: File) {
    const url = URL.createObjectURL(file);
    if (pose === "front") { setFrontFile(file); setFrontPreview(url); }
    else { setSideFile(file); setSidePreview(url); }
  }

  function clearFile(pose: Pose) {
    if (pose === "front") { setFrontFile(null); if (frontPreview) URL.revokeObjectURL(frontPreview); setFrontPreview(null); }
    else { setSideFile(null); if (sidePreview) URL.revokeObjectURL(sidePreview); setSidePreview(null); }
  }

  // Comparison state
  const [compareMode, setCompareMode] = useState(false);
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(1);

  // Timeline selection
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedEntry = dates.find((d) => d.date === selectedDate) ?? null;

  const canCompare = dates.length >= 2;

  return (
    <div className="max-w-2xl mx-auto p-4 flex flex-col gap-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <Camera size={20} className="text-violet-400" />
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Progress Photos</h1>
          <p className="text-xs text-zinc-500">{dates.length} session{dates.length !== 1 ? "s" : ""} recorded</p>
        </div>
      </div>

      {/* Upload panel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Upload photos</h2>
          <input
            type="date"
            value={uploadDate}
            max={TODAY}
            onChange={(e) => setUploadDate(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DropZone
            pose="front"
            file={frontFile}
            preview={frontPreview}
            onFile={(f) => handleFile("front", f)}
            onClear={() => clearFile("front")}
            uploading={uploadMutation.isPending}
          />
          <DropZone
            pose="side"
            file={sideFile}
            preview={sidePreview}
            onFile={(f) => handleFile("side", f)}
            onClear={() => clearFile("side")}
            uploading={uploadMutation.isPending}
          />
        </div>

        {uploadError && (
          <p className="text-sm text-red-400">{uploadError}</p>
        )}

        <button
          type="button"
          onClick={() => uploadMutation.mutate()}
          disabled={(!frontFile && !sideFile) || uploadMutation.isPending}
          className="w-full py-3 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {uploadMutation.isPending ? "Uploading…" : "Save photos"}
        </button>
        {uploadMutation.isSuccess && (
          <p className="text-sm text-emerald-400 text-center">Saved!</p>
        )}
      </div>

      {/* Comparison mode */}
      {canCompare && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Compare</h2>
            <button
              type="button"
              onClick={() => setCompareMode((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                compareMode
                  ? "bg-violet-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {compareMode ? "Hide" : "Open comparison"}
            </button>
          </div>

          {compareMode && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {(["Before", "After"] as const).map((label, i) => {
                  const idx = i === 0 ? leftIdx : rightIdx;
                  const setIdx = i === 0 ? setLeftIdx : setRightIdx;
                  const other = i === 0 ? rightIdx : leftIdx;
                  return (
                    <div key={label} className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold">{label}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setIdx((v) => Math.max(0, v - 1))}
                          disabled={idx === 0}
                          className="p-1 rounded-lg bg-zinc-800 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <select
                          value={idx}
                          onChange={(e) => setIdx(Number(e.target.value))}
                          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        >
                          {dates.map((d, di) => (
                            <option key={d.date} value={di} disabled={di === other}>
                              {formatDdMmYyyy(d.date)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setIdx((v) => Math.min(dates.length - 1, v + 1))}
                          disabled={idx === dates.length - 1}
                          className="p-1 rounded-lg bg-zinc-800 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {dates[leftIdx] && dates[rightIdx] && leftIdx !== rightIdx && (
                <CompareGrid
                  left={dates[leftIdx]}
                  right={dates[rightIdx]}
                  onSwap={() => { setLeftIdx(rightIdx); setRightIdx(leftIdx); }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Timeline grid */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">All sessions</h2>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-7 h-7 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        )}

        {!isLoading && dates.length === 0 && (
          <p className="text-sm text-zinc-600 py-6 text-center">No photos yet — upload your first session above.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {dates.map((entry) => (
            <div
              key={entry.date}
              className={`relative rounded-xl overflow-hidden border cursor-pointer transition-all ${
                selectedDate === entry.date
                  ? "border-violet-500 ring-1 ring-violet-500"
                  : "border-zinc-800 hover:border-zinc-600"
              }`}
              onClick={() => setSelectedDate(selectedDate === entry.date ? null : entry.date)}
            >
              {entry.poses[0] && (
                <img
                  src={api.photos.url(entry.date, entry.poses[0])}
                  alt={`${entry.date} ${entry.poses[0]}`}
                  className="w-full object-cover"
                  style={{ aspectRatio: "3/4" }}
                  loading="lazy"
                />
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-2 py-2">
                <p className="text-[11px] font-semibold text-zinc-200">{formatDdMmYyyy(entry.date)}</p>
                <p className="text-[10px] text-zinc-500">{entry.poses.join(" + ")}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Selected date detail panel */}
        {selectedEntry && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">{formatDdMmYyyy(selectedEntry.date)}</h3>
              <button type="button" onClick={() => setSelectedDate(null)} className="text-zinc-600 hover:text-zinc-400">
                <X size={15} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {POSES.map((pose) => (
                <div key={pose} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold">{pose}</span>
                    {selectedEntry.poses.includes(pose) && (
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate({ date: selectedEntry.date, pose })}
                        disabled={deleteMutation.isPending}
                        className="p-1 rounded-lg text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40"
                        title="Delete photo"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  {selectedEntry.poses.includes(pose) ? (
                    <img
                      src={api.photos.url(selectedEntry.date, pose)}
                      alt={`${selectedEntry.date} ${pose}`}
                      className="w-full rounded-xl object-cover"
                      style={{ aspectRatio: "3/4" }}
                    />
                  ) : (
                    <div
                      className="w-full rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-600 text-xs"
                      style={{ aspectRatio: "3/4" }}
                    >
                      No photo
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
