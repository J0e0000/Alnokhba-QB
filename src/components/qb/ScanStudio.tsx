'use client';

// ============================================================
// ALNOKHBA QB — Scan Studio
// Scan/photograph → engine → confidence review → grade → overrides
// ============================================================

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Camera, Crosshair, FileScan, Loader2, ScanLine, Stethoscope } from 'lucide-react';
import type { QBAnswerStatus, QBScannedAnswer, QBScanGrade } from '@/lib/qb/types';

interface ScanResult {
  scanId: string;
  answers: QBScannedAnswer[];
  grade: QBScanGrade | null;
  studentCode: string | null;
  overallConfidence: number;
  status: string;
  diagnostics: Record<string, unknown> & {
    stages?: Record<string, boolean>;
    warnings?: string[];
    errors?: string[];
    strategy?: string;
    rotationDeg?: number;
    templateId?: string;
    examVersionId?: string;
    markersFound?: number;
  };
  images?: { debug?: string | null; corrected?: string | null };
}

const statusMeta: Record<QBAnswerStatus, { label: string; cls: string }> = {
  selected: { label: 'محدد', cls: 'bg-emerald-100 text-emerald-800' },
  unanswered: { label: 'فارغ', cls: 'bg-slate-100 text-slate-600' },
  multiple: { label: 'متعدد ⚠', cls: 'bg-red-100 text-red-700' },
  unclear: { label: 'غير واضح ⚠', cls: 'bg-amber-100 text-amber-800' },
  invalid: { label: 'غير صالح ⚠', cls: 'bg-red-100 text-red-700' },
};

const CORNER_LABELS = ['أعلى اليسار', 'أعلى اليمين', 'أسفل اليمين', 'أسفل اليسار'];

export default function ScanStudio({ onScanned }: { onScanned?: () => void }) {
  const [examVersions, setExamVersions] = useState<{ id: string; label: string }[]>([]);
  const [hintVersion, setHintVersion] = useState<string>('auto');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [diagOpen, setDiagOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // ---- manual 4-corner fallback (port of legacy nokhba-qb calibration) ----
  const [pendingImage, setPendingImage] = useState<string | null>(null); // data URL of the uploaded sheet
  const [manualMode, setManualMode] = useState(false);
  const [manualPoints, setManualPoints] = useState<Array<{ x: number; y: number }>>([]);
  const imgRef = useRef<HTMLImageElement>(null);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch('/api/exams');
      const exams = (await res.json()) as { id: string; title: string; currentVersion: number; status: string }[];
      const versions: { id: string; label: string }[] = [];
      for (const ex of exams.filter((e) => e.currentVersion > 0)) {
        versions.push({ id: `${ex.id}`, label: `${ex.title} — نسخة ${ex.currentVersion}` });
      }
      setExamVersions(versions);
    } catch {
      /* non-critical */
    }
  }, []);

  useState(() => {
    void loadVersions();
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > 20 * 1024 * 1024) {
      toast.error('حجم الصورة كبير جدًا (الحد 20 ميجابايت)');
      return;
    }
    setBusy(true);
    setResult(null);
    setOverrides({});
    setManualMode(false);
    setManualPoints([]);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      setPendingImage(dataUrl); // kept for the manual-corner fallback
      await submitScan(dataUrl, undefined);
    } catch {
      toast.error('تعذر قراءة الصورة');
      setBusy(false);
    }
  };

  const submitScan = async (dataUrl: string, manualMarkers?: Array<{ x: number; y: number }>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          examVersionIdHint: hintVersion === 'auto' ? undefined : hintVersion,
          manualMarkers,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'فشل تحليل الورقة');
        setResult({
          scanId: '',
          answers: [],
          grade: null,
          studentCode: null,
          overallConfidence: 0,
          status: 'FAILED',
          diagnostics: { errors: [data.error ?? 'unknown'], stages: data.stages ?? {}, warnings: data.warnings ?? [] },
          images: data.images,
        });
        return;
      }
      setResult(data);
      setManualMode(false);
      onScanned?.();
      const ambiguous = (data.answers as QBScannedAnswer[]).filter((a) => a.status === 'multiple' || a.status === 'unclear');
      if (ambiguous.length > 0) toast.warning(`${ambiguous.length} إجابة تحتاج مراجعة (غير واضحة/متعددة)`);
      else toast.success('تمت قراءة الورقة بنجاح');
    } catch {
      toast.error('تعذر الاتصال بخدمة التحليل');
    } finally {
      setBusy(false);
    }
  };

  // ---- manual corner clicking (order: TL, TR, BR, BL — like the original) ----
  const onManualClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img || manualPoints.length >= 4) return;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const next = [...manualPoints, { x, y }];
    setManualPoints(next);
    if (next.length === 4) {
      if (hintVersion === 'auto') {
        toast.error('اختر نسخة الامتحان من القائمة أولًا (الضبط اليدوي لا يقرأ QR)');
        setManualPoints([]);
        return;
      }
      if (!pendingImage) return;
      toast.info('تم تحديد الزوايا — جارٍ التصحيح…');
      void submitScan(pendingImage, next);
    }
  };

  const startManualMode = () => {
    if (!pendingImage) {
      toast.error('ارفع صورة الورقة أولًا');
      return;
    }
    setManualMode(true);
    setManualPoints([]);
    setResult(null);
    toast.info('اضغط على العلامات السوداء الأربع بالترتيب: أعلى اليسار → أعلى اليمين → أسفل اليمين → أسفل اليسار');
  };

  const applyOverrides = async () => {
    if (!result?.scanId || Object.keys(overrides).length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/scans/${result.scanId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ...result, ...data });
        setOverrides({});
        toast.success('تم تطبيق التصحيحات وإعادة الاحتساب');
      } else {
        toast.error(data.error ?? 'فشل التحديث');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5 text-emerald-600" /> مسح ورقة الإجابة
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-6 text-center transition hover:border-emerald-400 hover:bg-emerald-50"
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            {busy ? (
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            ) : (
              <Camera className="h-8 w-8 text-emerald-600" />
            )}
            <div className="text-sm font-medium text-emerald-800">التقط صورة للورقة أو أفلتها هنا</div>
            <div className="text-xs text-slate-500">الكاميرا أو الماسح الضوئي — يُقرأ رمز QR تلقائيًا لتحديد نسخة الامتحان</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">النسخة (اختياري عند فشل QR):</span>
            <Select value={hintVersion} onValueChange={setHintVersion}>
              <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">تلقائي (من رمز QR)</SelectItem>
                {examVersions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={busy} onClick={startManualMode}>
              <Crosshair className="h-3.5 w-3.5" /> ضبط الزوايا يدويًا
            </Button>
          </div>
          {manualMode && pendingImage && (
            <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
              <div className="mb-2 text-xs font-semibold text-amber-800">
                اضغط على العلامات السوداء الأربع بالترتيب ({manualPoints.length}/4):
                {' '}
                <b>{CORNER_LABELS[Math.min(manualPoints.length, 3)]}</b>
                {' '}
                <button className="text-[10px] text-slate-500 underline" onClick={() => { setManualMode(false); setManualPoints([]); }}>إلغاء</button>
              </div>
              <div className="relative max-h-[60vh] overflow-auto rounded-lg bg-black">
                <img
                  ref={imgRef}
                  src={pendingImage}
                  alt="ورقة الإجابة"
                  className="block w-full cursor-crosshair select-none"
                  onClick={onManualClick}
                />
                {manualPoints.map((p, i) => (
                  <span
                    key={i}
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-500"
                    style={{ left: `${(p.x / (imgRef.current?.naturalWidth || 1)) * 100}%`, top: `${(p.y / (imgRef.current?.naturalHeight || 1)) * 100}%` }}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">النتائج</CardTitle>
              </CardHeader>
              <CardContent>
                {result.answers.length === 0 ? (
                  <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
                    {result.diagnostics.errors?.[0] ?? 'تعذر تحليل الورقة'}
                  </div>
                ) : (
                  <div className="max-h-96 space-y-1.5 overflow-y-auto pl-1">
                    {result.answers.map((a) => (
                      <div key={a.number} className="flex items-center gap-3 rounded-lg border px-3 py-1.5">
                        <span className="w-8 text-sm font-bold text-slate-700">{a.number}</span>
                        <div className="flex flex-1 gap-1">
                          {Object.entries(a.ratios).map(([letter, ratio]) => (
                            <div key={letter} className="flex-1">
                              <div className="flex justify-between text-[9px] text-slate-400">
                                <span>{letter}</span><span>{Math.round(ratio * 100)}%</span>
                              </div>
                              <div className="h-1.5 rounded bg-slate-100">
                                <div
                                  className={`h-1.5 rounded ${a.detected === letter && a.status === 'selected' ? 'bg-emerald-500' : ratio > 0.35 ? 'bg-red-400' : 'bg-slate-300'}`}
                                  style={{ width: `${Math.min(100, ratio * 100)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <Badge className={statusMeta[a.status].cls}>{statusMeta[a.status].label}</Badge>
                        <span className="w-14 text-left text-[10px] text-slate-400">{Math.round(a.confidence * 100)}%</span>
                        <Select
                          value={overrides[String(a.number)] ?? ''}
                          onValueChange={(v) => setOverrides({ ...overrides, [String(a.number)]: v })}
                        >
                          <SelectTrigger className="h-7 w-16 text-[10px]"><SelectValue placeholder="تعديل" /></SelectTrigger>
                          <SelectContent>
                            {Object.keys(a.ratios).map((l) => (
                              <SelectItem key={l} value={l}>{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(overrides).length > 0 && (
                  <Button size="sm" className="mt-3 bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => void applyOverrides()}>
                    تطبيق التصحيحات وإعادة الاحتساب
                  </Button>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {result.grade && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">الدرجة</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-center">
                      <div className="text-4xl font-black text-emerald-600">{result.grade.score}</div>
                      <div className="text-xs text-slate-500">من {result.grade.maxScore} ({result.grade.percent}%)</div>
                    </div>
                    <Progress value={result.grade.percent} className="h-2" />
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">صحيحة: {result.grade.correct.length}</div>
                      <div className="rounded-lg bg-red-50 p-2 text-red-600">خاطئة: {result.grade.incorrect.length}</div>
                      <div className="rounded-lg bg-amber-50 p-2 text-amber-700">ملتبسة: {result.grade.ambiguous.length}</div>
                      <div className="rounded-lg bg-slate-50 p-2 text-slate-600">فارغة: {result.grade.unanswered.length}</div>
                    </div>
                    {(result.grade.negativeApplied ?? 0) > 0 && (
                      <div className="rounded-lg bg-orange-50 p-2 text-center text-xs text-orange-700">
                        مطبَّق خصم {result.grade.negativeApplied} درجة على الإجابات الخاطئة
                      </div>
                    )}
                    {result.studentCode && (
                      <div className="text-center text-xs text-slate-500">رقم الطالب المقروء: <span className="font-bold text-slate-700">{result.studentCode}</span></div>
                    )}
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardContent className="pt-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                    <span>الثقة العامة</span>
                    <span className="font-bold text-slate-700">{Math.round(result.overallConfidence * 100)}%</span>
                  </div>
                  <Progress value={result.overallConfidence * 100} className="h-2" />
                  <Dialog open={diagOpen} onOpenChange={setDiagOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="mt-3 w-full gap-1 text-xs">
                        <Stethoscope className="h-4 w-4" /> التشخيص التفصيلي
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl" dir="rtl">
                      <DialogHeader><DialogTitle className="text-right">تشخيص المسح</DialogTitle></DialogHeader>
                      <ScanDiagnostics result={result} />
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ScanDiagnostics({ result }: { result: ScanResult }) {
  const stages = result.diagnostics.stages ?? {};
  const stageLabels: Record<string, string> = {
    imageLoaded: 'استلام الصورة',
    preprocessed: 'المعالجة المسبقة',
    sheetDetected: 'اكتشاف الورقة',
    perspectiveCorrected: 'تصحيح المنظور',
    orientationFixed: 'تصحيح الاتجاه',
    templateIdentified: 'تحديد القالب',
    bubblesLoaded: 'تحميل مناطق الفقاعات',
    answersExtracted: 'استخراج الإجابات',
    graded: 'التصحيح',
  };
  return (
    <div className="space-y-3" dir="rtl">
      <div className="grid grid-cols-3 gap-2 text-xs">
        {Object.entries(stageLabels).map(([k, label]) => (
          <div key={k} className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${stages[k] ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            <FileScan className="h-3.5 w-3.5" /> {label} {stages[k] ? '✓' : '✕'}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>القالب: {String(result.diagnostics.templateId ?? '—')}</div>
        <div>الاستراتيجية: {String(result.diagnostics.strategy ?? '—')}</div>
        <div>الدوران: {String(result.diagnostics.rotationDeg ?? 0)}°</div>
        <div>العلامات المرجعية: {String(result.diagnostics.markersFound ?? '—')}/4</div>
      </div>
      {(result.diagnostics.warnings?.length ?? 0) > 0 && (
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {result.diagnostics.warnings?.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      {(result.diagnostics.errors?.length ?? 0) > 0 && (
        <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
          {result.diagnostics.errors?.map((w, i) => <div key={i}>✕ {w}</div>)}
        </div>
      )}
      {result.images?.debug && (
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-600">الصورة المعالجة مع الفقاعات المتوقعة:</div>
          <img src={result.images.debug} alt="debug overlay" className="w-full rounded-lg border" />
        </div>
      )}
      {result.images?.corrected && (
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-600">الورقة بعد تصحيح المنظور:</div>
          <img src={result.images.corrected} alt="corrected" className="w-full rounded-lg border" />
        </div>
      )}
    </div>
  );
}
