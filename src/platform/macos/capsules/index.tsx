import { lazy, Suspense } from "react";
export { CapsuleRail } from "./Rail";
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
