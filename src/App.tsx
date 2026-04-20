import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorState } from "./components/ErrorState";
import { FirestoreEmptyLeague } from "./components/FirestoreEmptyLeague";
import { Layout } from "./components/Layout";
import { LoadingState } from "./components/LoadingState";
import { LeagueProvider, useLeague } from "./context/LeagueContext";
import { WaiverProvider } from "./context/WaiverContext";
import { Home } from "./pages/Home";
import { MatchPoints } from "./pages/MatchPoints";
import { Players } from "./pages/Players";
import { Predictions } from "./pages/Predictions";
import { Rules } from "./pages/Rules";
import { TeamDetail } from "./pages/TeamDetail";
import { Teams } from "./pages/Teams";
import { AdminScoreSync } from "./pages/AdminScoreSync";
import { Waivers } from "./pages/Waivers";

function routerBasename(): string {
  let b = import.meta.env.BASE_URL;
  if (b.endsWith("/")) b = b.slice(0, -1);
  return b === "" ? "/" : b;
}

function isFirestoreLeagueMissingError(message: string | null): boolean {
  return (
    !!message &&
    message.includes("No league data in Firestore") &&
    message.includes("leagueBundle")
  );
}

function DataRoutes() {
  const { loading, error, refresh, bundle } = useLeague();

  if (loading) return <LoadingState />;
  if (error && isFirestoreLeagueMissingError(error)) {
    return <FirestoreEmptyLeague onRetry={() => void refresh()} />;
  }
  if (error)
    return (
      <div className="mx-auto max-w-lg px-4 pt-16">
        <ErrorState message={error} onRetry={() => void refresh()} />
      </div>
    );
  if (!bundle)
    return (
      <div className="mx-auto max-w-lg px-4 pt-16">
        <ErrorState
          message="League data is empty."
          onRetry={() => void refresh()}
        />
      </div>
    );

  return (
    <WaiverProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="leaderboard" element={<Navigate to="/" replace />} />
          <Route path="franchises" element={<Navigate to="/teams" replace />} />
          <Route path="teams" element={<Teams />} />
          <Route path="teams/:ownerSlug" element={<TeamDetail />} />
          <Route path="players" element={<Players />} />
          <Route path="matches" element={<MatchPoints />} />
          <Route path="waivers" element={<Waivers />} />
          <Route path="score-sync" element={<AdminScoreSync />} />
          <Route path="auction" element={<Navigate to="/waivers" replace />} />
          <Route path="predictions" element={<Predictions />} />
          <Route path="rules" element={<Rules />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </WaiverProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename()}>
      <LeagueProvider>
        <DataRoutes />
      </LeagueProvider>
    </BrowserRouter>
  );
}
