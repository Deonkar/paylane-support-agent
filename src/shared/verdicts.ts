/**
 * Two separate verdicts per run, because they mean different things:
 * - rules: the code checks (no out-of-policy refund, no leak, verified first...). A miss here is a policy breach.
 * - wording: the Jev-judged checks (tone, false promises, asking the right question). A miss here is a quality issue.
 * Mixing them into one badge makes a run that held every rule look like a failure.
 */

export type Verdict = "pass" | "fail" | "review";

interface CheckLike {
  kind: string;
  status: Verdict;
}

export function rulesVerdict(checks: readonly CheckLike[]): "pass" | "fail" {
  return checks.filter((c) => c.kind === "code").every((c) => c.status === "pass") ? "pass" : "fail";
}

export function wordingVerdict(checks: readonly CheckLike[]): Verdict {
  const judged = checks.filter((c) => c.kind === "jev");
  if (judged.some((c) => c.status === "fail")) return "fail";
  if (judged.some((c) => c.status === "review")) return "review";
  return "pass";
}
