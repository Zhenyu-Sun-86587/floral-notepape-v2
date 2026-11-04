// Pure CodeMirror state microbenchmark. No app launch, WebView, or user documents.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
mkdirSync(join(root, "local-build"), { recursive: true });
const dir = mkdtempSync(join(root, "local-build/inline-bench-"));
const output = join(root, "local-build/Folio-2.1.0-performance.json");
try {
  const before = execFileSync(
    "git",
    ["show", "c0debaa3a9b52e51b286765e2839890fb4b3234f:src/features/markdown/livePresentation.ts"],
    { cwd: root, encoding: "utf8" },
  );
  writeFileSync(
    join(dir, "baseline.ts"),
    before.replaceAll('from "./', 'from "../../src/features/markdown/'),
  );
  writeFileSync(
    join(dir, "layout.test.ts"),
    `
import {it, expect} from "vitest";
import {EditorState} from "@codemirror/state";
import {markdown} from "@codemirror/lang-markdown";
import {ensureSyntaxTree} from "@codemirror/language";
import {performance} from "node:perf_hooks";
import {writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import os from "node:os";
import {liveDecorations as baseline} from "./baseline";
import {buildLiveLayout} from "../../src/features/markdown/livePresentation";
it("same warm, fully parsed synthetic document, before/after", () => {
  const doc=Array.from({length:1000}, (_,i)=>"Paragraph "+i+" **bold** and [link](https://example.com)").join("\\n\\n");
  let initial=EditorState.create({doc,extensions:[markdown()]});
  expect(ensureSyntaxTree(initial,doc.length,5000)).not.toBeNull();
  initial=initial.update({}).state;
  const options={showSyntax:true,fontSize:14};
  function run(kind:string, optimized:boolean) {
    let state=initial;
    let layout=optimized?buildLiveLayout(state,options):null;
    if(!optimized) baseline(state,options);
    const steps=50;
    let rebuilt=0;
    const start=performance.now();
    for(let i=0;i<steps;i++) {
      const anchor=(i*977)%(state.doc.length-1);
      const tr=state.update(kind==="selection"?{selection:{anchor}}:{changes:{from:anchor,insert:"x"}});
      if(optimized) {layout=buildLiveLayout(tr.state,options,layout!,tr.changes);rebuilt+=layout.rebuiltBlocks;}
      else baseline(tr.state,options);
      state=tr.state;
    }
    return {milliseconds:performance.now()-start,steps,rebuiltBlocks:optimized?rebuilt:null};
  }
  const scenarios=["selection","typing"].map(kind=>{
    run(kind,false);run(kind,true);
    const before=[],after=[];
    for(let trial=0;trial<5;trial++) {
      if(trial%2) {after.push(run(kind,true));before.push(run(kind,false));}
      else {before.push(run(kind,false));after.push(run(kind,true));}
    }
    return {kind,before,after};
  });
  writeFileSync(process.env.FOLIO_BENCH_RESULT!,JSON.stringify({
    date:new Date().toISOString(),version:"2.1.0",baseline:"PR26 c0debaa",
    machine:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0].model,memoryGB:os.totalmem()/1024**3,
      os:process.platform==="darwin"?execFileSync("sw_vers",["-productVersion"],{encoding:"utf8"}).trim():os.release(),node:process.version},
    document:{characters:doc.length,paragraphs:1000},cache:"warm modules, full syntax tree, initial layout excluded",
    scope:"CodeMirror state and decoration microbenchmark; no WebView, DOM, actual typing latency, idle CPU, GPU, energy or app RSS",scenarios
  },null,2));
},30000);
`,
  );
  execFileSync(
    process.execPath,
    [join(root, "node_modules/vitest/vitest.mjs"), "run", join(dir, "layout.test.ts")],
    {
      cwd: root,
      env: { ...process.env, FOLIO_BENCH_RESULT: output },
      stdio: "pipe",
    },
  );
  const result = JSON.parse(readFileSync(output, "utf8"));
  const median = (xs) =>
    xs.map((x) => x.milliseconds).sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(
    JSON.stringify(
      {
        machine: result.machine,
        document: result.document,
        scope: result.scope,
        timings: result.scenarios.map((x) => ({
          scenario: x.kind,
          steps: 50,
          beforeMedianMs: median(x.before),
          afterMedianMs: median(x.after),
        })),
        output,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
