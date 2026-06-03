import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Results from "@/pages/results";
import Prediksi from "@/pages/prediksi";
import SmartAI from "@/pages/smart-ai";
import DeepAnalysis from "@/pages/deep-analysis";
import Laporan from "@/pages/laporan";
import Learning from "@/pages/learning";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/results" component={Results} />
        <Route path="/prediksi" component={Prediksi} />
        <Route path="/smart-ai" component={SmartAI} />
        <Route path="/deep" component={DeepAnalysis} />
        <Route path="/laporan" component={Laporan} />
        <Route path="/learning" component={Learning} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
