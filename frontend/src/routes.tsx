import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./components/layout/app-shell";
import { Today } from "./pages/today";
import { Trends } from "./pages/trends";
import { Workouts } from "./pages/workouts";
import { DataHealth } from "./pages/data-health";
import { Explorer } from "./pages/explorer";
import { Settings } from "./pages/settings";
import { Morning } from "./pages/morning";
import { Evening } from "./pages/evening";
import { CutPhases } from "./pages/cut-phases";
import { Coach } from "./pages/coach";
import { Measurements } from "./pages/measurements";
import { Health } from "./pages/health";
import { WeeklyScorecard } from "./pages/week";
import { Photos } from "./pages/photos";
import { Achievements } from "./pages/achievements";
import { Recaps } from "./pages/recaps";
import { Insights } from "./pages/insights";
import { Performance } from "./pages/performance";
import { Activities } from "./pages/activities";
import { ActivityDetail } from "./pages/activity-detail";
import { Swim } from "./pages/swim";
import { Load } from "./pages/load";
import { Goals } from "./pages/goals";
import { Nutrition } from "./pages/nutrition";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Today /> },
      { path: "health", element: <Health /> },
      { path: "trends", element: <Trends /> },
      { path: "workouts", element: <Workouts /> },
      { path: "data-health", element: <DataHealth /> },
      { path: "explorer", element: <Explorer /> },
      { path: "settings", element: <Settings /> },
      { path: "morning", element: <Morning /> },
      { path: "evening", element: <Evening /> },
      { path: "cut-phases", element: <CutPhases /> },
      { path: "coach", element: <Coach /> },
      { path: "measurements", element: <Measurements /> },
      { path: "week", element: <WeeklyScorecard /> },
      { path: "photos", element: <Photos /> },
      { path: "achievements", element: <Achievements /> },
      { path: "recaps", element: <Recaps /> },
      { path: "insights", element: <Insights /> },
      { path: "performance", element: <Performance /> },
      { path: "activities", element: <Activities /> },
      { path: "activities/:id", element: <ActivityDetail /> },
      { path: "swim", element: <Swim /> },
      { path: "load", element: <Load /> },
      { path: "goals", element: <Goals /> },
      { path: "nutrition", element: <Nutrition /> },
    ],
  },
]);
