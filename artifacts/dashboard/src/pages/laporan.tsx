import { useGetLaporan, getGetLaporanQueryKey, useForceEvaluateLaporan } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Laporan() {
  const { toast } = useToast();
  const pasaran = "macau";
  const days = 30;

  const { data: laporan, isLoading, refetch } = useGetLaporan(
    { pasaran, days },
    { query: { queryKey: getGetLaporanQueryKey({ pasaran, days }) } }
  );

  const forceEvalMutation = useForceEvaluateLaporan();

  const handleForceEval = () => {
    forceEvalMutation.mutate(
      { data: { pasaran, days: 7 } },
      {
        onSuccess: () => {
          toast({ title: "Success", description: "Evaluation completed." });
          refetch();
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
          <h1 className="text-3xl font-bold tracking-tight">Laporan Akurasi</h1>
          <p className="text-muted-foreground">LOO Backtest Accuracy over {days} days.</p>
        </div>
        <Button onClick={handleForceEval} disabled={forceEvalMutation.isPending} variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${forceEvalMutation.isPending ? 'animate-spin' : ''}`} />
          Force Evaluate
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Win Rate 4D</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold text-primary">{(laporan?.summary.pct4d || 0).toFixed(2)}%</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Win Rate 3D</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold text-blue-400">{(laporan?.summary.pct3d || 0).toFixed(2)}%</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Win Rate 2D (Top 1)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold text-green-400">{(laporan?.summary.pct2dTop1 || 0).toFixed(2)}%</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">BBFS Hit Rate</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold text-yellow-400">{(laporan?.summary.pctBbfs || 0).toFixed(2)}%</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Performa Per Slot</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
               <Skeleton className="h-10 w-full" />
               <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slot</TableHead>
                  <TableHead>Evaluasi</TableHead>
                  <TableHead>2D Top 1</TableHead>
                  <TableHead>3D</TableHead>
                  <TableHead>4D</TableHead>
                  <TableHead>Colok Bebas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {laporan?.perSlot.map((slot) => (
                  <TableRow key={slot.slot}>
                    <TableCell className="font-bold">{slot.slot}</TableCell>
                    <TableCell>{slot.count}</TableCell>
                    <TableCell className={slot.pct2dTop1 > 10 ? 'text-green-500 font-bold' : ''}>{slot.pct2dTop1.toFixed(1)}%</TableCell>
                    <TableCell>{slot.pct3d.toFixed(1)}%</TableCell>
                    <TableCell>{slot.pct4d.toFixed(1)}%</TableCell>
                    <TableCell>{slot.pctColok.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
