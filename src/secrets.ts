const FULL_REPLACE: { name: string; re: RegExp }[] = [
  { name: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "openai", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

const ASSIGNMENT_RE =
  /\b(api[_-]?key|secret|token|password|passwd|authorization|bearer)\s*([:=])\s*(['"]?)([^'"\s]+)\3/gi;

const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+/=-]{12,})\b/gi;

export class SecretRedactor {
  static containsSecret(text: string): boolean {
    return SecretRedactor.redact(text) !== text;
  }

  static redact(text: string): string {
    let out = text;
    for (const { re } of FULL_REPLACE) {
      re.lastIndex = 0;
      out = out.replace(re, "[REDACTED]");
    }
    ASSIGNMENT_RE.lastIndex = 0;
    out = out.replace(ASSIGNMENT_RE, (full, keyword: string, sep: string, quote: string, value: string) => {
      if (!SecretRedactor.looksLikeSecret(value)) {
        return full;
      }
      return `${keyword}${sep} ${quote}[REDACTED]${quote}`.replace(/  +/g, " ");
    });
    BEARER_RE.lastIndex = 0;
    out = out.replace(BEARER_RE, (_full, value: string) =>
      SecretRedactor.looksLikeSecret(value) || /[0-9]/.test(value) || value.length >= 16
        ? "Bearer [REDACTED]"
        : `Bearer ${value}`,
    );
    return out;
  }

  static looksLikeSecret(value: string): boolean {
    const v = value.replace(/^['"]|['"]$/g, "");
    if (v.length < 8) {
      return false;
    }
    if (/^[A-Za-z]+$/.test(v)) {
      return false;
    }
    const classes = [/[a-z]/.test(v), /[A-Z]/.test(v), /\d/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
    if (v.length >= 8 && classes >= 3) {
      return true;
    }
    if (v.length >= 12 && /[A-Za-z]/.test(v) && /\d/.test(v)) {
      return true;
    }
    if (/^[A-Fa-f0-9]{16,}$/.test(v)) {
      return true;
    }
    if (/^[A-Za-z0-9+/=_-]{16,}$/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v)) {
      return true;
    }
    return v.length >= 12 && SecretRedactor.shannon(v) >= 3.5;
  }

  static shannon(text: string): number {
    const freq = new Map<string, number>();
    for (const ch of text) {
      freq.set(ch, (freq.get(ch) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / text.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }
}
