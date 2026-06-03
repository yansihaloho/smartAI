import { useState } from "react";
import { useRunDeepAnalysis, useGetPasarans, getGetPasaransQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MACAU_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];

export default function DeepAnalysis() {
  const { toast } = useToast();
  const pasaran = "macau";
  const [slot, setSlot] = useState(MACAU_SLOTS[0]);
  const [result, setResult] = useState<any>(null);

  const deepMutation = useRunDeepAnalysis();

  const handleRun = () => {
    deepMutation.mutate(
      { data: { pasaran, timeSlot: slot } },
      {
        onSuccess: (data) => {
          setResult(data);
          toast({ title: "Success", description: "Deep analysis completed." });
        },
        onError: () => {
          toast({ title: "Error", description: "Deep analysis failed.", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analisis Mendalam</h1>
        <p className="text-muted-foreground">Run deep statistical analysis per position.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Parameter Analisis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Slot Waktu</label>
              <Select value={slot} onValueChange={setSlot}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Slot" />
                </SelectTrigger>
                <SelectContent>
                  {MACAU_SLOTS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={handleRun} disabled={deepMutation.isPending}>
              {deepMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              Run Deep Analysis
            </Button>
          </CardFooter>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Hasil Analisis {result?.timeSlot ? `Slot ${result.timeSlot}` : ''}</CardTitle>
            <CardDescription>
              {result ? `Berdasarkan ${result.totalDrawsUsed} undian` : "Menunggu eksekusi..."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result && !deepMutation.isPending && (
              <div className="text-center py-10 text-muted-foreground">
                Pilih parameter dan klik Run Deep Analysis
              </div>
            )}
            {deepMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-10 space-y-4 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p>Computing statistical models...</p>
              </div>
            )}
            {result && !deepMutation.isPending && (
               <div className="space-y-6">
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="border rounded p-4 text-center">
                      <h4 className="text-xs uppercase text-muted-foreground mb-1">Colok Jitu AS</h4>
                      <p className="font-mono text-2xl font-bold text-primary">{result.colokJitu?.find((c: any) => c.posisi === 'AS')?.digit || '-'}</p>
                    </div>
                    <div className="border rounded p-4 text-center">
                      <h4 className="text-xs uppercase text-muted-foreground mb-1">Colok Jitu KOP</h4>
                      <p className="font-mono text-2xl font-bold text-primary">{result.colokJitu?.find((c: any) => c.posisi === 'KOP')?.digit || '-'}</p>
                    </div>
                    <div className="border rounded p-4 text-center">
                      <h4 className="text-xs uppercase text-muted-foreground mb-1">Colok Jitu KEPALA</h4>
                      <p className="font-mono text-2xl font-bold text-primary">{result.colokJitu?.find((c: any) => c.posisi === 'KEPALA')?.digit || '-'}</p>
                    </div>
                    <div className="border rounded p-4 text-center">
                      <h4 className="text-xs uppercase text-muted-foreground mb-1">Colok Jitu EKOR</h4>
                      <p className="font-mono text-2xl font-bold text-primary">{result.colokJitu?.find((c: any) => c.posisi === 'EKOR')?.digit || '-'}</p>
                    </div>
                 </div>

                 <div>
                   <h3 className="font-medium text-lg mb-2">BBFS Rekomendasi</h3>
                   <div className="flex gap-2">
                     {result.bbfs6?.map((n: string, i: number) => (
                       <span key={i} className="px-3 py-1 bg-secondary border border-border rounded font-mono font-bold text-lg">{n}</span>
                     ))}
                   </div>
                 </div>
               </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
