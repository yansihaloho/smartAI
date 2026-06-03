import { useGetLatestPrediction, getGetLatestPredictionQueryKey, useGetPredictionAccuracy, getGetPredictionAccuracyQueryKey, useGetEnginePerformance, getGetEnginePerformanceQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Target, BrainCircuit, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: latestPred, isLoading: isLoadingPred } = useGetLatestPrediction(
    { pasaran: "macau" },
    { query: { queryKey: getGetLatestPredictionQueryKey({ pasaran: "macau" }) } }
  );

  const { data: accuracy, isLoading: isLoadingAcc } = useGetPredictionAccuracy(
    { pasaran: "macau" },
    { query: { queryKey: getGetPredictionAccuracyQueryKey({ pasaran: "macau" }) } }
  );

  const { data: performance, isLoading: isLoadingPerf } = useGetEnginePerformance(
    { pasaran: "macau", limit: 5 },
    { query: { queryKey: getGetEnginePerformanceQueryKey({ pasaran: "macau", limit: 5 }) } }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mission Control</h1>
        <p className="text-muted-foreground">Macau Pasaran Overview & Engine Status</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last 30D Win Rate (2D)</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingAcc ? <Skeleton className="h-7 w-20" /> : (
              <>
                <div className="text-2xl font-bold" data-testid="stat-winrate-2d">
                  {accuracy?.last30 ? (accuracy.last30.winRate2d * 100).toFixed(1) : 0}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {accuracy?.last30?.hit2d || 0} hits out of {accuracy?.last30?.totalChecked || 0} draws
                </p>
              </>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last 30D Win Rate (4D)</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingAcc ? <Skeleton className="h-7 w-20" /> : (
              <>
                <div className="text-2xl font-bold text-primary" data-testid="stat-winrate-4d">
                  {accuracy?.last30 ? (accuracy.last30.winRate4d * 100).toFixed(1) : 0}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {accuracy?.last30?.hit4d || 0} hits out of {accuracy?.last30?.totalChecked || 0} draws
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Engine</CardTitle>
            <BrainCircuit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingPerf ? <Skeleton className="h-7 w-32" /> : (
              <>
                <div className="text-2xl font-bold uppercase" data-testid="stat-top-engine">
                  {performance?.performance?.[0]?.category || "N/A"}
                </div>
                <p className="text-xs text-muted-foreground flex items-center">
                  <ArrowUpRight className="mr-1 h-3 w-3 text-green-500" />
                  Score: {performance?.performance?.[0]?.avgScore?.toFixed(2) || 0}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Confidence</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingPred ? <Skeleton className="h-7 w-20" /> : (
              <>
                <div className="text-2xl font-bold text-blue-400" data-testid="stat-confidence">
                  {latestPred ? (latestPred.overallConfidence * 100).toFixed(1) : 0}%
                </div>
                <p className="text-xs text-muted-foreground">
                  Latest prediction computed
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Latest Consensus (Macau)</CardTitle>
            <CardDescription>Generated at {latestPred?.generatedAt ? new Date(latestPred.generatedAt).toLocaleString() : 'N/A'}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingPred ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : latestPred ? (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">4D Top Picks</h4>
                  <div className="flex flex-wrap gap-2">
                    {latestPred.consensus4d?.map((num, i) => (
                      <div key={i} className="px-3 py-1 bg-primary/20 text-primary border border-primary/30 rounded-md font-mono font-bold text-lg">
                        {num}
                      </div>
                    ))}
                    {!latestPred.consensus4d?.length && <span className="text-muted-foreground">No data</span>}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">BBFS 6 Digit</h4>
                  <div className="flex flex-wrap gap-2">
                    {latestPred.bbfs6?.map((num, i) => (
                      <div key={i} className="w-8 h-8 flex items-center justify-center bg-secondary text-secondary-foreground border border-border rounded-full font-mono font-bold">
                        {num}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No recent predictions found.</div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Scores</CardTitle>
            <CardDescription>Accuracy timeline for the last 5 draws</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingAcc ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {accuracy?.recentScores?.slice(0, 5).map((score, i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded-lg bg-card/50">
                    <div className="flex flex-col">
                      <span className="font-medium">{new Date(score.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</span>
                      <span className="font-mono text-sm text-primary">{score.actual}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${score.hit4d ? 'bg-green-500/20 text-green-500' : 'bg-secondary text-muted-foreground'}`}>4D</span>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${score.hit3d ? 'bg-green-500/20 text-green-500' : 'bg-secondary text-muted-foreground'}`}>3D</span>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${score.hit2d ? 'bg-green-500/20 text-green-500' : 'bg-secondary text-muted-foreground'}`}>2D</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
