import React from "react";
import ReactDOM from "react-dom/client";
import { CapsuleRail } from "./components/CapsuleRail";
import { CapsulePreview } from "./components/CapsulePreview";
import "./capsule.css";

const params = new URLSearchParams(window.location.search);
const monitorIndex = Number(params.get("monitor"));
const side =
  params.get("side") === "top" ? "top" : params.get("side") === "left" ? "left" : "right";
const root = document.getElementById("root");
if (root && Number.isInteger(monitorIndex) && monitorIndex >= 0) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {params.has("preview") ? (
        <CapsulePreview />
      ) : (
        <CapsuleRail monitorIndex={monitorIndex} side={side} />
      )}
    </React.StrictMode>,
  );
}
