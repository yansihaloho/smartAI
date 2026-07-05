import { useState } from "react";
import { useRunPrediction, useGetLatestPrediction, getGetLatestPredictionQueryKey } from "@workspace/api-client-react";
import type { RunPredictionResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrainCircuit, Loader2, Clock, Target, Star, TrendingUp, Lightbulb, BarChart2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const MACAU_SLOTS = [
  { value: "00:01", label: "00:01" },
  { value: "13:00", label: "13:00" },
  { value: "16:00", label: "16:00" },
  { value: "19:00", label: "19:00" },
  { value: "22:00", label: "22:00" },
  { value: "23:00", label: "23:00" },
];

type PredResult = RunPredictionResponse | NonNullable<ReturnType<typeof useGetLatestPrediction>["data"]>;

function BbfsCard({
  title,
  subtitle,
  digits,
  colorClass,
  borderClass,
  icon,
}: {
  title: string;
  subtitle: string;
  digits: string[] | undefined;
  colorClass: string;
  borderClass: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className={`${borderClass}`}>
      <CardHeader className="pb-2">
        <CardTitle className={`${colorClass} flex items-center gap-2 text-base`}>
          {icon} {title}
        </CardTitle>
        <CardDescription className="text-xs">{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-3">
          {digits?.map((d, i) => (
            <span
              key={i}
              className={`w-10 h-10 flex items-center justify-center rounded-xl font-mono font-black text-2xl ${colorClass} bg-current/10 border border-current/30`}
              style={{ color: "inherit" }}
            >
              <span className={colorClass}>{d}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <code className={`text-sm font-mono font-bold tracking-[0.3em] ${colorClass}`}>
            {digits?.join("") ?? "—"}
          </code>
          <span className="text-xs text-muted-foreground">({digits?.length} digit)</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Prediksi() {
  const { toast } = useToast();
  const pasaran = "macau";
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [liveResult, setLiveResult] = useState<PredResult | null>(null);

  const { data: latestPred, isLoading: isLoadingPred, refetch } = useGetLatestPrediction(
    { pasaran },
    { query: { queryKey: getGetLatestPredictionQueryKey({ pasaran }) } }
  );

  const runPredMutation = useRunPrediction();

  const handleRunPrediction = () => {
    const body: { pasaran: string; slot?: string } = { pasaran };
    if (selectedSlot) body.slot = selectedSlot;

    setLiveResult(null);
    runPredMutation.mutate(
      { data: body },
      {
        onSuccess: (data) => {
          setLiveResult(data);
          toast({
            title: "✅ Prediksi Berhasil",
            description: `BBFS5/6/7 slot ${selectedSlot || "semua"} — ${data.totalDrawsUsed?.toLocaleString()} draw dianalisis.`,
          });
          refetch();
        },
        onError: () => {
          toast({ title: "Error", description: "Gagal generate prediksi.", variant: "destructive" });
        },
      }
    );
  };

  // Show live result from mutation if available, else show latest from DB
  const pred: PredResult | null = liveResult ?? latestPred ?? null;
  const isLoading = isLoadingPred && !liveResult;
  const bbfs7 = (pred as any)?.bbfs7 as string[] | undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prediksi AI — Macau</h1>
        <p className="text-muted-foreground">
          100 engine × 5 layer BBFS scoring · Analisis digit per slot · Data {latestPred?.totalDrawsUsed?.toLocaleString() ?? "..."} draw
        </p>
      </div>

      {/* Engine Control Panel */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-5 w-5 text-primary" />
            Engine Control
          </CardTitle>
          <CardDescription>
            Pilih slot waktu lalu jalankan analisis. Engine menggunakan HANYA data historis slot tersebut.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="flex items-center gap-1 mb-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Target Slot WIB (kosong = semua draw)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedSlot("")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all ${
                    selectedSlot === ""
                      ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/30"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  Semua Slot
                </button>
                {MACAU_SLOTS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSelectedSlot(s.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all ${
                      selectedSlot === s.value
                        ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/30"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <Button
              size="lg"
              onClick={handleRunPrediction}
              disabled={runPredMutation.isPending}
              className="shrink-0 min-w-[160px]"
            >
              {runPredMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Menganalisis…</>
              ) : (
                <><BrainCircuit className="mr-2 h-4 w-4" /> Run Prediction</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : pred ? (
        <>
          {/* Metadata bar */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-foreground font-medium">
                {new Date(pred.generatedAt).toLocaleString("id-ID")}
              </span>
            </span>
            {(pred as any).slot && (
              <Badge variant="outline" className="border-primary/50 text-primary font-mono">
                <Clock className="h-3 w-3 mr-1" />
                {(pred as any).slot} WIB
              </Badge>
            )}
            {!(pred as any).slot && (
              <Badge variant="outline" className="border-muted text-muted-foreground">
                Semua Slot
              </Badge>
            )}
            <span>
              <span className="text-foreground font-semibold">{pred.totalDrawsUsed?.toLocaleString()}</span>
              {" "}draw dianalisis
            </span>
            <span>
              Confidence:{" "}
              <span className={`font-semibold ${(pred.overallConfidence ?? 0) > 0.85 ? "text-green-500" : "text-yellow-500"}`}>
                {((pred.overallConfidence ?? 0) * 100).toFixed(1)}%
              </span>
            </span>
          </div>

          {/* BBFS Hero Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <BbfsCard
              title="BBFS 5 Digit"
              subtitle={`${5}⁴ = 625 kombinasi 4D`}
              digits={pred.bbfs5}
              colorClass="text-yellow-400"
              borderClass="border-yellow-500/30 bg-yellow-500/5"
              icon={<Star className="h-4 w-4" />}
            />
            <BbfsCard
              title="BBFS 6 Digit"
              subtitle={`${6}⁴ = 1.296 kombinasi 4D`}
              digits={pred.bbfs6}
              colorClass="text-cyan-400"
              borderClass="border-cyan-500/30 bg-cyan-500/5"
              icon={<Target className="h-4 w-4" />}
            />
            <BbfsCard
              title="BBFS 7 Digit"
              subtitle={`${7}⁴ = 2.401 kombinasi 4D`}
              digits={bbfs7}
              colorClass="text-purple-400"
              borderClass="border-purple-500/30 bg-purple-500/5"
              icon={<BrainCircuit className="h-4 w-4" />}
            />
          </div>

          {/* AI Explanations */}
          {pred.explanations && pred.explanations.length > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-amber-400 flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4" /> Analisis AI — Alasan BBFS ini dipilih
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {pred.explanations.map((exp, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-amber-500 font-bold shrink-0">{i + 1}.</span>
                      <span className="text-muted-foreground">{exp}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Engine Contributions + Consensus */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Engine category contribution */}
            {pred.engineContributions && pred.engineContributions.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-primary" /> Kontribusi Engine per Kategori
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pred.engineContributions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-36 shrink-0 truncate">{c.category}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.min(100, c.contribution)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-8 text-right">{c.contribution}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Consensus 4D + colok bebas */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-500" /> Consensus 4D
                  </CardTitle>
                  <CardDescription className="text-xs">Top kombinasi 4D dari voting 100 engine</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {pred.consensus4d?.slice(0, 10).map((v, i) => (
                      <span key={i} className="px-2 py-1 bg-secondary text-secondary-foreground rounded font-mono font-bold text-sm">
                        {v}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Colok Bebas</CardTitle>
                  <CardDescription className="text-xs">5 digit ekor terkuat</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    {pred.colokBebas?.map((v, i) => (
                      <span key={i} className="w-10 h-10 flex items-center justify-center bg-accent text-accent-foreground rounded-full font-black text-lg">
                        {v}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* 3D / 2D */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Consensus 3D</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {pred.consensus3d?.slice(0, 10).map((v, i) => (
                    <span key={i} className="px-2 py-1 bg-muted rounded font-mono text-sm">{v}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Consensus 2D</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {pred.consensus2d?.slice(0, 10).map((v, i) => (
                    <span key={i} className="px-2 py-1 bg-muted rounded font-mono text-sm">{v}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <BrainCircuit className="mx-auto h-16 w-16 mb-4 opacity-15" />
            <p className="text-lg font-medium mb-1">Belum ada prediksi</p>
            <p className="text-sm">Pilih slot waktu (opsional) lalu klik <strong>Run Prediction</strong>.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
