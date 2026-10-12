import { useSyncExternalStore } from "react";
import { Playground } from "./Playground.tsx";
import { Report } from "./Report.tsx";

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
  };
};

/** Hash routes, so deep links work on GitHub Pages with no server: #/ and #/report/06. */
export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

export function App() {
  const route = useRoute();
  const onReport = route[0] === "report";
  return (
    <div className="app">
      <header className="top">
        <span className="brand">
          Paylane support agent <span className="muted">· Fini take-home</span>
        </span>
        <nav className="tabs" aria-label="Screens">
          <a href="#/" aria-current={onReport ? undefined : "page"}>
            Playground
          </a>
          <a href="#/report" aria-current={onReport ? "page" : undefined}>
            Eval report
          </a>
        </nav>
      </header>
      {onReport ? <Report selected={route[1]} /> : <Playground />}
    </div>
  );
}
