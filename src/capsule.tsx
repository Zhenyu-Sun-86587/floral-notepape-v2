import React from "react";
import ReactDOM from "react-dom/client";
import { CapsuleRail, CapsulePreview } from "#platform-capsules";

const params = new URLSearchParams(window.location.search);
const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {params.has("preview") ? <CapsulePreview /> : <CapsuleRail />}
    </React.StrictMode>,
  );
}
