// Custom-field patterns are a regular language, evaluated without backtracking.
// This module deliberately implements no captures, lookaround or backreferences.
const MAX_PATTERN_LENGTH = 200;
const MAX_STATES = 2_048;
const MAX_REPEAT = 1_000;
const MAX_CACHED_STATES = 128;
const MAX_CACHED_TRANSITIONS = 512;
const MAX_CACHED_CHARACTERS = 256;
// One definition/list shares this deterministic budget, including cache misses
// and fast-path input visits. Exhaustion is a configuration error, not a miss.
const MAX_MATCH_WORK = 200_000;

type Expression =
  | { kind: "atom"; atom: number }
  | { kind: "start" | "end" }
  | { kind: "sequence" | "choice"; children: Expression[] }
  | { kind: "repeat"; child: Expression; min: number; max: number };
type State =
  | { kind: "atom"; atom: number; next: number }
  | { kind: "start" | "end"; next: number }
  | { kind: "split"; left: number; right: number }
  | { kind: "accept" };
type Frontier = { active: number[]; accepting: boolean; edges: Map<string, Frontier> };

/** Null means unsupported syntax, malformed syntax, or excessive compilation work. */
export function compileCustomFieldPattern(pattern: string): { test(value: string): boolean | null } | null {
  if (pattern.length > MAX_PATTERN_LENGTH) return null;
  try {
    let cursor = 0;
    const atoms: Array<(character: string) => boolean> = [];
    const atomIds = new Map<string, number>();
    const invalid = (): never => { throw new Error("Unsupported custom-field pattern"); };
    const atom = (source: string, literal?: string): Expression => {
      let id = atomIds.get(source);
      if (id === undefined) {
        // source is exactly one atom: a literal, escape or character class.
        // Quantifiers and groups are interpreted only by the finite machine.
        const predicate = literal === undefined ? new RegExp(`^(?:${source})$`, "u") : null;
        id = atoms.length;
        atoms.push(predicate ? (character) => predicate.test(character) : (character) => character === literal);
        atomIds.set(source, id);
      }
      return { kind: "atom", atom: id };
    };
    const escape = (): string => {
      const start = cursor++;
      const kind = pattern[cursor++];
      if (kind === undefined || /[1-9bBk]/.test(kind)) invalid();
      if (kind === "p" || kind === "P" || (kind === "u" && pattern[cursor] === "{")) {
        if (pattern[cursor++] !== "{") invalid();
        while (cursor < pattern.length && pattern[cursor] !== "}") cursor++;
        if (pattern[cursor++] !== "}") invalid();
      } else if (kind === "u" || kind === "x") {
        const count = kind === "u" ? 4 : 2;
        const digits = pattern.slice(cursor, cursor + count);
        if (digits.length !== count || !/^[0-9a-f]+$/i.test(digits)) invalid();
        cursor += count;
      } else if (kind === "c") {
        if (!/[a-z]/i.test(pattern[cursor] ?? "")) invalid();
        cursor++;
      } else if (kind === "0" && /[0-9]/.test(pattern[cursor] ?? "")) invalid();
      return pattern.slice(start, cursor);
    };
    const number = (): number => {
      const start = cursor;
      while (/[0-9]/.test(pattern[cursor] ?? "")) cursor++;
      if (cursor === start) invalid();
      const value = Number(pattern.slice(start, cursor));
      if (value > MAX_REPEAT) invalid();
      return value;
    };
    const piece = (): Expression => {
      let child: Expression;
      const token = pattern[cursor];
      if (token === "(") {
        cursor++;
        if (pattern[cursor] === "?") {
          if (pattern.slice(cursor, cursor + 2) !== "?:") invalid();
          cursor += 2;
        }
        child = choice();
        if (pattern[cursor++] !== ")") invalid();
      } else if (token === "[") {
        const start = cursor++;
        while (cursor < pattern.length && pattern[cursor] !== "]") {
          if (pattern[cursor] === "\\") cursor++;
          cursor++;
        }
        if (pattern[cursor++] !== "]") invalid();
        child = atom(pattern.slice(start, cursor));
      } else if (token === "\\") {
        let source = escape();
        // Unicode mode treats adjacent escaped surrogate halves as one atom.
        if (/^\\u[dD][89ab][0-9a-f]{2}$/i.test(source) && /^\\u[dD][c-f][0-9a-f]{2}/i.test(pattern.slice(cursor))) source += escape();
        child = atom(source);
      } else if (token === "^" || token === "$") {
        cursor++;
        return { kind: token === "^" ? "start" : "end" };
      } else {
        if (token === undefined || "*+?{}])".includes(token)) invalid();
        const character = String.fromCodePoint(pattern.codePointAt(cursor)!);
        cursor += character.length;
        child = atom(character, character === "." ? undefined : character);
      }
      const quantifier = pattern[cursor];
      let min: number;
      let max: number;
      if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
        cursor++;
        min = quantifier === "+" ? 1 : 0;
        max = quantifier === "?" ? 1 : Infinity;
      } else if (quantifier === "{") {
        cursor++;
        min = number();
        max = min;
        if (pattern[cursor] === ",") {
          cursor++;
          max = pattern[cursor] === "}" ? Infinity : number();
        }
        if (pattern[cursor++] !== "}" || max < min) invalid();
      } else return child;
      if (pattern[cursor] === "?") cursor++; // Greediness does not change boolean membership.
      return { kind: "repeat", child, min, max };
    };
    const sequence = (): Expression => {
      const children: Expression[] = [];
      while (cursor < pattern.length && pattern[cursor] !== ")" && pattern[cursor] !== "|") children.push(piece());
      return { kind: "sequence", children };
    };
    const choice = (): Expression => {
      const children = [sequence()];
      while (pattern[cursor] === "|") { cursor++; children.push(sequence()); }
      return children.length === 1 ? children[0]! : { kind: "choice", children };
    };
    const expression = choice();
    if (cursor !== pattern.length) invalid();
    const states: State[] = [{ kind: "accept" }];
    const add = (state: State): number => {
      if (states.length >= MAX_STATES) invalid();
      states.push(state);
      return states.length - 1;
    };
    let expansions = 0;
    const emit = (node: Expression, next: number): number => {
      // Empty repeated expressions allocate no states, but still cost work.
      if (++expansions > MAX_STATES * 2) invalid();
      switch (node.kind) {
        case "atom": return add({ ...node, next });
        case "start": case "end": return add({ ...node, next });
        case "sequence": {
          for (let index = node.children.length - 1; index >= 0; index--) next = emit(node.children[index]!, next);
          return next;
        }
        case "choice": {
          let branch = emit(node.children[0]!, next);
          for (const child of node.children.slice(1)) branch = add({ kind: "split", left: branch, right: emit(child, next) });
          return branch;
        }
        case "repeat": {
          if (node.max === Infinity) {
            const split = add({ kind: "split", left: next, right: next });
            (states[split] as Extract<State, { kind: "split" }>).left = emit(node.child, split);
            next = split;
          } else {
            for (let count = node.min; count < node.max; count++) next = add({ kind: "split", left: emit(node.child, next), right: next });
          }
          for (let count = 0; count < node.min; count++) next = emit(node.child, next);
          return next;
        }
      }
    };
    const start = emit(expression, 0);
    const seen = new Uint32Array(states.length);
    let generation = 0;
    const frontiers = new Map<string, Frontier>();
    const characters = new Map<string, { matches: Uint8Array; signature: string }>();
    let cachedTransitions = 0;
    let work = 0;
    const exhausted = {};
    const spend = (count = 1) => { work += count; if (work > MAX_MATCH_WORK) throw exhausted; };
    const closure = (seeds: number[], atStart: boolean, atEnd: boolean): Frontier => {
      generation++;
      const active: number[] = [];
      const stack = seeds;
      let accepting = false;
      while (stack.length > 0) {
        spend();
        const index = stack.pop()!;
        if (seen[index] === generation) continue;
        seen[index] = generation;
        const state = states[index]!;
        if (state.kind === "split") stack.push(state.left, state.right);
        else if (state.kind === "start" || state.kind === "end") {
          if (state.kind === "start" ? atStart : atEnd) stack.push(state.next);
        } else if (state.kind === "accept") accepting = true;
        else active.push(index);
      }
      const frontier: Frontier = { active, accepting, edges: new Map() };
      if (frontiers.size >= MAX_CACHED_STATES) return frontier;
      spend(active.length * Math.ceil(Math.log2(active.length || 1)));
      active.sort((a, b) => a - b);
      const key = `${accepting ? 1 : 0}:${active.join(",")}`;
      const existing = frontiers.get(key);
      if (existing) return existing;
      frontiers.set(key, frontier);
      return frontier;
    };
    const initial = closure([start], true, false);
    const empty = closure([start], true, true).accepting;
    return {
      test(value) {
        try {
          spend(0);
          if (!value) return empty;
          let current = initial;
          let position = 0;
          for (const character of value) {
            spend();
            position += character.length;
            const last = position === value.length;
            let category = characters.get(character);
            if (!category) {
              spend(atoms.length);
              const matches = Uint8Array.from(atoms, (test) => test(character) ? 1 : 0);
              category = { matches, signature: String.fromCharCode(...matches) };
              if (characters.size < MAX_CACHED_CHARACTERS) characters.set(character, category);
            }
            const key = `${last ? 1 : 0}${category.signature}`;
            const cached = current.edges.get(key);
            if (cached) { current = cached; continue; }
            spend(current.active.length);
            const next: number[] = [];
            for (const index of current.active) {
              const state = states[index] as Extract<State, { kind: "atom" }>;
              if (category.matches[state.atom]) next.push(state.next);
            }
            if (next.length === 0) return false;
            const target = closure(next, false, last);
            if (cachedTransitions < MAX_CACHED_TRANSITIONS) { current.edges.set(key, target); cachedTransitions++; }
            current = target;
          }
          return current.accepting;
        } catch (error) {
          if (error === exhausted) return null;
          throw error;
        }
      },
    };
  } catch {
    return null;
  }
}
