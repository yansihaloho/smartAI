import { useState } from "react";
import { useGetResults, getGetResultsQueryKey, useGetGroupedResults, getGetGroupedResultsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Results() {
  const [activeTab, setActiveTab] = useState("flat");
  const pasaran = "macau";

  const { data: results, isLoading: isLoadingResults } = useGetResults(
    { pasaran, limit: 100 },
    { query: { queryKey: getGetResultsQueryKey({ pasaran, limit: 100 }) } }
  );

  const { data: groupedResults, isLoading: isLoadingGrouped } = useGetGroupedResults(
    { pasaran, limit: 30 },
    { query: { queryKey: getGetGroupedResultsQueryKey({ pasaran, limit: 30 }) } }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Hasil Undian</h1>
        <p className="text-muted-foreground">Historical draw results for Macau pasaran.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="flat">Daftar Lengkap</TabsTrigger>
          <TabsTrigger value="grouped">Berdasarkan Slot</TabsTrigger>
        </TabsList>
        <TabsContent value="flat">
          <Card>
            <CardHeader>
              <CardTitle>Daftar Hasil Terakhir</CardTitle>
              <CardDescription>Menampilkan 100 hasil terakhir</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingResults ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periode</TableHead>
                        <TableHead>Tanggal</TableHead>
                        <TableHead>Result 4D</TableHead>
                        <TableHead>3D</TableHead>
                        <TableHead>2D</TableHead>
                        <TableHead>As/Kop/Kep/Ekr</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results?.map((res) => (
                        <TableRow key={res.id}>
                          <TableCell className="font-medium">{res.periode}</TableCell>
                          <TableCell>{res.tanggal}</TableCell>
                          <TableCell className="font-bold text-primary">{res.result4d}</TableCell>
                          <TableCell>{res.result3d}</TableCell>
                          <TableCell>{res.result2d}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {res.as} - {res.kop} - {res.kepala} - {res.ekor}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!results?.length && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center">No results found</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="grouped">
          <Card>
            <CardHeader>
              <CardTitle>Berdasarkan Slot</CardTitle>
              <CardDescription>Hasil dikelompokkan per tanggal dan slot</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingGrouped ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tanggal</TableHead>
                        <TableHead>Hari</TableHead>
                        <TableHead>00:01</TableHead>
                        <TableHead>13:00</TableHead>
                        <TableHead>16:00</TableHead>
                        <TableHead>19:00</TableHead>
                        <TableHead>22:00</TableHead>
                        <TableHead>23:00</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupedResults?.map((res, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium whitespace-nowrap">{res.tanggal}</TableCell>
                          <TableCell>{res.hari}</TableCell>
                          <TableCell><Badge variant={res.slots?.['00:01'] ? "default" : "outline"}>{res.slots?.['00:01'] || "-"}</Badge></TableCell>
                          <TableCell><Badge variant={res.slots?.['13:00'] ? "default" : "outline"}>{res.slots?.['13:00'] || "-"}</Badge></TableCell>
                          <TableCell><Badge variant={res.slots?.['16:00'] ? "default" : "outline"}>{res.slots?.['16:00'] || "-"}</Badge></TableCell>
                          <TableCell><Badge variant={res.slots?.['19:00'] ? "default" : "outline"}>{res.slots?.['19:00'] || "-"}</Badge></TableCell>
                          <TableCell><Badge variant={res.slots?.['22:00'] ? "default" : "outline"}>{res.slots?.['22:00'] || "-"}</Badge></TableCell>
                          <TableCell><Badge variant={res.slots?.['23:00'] ? "default" : "outline"}>{res.slots?.['23:00'] || "-"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
