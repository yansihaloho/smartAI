import { useState } from "react";
import { useGetSmartAISlots, getGetSmartAISlotsQueryKey, useGetSmartAI, getGetSmartAIQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const MACAU_SLOTS = ["00:01", "13:00", "16:00", "19:00", "22:00", "23:00"];

export default function SmartAI() {
  const pasaran = "macau";
  const [activeSlot, setActiveSlot] = useState(MACAU_SLOTS[0]);

  const { data: smartData, isLoading } = useGetSmartAI(
    { pasaran, slot: activeSlot },
    { query: { queryKey: getGetSmartAIQueryKey({ pasaran, slot: activeSlot }) } }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Smart AI Analysis</h1>
        <p className="text-muted-foreground">Slot-aware 7-engine analysis for Macau.</p>
      </div>

      <Tabs value={activeSlot} onValueChange={setActiveSlot} className="w-full">
        <TabsList className="grid grid-cols-6 mb-4">
          {MACAU_SLOTS.map(slot => (
            <TabsTrigger key={slot} value={slot}>{slot}</TabsTrigger>
          ))}
        </TabsList>

        <Card>
          <CardHeader>
            <CardTitle>Analisis Slot {activeSlot}</CardTitle>
            <CardDescription>
              {isLoading ? 'Loading...' : `Berdasarkan ${smartData?.totalSlotDraws || 0} hasil sebelumnya untuk slot ini.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : smartData ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Main 4D</div>
                    <div className="text-2xl font-mono font-bold text-primary">{smartData.main4d || '-'}</div>
                  </div>
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Confidence</div>
                    <div className="text-2xl font-bold text-blue-400">{(smartData.overallConfidence * 100).toFixed(1)}%</div>
                  </div>
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Colok Bebas</div>
                    <div className="flex gap-2">
                      {smartData.colokBebas?.map((num, i) => (
                        <Badge key={i} variant="outline" className="text-lg">{num}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="p-4 bg-secondary rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Shio</div>
                    <div className="flex flex-wrap gap-1">
                      {smartData.shio?.map((s, i) => (
                        <Badge key={i} className="bg-muted text-muted-foreground">{s}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium mb-3 border-b pb-2">Top Rekomendasi 2D</h3>
                  <div className="flex flex-wrap gap-3">
                    {smartData.topRekomendasi?.map((rek, i) => (
                      <div key={i} className="flex flex-col items-center p-3 border rounded-md min-w-[80px]">
                        <span className="font-mono text-xl font-bold">{rek.number}</span>
                        <span className="text-xs text-muted-foreground mt-1 text-center">{rek.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground">Tidak ada data analisis untuk slot ini.</div>
            )}
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
