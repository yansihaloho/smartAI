import { useState } from "react";
import { useRunPrediction, useGetLatestPrediction, getGetLatestPredictionQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrainCircuit, Loader2, Clock, Target, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const MACAU_SLOTS = [
  { value: "00:01", label: "00:01 WIB" },
  { value: "13:00", label: "13:00 WIB" },
  { value: "16:00", label: "16:00 WIB" },
  { value: "19:00", label: "19:00 WIB" },
  { value: "22:00", label: "22:00 WIB" },
  { value: "23:00", label: "23:00 WIB" },
];

function DigitBadge({ digit, variant = "default" }: { digit: string; variant?: "default" | "gold" | "silver" }) {
  const cls =
    variant === "gold"
      ? "px-3 py-2 rounded-lg font-mono font-black text-xl bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
      : variant === "silver"
      ? "px-3 py-2 rounded-lg font-mono font-black text-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
      : "px-3 py-2 rounded-lg font-mono font-black text-xl bg-primary/10 text-primary border border-primary/30";
  return <span className={cls}>{digit}</span>;
}

export default function Prediksi() {
  const { toast } = useToast();
  const pasaran = "macau";
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  const { data: latestPred, isLoading: isLoadingPred, refetch } = useGetLatestPrediction(
    { pasaran },
    { query: { queryKey: getGetLatestPredictionQueryKey({ pasaran }) } }
  );

  const runPredMutation = useRunPrediction();

  const handleRunPrediction = () => {
    const body: { pasaran: string; slot?: string } = { pasaran };
    if (selectedSlot) body.slot = selectedSlot;

    runPredMutation.mutate(
      { data: body },
      {
        onSuccess: () => {
          toast({ title: "Prediksi Berhasil", description: `BBFS5/6/7 slot ${selectedSlot || "all"} telah digenerate.` });
          refetch();
        },
        onError: () => {
          toast({ title: "Error", description: "Gagal generate prediksi.", variant: "destructive" });
        }
      }
    );
  };

  const pred = latestPred;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prediksi AI — Macau</h1>
        <p className="text-muted-foreground">100 engine consensus · BBFS5/6/7 · slot-aware prediction</p>
      </div>

      {/* Engine Control */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            Engine Control
          </CardTitle>
          <CardDescription>Pilih slot waktu, lalu jalankan 100 AI engine untuk menghasilkan BBFS terbaik.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2 text-muted-foreground">
                <Clock className="inline h-3.5 w-3.5 mr-1" />
                Target Slot (opsional — kosong = semua draw)
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedSlot("")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    selectedSlot === ""
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary"
                  }`}
                >
                  Semua Slot
                </button>
                {MACAU_SLOTS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSelectedSlot(s.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      selectedSlot === s.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary"
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
              className="shrink-0"
            >
              {runPredMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><BrainCircuit className="mr-2 h-4 w-4" /> Run Prediction</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* BBFS Results — Hero */}
      {isLoadingPred ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : pred ? (
        <>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Generated: <span className="text-foreground font-medium">{new Date(pred.generatedAt).toLocaleString("id-ID")}</span></span>
            {pred.slot && <Badge variant="outline" className="border-primary/50 text-primary">{pred.slot} WIB</Badge>}
            <span>Draws used: <span className="text-foreground font-medium">{pred.totalDrawsUsed?.toLocaleString()}</span></span>
            <span>Confidence: <span className="text-foreground font-medium">{((pred.overallConfidence ?? 0) * 100).toFixed(1)}%</span></span>
          </div>

          {/* BBFS Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-yellow-400 flex items-center gap-2 text-base">
                  <Star className="h-4 w-4" /> BBFS 5 Digit
                </CardTitle>
                <CardDescription>Top 5 digit terkuat (5×5×5×5 = 625 kombinasi 4D)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {pred.bbfs5?.map((d, i) => (
                    <DigitBadge key={i} digit={d} variant="gold" />
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground font-mono">
                  {pred.bbfs5?.join("") ?? "—"}
                </p>
              </CardContent>
            </Card>

            <Card className="border-cyan-500/30 bg-cyan-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-cyan-400 flex items-center gap-2 text-base">
                  <Target className="h-4 w-4" /> BBFS 6 Digit
                </CardTitle>
                <CardDescription>Top 6 digit (6×6×6×6 = 1.296 kombinasi 4D)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {pred.bbfs6?.map((d, i) => (
                    <DigitBadge key={i} digit={d} variant="silver" />
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground font-mono">
                  {pred.bbfs6?.join("") ?? "—"}
                </p>
              </CardContent>
            </Card>

            <Card className="border-purple-500/30 bg-purple-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-purple-400 flex items-center gap-2 text-base">
                  <BrainCircuit className="h-4 w-4" /> BBFS 7 Digit
                </CardTitle>
                <CardDescription>Top 7 digit (7×7×7×7 = 2.401 kombinasi 4D)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {(pred as any).bbfs7?.map((d: string, i: number) => (
                    <span
                      key={i}
                      className="px-3 py-2 rounded-lg font-mono font-black text-xl bg-purple-500/20 text-purple-400 border border-purple-500/40"
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground font-mono">
                  {(pred as any).bbfs7?.join("") ?? "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Consensus + Colok */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Consensus 4D</CardTitle>
                <CardDescription>Top picks dari voting 100 engine</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {pred.consensus4d?.slice(0, 10).map((v, i) => (
                    <span key={i} className="px-2 py-1 bg-secondary text-secondary-foreground rounded font-mono font-bold">{v}</span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Consensus 3D</CardTitle>
                <CardDescription>Top 3-digit picks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {pred.consensus3d?.slice(0, 10).map((v, i) => (
                    <span key={i} className="px-2 py-1 bg-muted rounded font-mono">{v}</span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Consensus 2D</CardTitle>
                <CardDescription>Top 2-digit picks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {pred.consensus2d?.slice(0, 10).map((v, i) => (
                    <span key={i} className="px-2 py-1 bg-muted rounded font-mono">{v}</span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Colok Bebas</CardTitle>
                <CardDescription>5 digit ekor terkuat untuk colok bebas</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {pred.colokBebas?.map((v, i) => (
                    <span key={i} className="px-4 py-2 bg-accent text-accent-foreground rounded-full font-black text-lg">{v}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Engine Analysis */}
          {pred.topEngines && pred.topEngines.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top Performing Engines</CardTitle>
                <CardDescription>Engine dengan kontribusi tertinggi pada prediksi ini</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {pred.topEngines.slice(0, 10).map((e, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted border text-xs">
                      <span className="font-medium">{e.name}</span>
                      <span className="text-muted-foreground">{(e.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <BrainCircuit className="mx-auto h-12 w-12 mb-3 opacity-20" />
            <p>Belum ada data prediksi. Klik <strong>Run Prediction</strong> untuk memulai.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
