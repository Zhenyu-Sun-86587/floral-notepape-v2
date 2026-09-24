import { useEffect, useState } from "react";

let diagramSequence = 0;
let mermaidLoader: Promise<(typeof import("mermaid"))["default"]> | null = null;

function loadMermaid() {
  mermaidLoader ??= import("mermaid")
    .then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
      });
      return mermaid;
    })
    .catch((error) => {
      mermaidLoader = null;
      throw error;
    });
  return mermaidLoader;
}

export function MermaidBlock({ source }: { source: string }) {
  const [result, setResult] = useState<{ source: string; svg?: string; error?: string }>({
    source,
  });

  useEffect(() => {
    let active = true;
    setResult({ source });
    void loadMermaid()
      .then(async (mermaid) => {
        const { svg } = await mermaid.render(`hermes-mermaid-${++diagramSequence}`, source);
        // 编辑期间旧图异步完成时，不能覆盖新源码的预览。
        if (active) setResult({ source, svg });
      })
      .catch((error) => {
        if (active) setResult({ source, error: String(error) });
      });
    return () => {
      active = false;
    };
  }, [source]);

  if (result.source === source && result.svg) {
    return (
      <div
        className="my-3 overflow-x-auto rounded bg-paper-warm/80 p-3 text-center"
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    );
  }
  return (
    <div className="markdown-code-block my-3 rounded bg-paper-warm/80 p-3">
      {result.source === source && result.error && (
        <p className="mb-2 text-xs text-red-500">图表渲染失败：{result.error}</p>
      )}
      <pre className="overflow-x-auto text-[0.85em] whitespace-pre">{source}</pre>
    </div>
  );
}
