/**
 * Card numbers are removed before a message reaches the model, the logs or a transcript; email addresses are
 * masked in the agent's replies. One function per job, used inbound, outbound and in summaries alike.
 */

// 13 to 19 digits, optionally grouped by single spaces or dashes, not glued to other digits or letters.
const CARD_CANDIDATE = /(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function redactCardNumbers(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (!luhnValid(digits)) return match;
    count++;
    return `[card ending ${digits.slice(-4)}]`;
  });
  return { text: out, count };
}

export function maskEmails(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(EMAIL, (_m, first: string, domain: string) => {
    count++;
    return `${first}•••@${domain}`;
  });
  return { text: out, count };
}
