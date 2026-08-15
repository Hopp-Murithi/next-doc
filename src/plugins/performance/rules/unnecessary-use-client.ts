import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";

/** Anything here means the component genuinely needs to run in the browser. */
const INTERACTIVITY = [
  /\buse(?:State|Effect|LayoutEffect|Reducer|Ref|Context|Callback|Memo|Transition|OptimisticState|Optimistic|FormStatus|FormState|ActionState|SyncExternalStore|ImperativeHandle|Id|DeferredValue)\b/,
  /\buseRouter\b|\buseSearchParams\b|\busePathname\b|\buseParams\b|\buseSelectedLayoutSegment/,
  /\buse[A-Z]\w*\s*\(/, // any custom hook call
  /\bon[A-Z]\w+\s*=/, // onClick, onChange, onSubmit
  /\bwindow\b|\bdocument\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\b|\bmatchMedia\b/,
  /addEventListener|IntersectionObserver|ResizeObserver|requestAnimationFrame/,
  /\bcreateContext\b|\bContext\.Provider\b|\.Provider\b/,
  /framer-motion|react-spring|@dnd-kit|react-hook-form|swr|@tanstack\/react-query|zustand|jotai|recoil|react-redux/,
  /\bclass\s+\w+\s+extends\s+(?:React\.)?Component\b/,
  /dangerouslySetInnerHTML/,
];

/**
 * Flags a "use client" directive with no visible reason for it. Diagnostic
 * only: removing the directive incorrectly breaks the app at runtime, so this
 * rule never offers a fix, it points at the file and lets a human decide.
 */
export const unnecessaryUseClient: Rule = {
  code: "PERF_UNNECESSARY_USE_CLIENT",
  title: "Client Components need to be client components",
  appliesTo: (ctx: ScanContext) => ctx.framework.isNext,
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const clientFiles = sources.filter((s) => s.isClient);
    if (clientFiles.length === 0) return [];

    const suspects = clientFiles.filter((file) => !INTERACTIVITY.some((re) => re.test(file.text)));

    if (suspects.length === 0) {
      return [
        finding.pass({
          code: "PERF_UNNECESSARY_USE_CLIENT",
          message: `All ${clientFiles.length} Client Components use browser only features`,
        }),
      ];
    }

    return suspects.map((file) =>
      finding.warn({
        code: "PERF_UNNECESSARY_USE_CLIENT",
        message: `${file.path} is a Client Component with no interactivity detected`,
        file: file.path,
        line: 1,
        fixable: false,
        suggestion:
          "If it has no hooks, no event handlers and no browser APIs, drop the use client directive so it renders on the server and ships no JavaScript. Check any child components first, they inherit the boundary.",
      }),
    );
  },
};
