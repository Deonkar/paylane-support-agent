import { Ban, CircleCheck, CircleAlert, Hand, Search } from "lucide-react";
import type { Tone, TranscriptLine } from "../../src/shared/transcript.ts";

const NOTE_ICON: Record<Tone, typeof Ban> = {
  allowed: CircleCheck,
  blocked: Ban,
  handoff: Hand,
  error: CircleAlert,
  plain: Search,
};

/** Not colour alone: every state also carries a word for screen readers and an icon. */
const NOTE_WORD: Record<Tone, string> = {
  allowed: "Allowed",
  blocked: "Not allowed",
  handoff: "Handed off",
  error: "Problem",
  plain: "Checked",
};

interface Props {
  lines: readonly TranscriptLine[];
  highlight?: ReadonlySet<number>;
  selected?: number | null;
  onSelect?: (n: number) => void;
}

/** The numbered record: messages and the agent's actions in one ordered list, cited by line number. */
export function Transcript({ lines, highlight, selected, onSelect }: Props) {
  return (
    <ol className="record" aria-label="Conversation record">
      {lines.map((l) => {
        const cls = [
          "line",
          `k-${l.kind}`,
          l.kind === "note" ? l.tone : "",
          highlight?.has(l.n) ? "hl" : "",
          selected === l.n ? "sel" : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (l.kind !== "note") {
          return (
            <li key={l.n} className={cls} value={l.n}>
              <span className="who">{l.kind === "customer" ? "Customer" : "Agent"}</span>
              <p>{l.text}</p>
            </li>
          );
        }
        const Icon = NOTE_ICON[l.tone];
        return (
          <li key={l.n} className={cls} value={l.n}>
            <button type="button" className="note-btn" onClick={() => onSelect?.(l.n)} aria-pressed={selected === l.n}>
              <Icon size={15} aria-hidden="true" />
              <span className="sr-only">{NOTE_WORD[l.tone]}: </span>
              {l.text}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
