import { useState } from "react";
import { useRunPrediction, useGetLatestPrediction, getGetLatestPredictionQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrainCircuit, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function Prediksi() {
  const { toast } = useToast();
  const [limit, setLimit] = useState(1);
  const pasaran = "macau";

  const { data: latestPred, isLoading: isLoadingPred, refetch } = useGetLatestPrediction(
    { pasaran },
    { query: { queryKey: getGetLatestPredictionQueryKey({ pasaran }) } }
  );

  const runPredMutation = useRunPrediction();

  const handleRunPrediction = () => {
    runPredMutation.mutate(
      { data: { pasaran, limit } },
      {
        onSuccess: () => {
          toast({ title: "Success", description: "Prediction generated successfully." });
          refetch();
        },
        onError: (err) => {
          toast({ title: "Error", description: "Failed to generate prediction.", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prediksi AI</h1>
        <p className="text-muted-foreground">Run the prediction engine to generate consensus picks.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="col-span-1 border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle>Engine Control</CardTitle>
            <CardDescription>Jalankan analisis prediksi terbaru.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p>Pasaran: <span className="font-bold text-foreground capitalize">{pasaran}</span></p>
                <p>Target Slot: <span className="font-bold text-foreground">Next Available</span></p>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              onClick={handleRunPrediction} 
              disabled={runPredMutation.isPending}
            >
              {runPredMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
              Run Prediction
            </Button>
          </CardFooter>
        </Card>

        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Latest Result</CardTitle>
            <CardDescription>
              {latestPred?.generatedAt ? new Date(latestPred.generatedAt).toLocaleString() : 'No recent prediction'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingPred ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : latestPred ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">4D Consensus</h4>
                  <div className="flex flex-wrap gap-2">
                    {latestPred.consensus4d?.map((v, i) => (
                      <span key={i} className="px-2 py-1 bg-secondary text-secondary-foreground rounded font-mono font-bold text-lg">{v}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">BBFS 6</h4>
                  <div className="flex flex-wrap gap-2">
                    {latestPred.bbfs6?.map((v, i) => (
                      <span key={i} className="px-2 py-1 border rounded text-primary border-primary/50 bg-primary/10 font-mono font-bold">{v}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">3D Picks</h4>
                  <div className="flex flex-wrap gap-2">
                    {latestPred.consensus3d?.map((v, i) => (
                      <span key={i} className="px-2 py-1 bg-muted rounded font-mono">{v}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">Colok Bebas</h4>
                  <div className="flex flex-wrap gap-2">
                    {latestPred.colokBebas?.map((v, i) => (
                      <span key={i} className="px-3 py-1 bg-accent text-accent-foreground rounded-full font-bold">{v}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">No prediction data found. Click "Run Prediction" to start.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
