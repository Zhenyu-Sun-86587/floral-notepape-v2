import React from "react";
import ReactDOM from "react-dom/client";
import { CapsuleRail } from "./components/CapsuleRail";
import { CapsulePreview } from "./components/CapsulePreview";
import "./capsule.css";

const params = new URLSearchParams(window.location.search);
const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {params.has("preview") ? <CapsulePreview /> : <CapsuleRail />}
    </React.StrictMode>,
  );
}
