const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "pem", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "openai", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "github", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: "assignment",
    re: /\b(api[_-]?key|secret|token|password|passwd|authorization|bearer)\s*[:=]\s*['"]?[^'"\s]{8,}['"]?/gi,
  },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi },
];

export class SecretRedactor {
  static containsSecret(text: string): boolean {
    return SecretRedactor.redact(text) !== text;
  }

  static redact(text: string): string {
    let out = text;
    for (const { re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      out = out.replace(re, "[REDACTED]");
    }
    return out;
  }
}
