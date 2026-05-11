import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./components/layout/app-shell";
import { Today } from "./pages/today";
import { Trends } from "./pages/trends";
import { DataHealth } from "./pages/data-health";
import { Explorer } from "./pages/explorer";
import { Settings } from "./pages/settings";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Today /> },
      { path: "trends", element: <Trends /> },
      { path: "data-health", element: <DataHealth /> },
      { path: "explorer", element: <Explorer /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);
