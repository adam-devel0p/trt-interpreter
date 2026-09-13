/**
 * Tolerant parser for a JSON document that is still arriving (spec §13: show state
 * immediately, AI may stream). Given a prefix of a JSON object it returns whatever has been
 * produced so far — completed fields intact, the string being written cut where the text ends.
 * Both the streaming route and the client island use it, so it is pure and dependency-free.
 */
import type { PartialInterpretation } from './schema';

interface Parsed {
  value: unknown;
  /** True when the input ended inside this value. */
  truncated: boolean;
}

const MISSING = Symbol('missing');

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }

  private get eof() {
    return this.i >= this.s.length;
  }

  value(): Parsed | typeof MISSING {
    this.ws();
    if (this.eof) return MISSING;
    const c = this.s[this.i]!;
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    return this.literal();
  }

  private object(): Parsed {
    const out: Record<string, unknown> = {};
    this.i++; // {
    for (;;) {
      this.ws();
      if (this.eof) return { value: out, truncated: true };
      if (this.s[this.i] === '}') {
        this.i++;
        return { value: out, truncated: false };
      }
      if (this.s[this.i] === ',') {
        this.i++;
        continue;
      }
      if (this.s[this.i] !== '"') return { value: out, truncated: true };
      const key = this.string();
      if (key.truncated) return { value: out, truncated: true };
      this.ws();
      if (this.eof || this.s[this.i] !== ':') return { value: out, truncated: true };
      this.i++;
      const v = this.value();
      if (v === MISSING) return { value: out, truncated: true };
      out[key.value as string] = v.value;
      if (v.truncated) return { value: out, truncated: true };
    }
  }

  private array(): Parsed {
    const out: unknown[] = [];
    this.i++; // [
    for (;;) {
      this.ws();
      if (this.eof) return { value: out, truncated: true };
      if (this.s[this.i] === ']') {
        this.i++;
        return { value: out, truncated: false };
      }
      if (this.s[this.i] === ',') {
        this.i++;
        continue;
      }
      const v = this.value();
      if (v === MISSING) return { value: out, truncated: true };
      out.push(v.value);
      if (v.truncated) return { value: out, truncated: true };
    }
  }

  private string(): Parsed {
    let out = '';
    this.i++; // opening quote
    while (!this.eof) {
      const c = this.s[this.i]!;
      if (c === '"') {
        this.i++;
        return { value: out, truncated: false };
      }
      if (c === '\\') {
        const n = this.s[this.i + 1];
        if (n === undefined) return { value: out, truncated: true };
        if (n === 'u') {
          const hex = this.s.slice(this.i + 2, this.i + 6);
          if (hex.length < 4) return { value: out, truncated: true };
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 6;
          continue;
        }
        out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[n] ?? n;
        this.i += 2;
        continue;
      }
      out += c;
      this.i++;
    }
    return { value: out, truncated: true };
  }

  private literal(): Parsed | typeof MISSING {
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(this.s.slice(this.i));
    if (!m) {
      // Not JSON at this point (e.g. a code fence). Treat as end of usable input.
      this.i = this.s.length;
      return MISSING;
    }
    const tok = m[0];
    const atEnd = this.i + tok.length >= this.s.length;
    this.i += tok.length;
    // A number at the very end may still be growing; report it as missing rather than wrong.
    if (atEnd && /^-?\d/.test(tok)) return MISSING;
    if (tok === 'true') return { value: true, truncated: false };
    if (tok === 'false') return { value: false, truncated: false };
    if (tok === 'null') return { value: null, truncated: false };
    return { value: Number(tok), truncated: false };
  }
}

/** Strip a ```json fence and anything before the first `{`. */
export function stripToJson(text: string): string {
  const start = text.indexOf('{');
  return start >= 0 ? text.slice(start) : '';
}

/** Best-effort parse of a JSON prefix. Returns null before the opening brace has arrived. */
export function parsePartialJson(text: string): unknown | null {
  const body = stripToJson(text);
  if (!body) return null;
  const v = new Parser(body).value();
  return v === MISSING ? null : v.value;
}

/** Strict parse of a complete document (fence-tolerant); throws like JSON.parse. */
export function parseCompleteJson(text: string): unknown {
  const body = stripToJson(text);
  const end = body.lastIndexOf('}');
  return JSON.parse(end >= 0 ? body.slice(0, end + 1) : body);
}

/** The layers present so far in a streaming interpretation, in a shape the UI can render. */
export function partialInterpretation(text: string): PartialInterpretation {
  const v = parsePartialJson(text);
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: PartialInterpretation = {};
  if (typeof o.synthesis === 'string') out.synthesis = o.synthesis;
  if (Array.isArray(o.per_card)) {
    out.per_card = o.per_card
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        position_index: typeof c.position_index === 'number' ? c.position_index : undefined,
        text: typeof c.text === 'string' ? c.text : undefined,
        nuances: Array.isArray(c.nuances)
          ? c.nuances.filter((n): n is string => typeof n === 'string')
          : undefined,
      }));
  }
  if (typeof o.combined === 'string') out.combined = o.combined;
  if (Array.isArray(o.reflective_prompts)) {
    out.reflective_prompts = o.reflective_prompts.filter((p): p is string => typeof p === 'string');
  }
  return out;
}
