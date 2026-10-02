import { lazy, Suspense } from "react";
// Mac rails are AppKit-only windows; this entry serves Markdown previews.
export function CapsuleRail() {
  return null;
}
const Preview = lazy(() =>
  import("./Preview").then((module) => ({ default: module.CapsulePreview })),
);
export function CapsulePreview() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
import "./capsules.css";
