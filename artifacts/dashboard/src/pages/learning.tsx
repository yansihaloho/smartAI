import { useGetEnginePerformance, getGetEnginePerformanceQueryKey, useGetLearningLog, getGetLearningLogQueryKey, useTriggerEvaluate } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Zap, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export default function Learning() {
  const { toast } = useToast();
  const pasaran = "macau";

  const { data: perf, isLoading: isLoadingPerf, refetch: refetchPerf } = useGetEnginePerformance(
    { pasaran, limit: 10 },
    { query: { queryKey: getGetEnginePerformanceQueryKey({ pasaran, limit: 10 }) } }
  );

  const { data: log, isLoading: isLoadingLog, refetch: refetchLog } = useGetLearningLog(
    { pasaran, limit: 15 },
    { query: { queryKey: getGetLearningLogQueryKey({ pasaran, limit: 15 }) } }
  );

  const evalMutation = useTriggerEvaluate();

  const handleEvaluate = () => {
    evalMutation.mutate(
      { data: {} },
      {
        onSuccess: () => {
          toast({ title: "Success", description: "Learning evaluation triggered." });
          refetchPerf();
          refetchLog();
        },
        onError: () => {
          toast({ title: "Error", description: "Evaluation failed.", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Self-Learning Log</h1>
          <p className="text-muted-foreground">Engine weight adjustments based on actual draw results.</p>
        </div>
        <Button onClick={handleEvaluate} disabled={evalMutation.isPending}>
          <Play className={`mr-2 h-4 w-4 ${evalMutation.isPending ? 'animate-pulse' : ''}`} />
          Run Learning Cycle
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-yellow-500" /> Current Engine Weights</CardTitle>
            <CardDescription>Top engines by adaptive weight multiplier</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingPerf ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Engine</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Multiplier</TableHead>
                    <TableHead>Evals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perf?.weights?.slice(0, 8).map((w, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-xs">{w.key}</TableCell>
                      <TableCell className="text-xs uppercase">{w.category}</TableCell>
                      <TableCell className={`font-mono font-bold ${w.multiplier > 1.1 ? 'text-green-500' : w.multiplier < 0.9 ? 'text-red-500' : ''}`}>
                        {w.multiplier.toFixed(3)}x
                      </TableCell>
                      <TableCell>{w.sampleSize}</TableCell>
                    </TableRow>
                  ))}
                  {!perf?.weights?.length && (
                    <TableRow><TableCell colSpan={4} className="text-center">No engine data.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Evaluations</CardTitle>
            <CardDescription>Learning history and weight updates</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingLog ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                {log?.log?.map((l) => (
                  <div key={l.id} className="p-3 border rounded-lg bg-card/50 text-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="font-bold text-primary font-mono mr-2">{l.actualResult}</span>
                        <span className="text-muted-foreground text-xs">{new Date(l.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="flex gap-1">
                        {l.hit4d && <Badge className="bg-green-500/20 text-green-500 text-[10px]">4D</Badge>}
                        {l.hit3d && <Badge className="bg-green-500/20 text-green-500 text-[10px]">3D</Badge>}
                        {l.hit2d && <Badge className="bg-green-500/20 text-green-500 text-[10px]">2D</Badge>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="text-green-400 mr-2">Best: {l.bestCategory}</span>
                      <span className="text-red-400">Worst: {l.worstCategory}</span>
                    </div>
                  </div>
                ))}
                {!log?.log?.length && (
                  <div className="text-center py-4 text-muted-foreground">No logs found.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
