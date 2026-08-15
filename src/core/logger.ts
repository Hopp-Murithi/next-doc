import pc from "picocolors";

/**
 * Output helpers. Everything degrades to plain ASCII when stdout is not a TTY
 * or when NO_COLOR / --no-color is set, because CI logs are a first class target.
 */

let colorEnabled = pc.isColorSupported;
let unicodeEnabled = process.platform !== "win32" || Boolean(process.env.WT_SESSION);

export function configureOutput(opts: { color?: boolean; unicode?: boolean }): void {
  if (opts.color !== undefined) colorEnabled = opts.color;
  if (opts.unicode !== undefined) unicodeEnabled = opts.unicode;
}

function paint(fn: (s: string) => string, s: string): string {
  return colorEnabled ? fn(s) : s;
}

export const c = {
  red: (s: string) => paint(pc.red, s),
  green: (s: string) => paint(pc.green, s),
  yellow: (s: string) => paint(pc.yellow, s),
  cyan: (s: string) => paint(pc.cyan, s),
  dim: (s: string) => paint(pc.dim, s),
  bold: (s: string) => paint(pc.bold, s),
  magenta: (s: string) => paint(pc.magenta, s),
};

export const icons = {
  get pass() {
    return unicodeEnabled ? "✓" : "+";
  },
  get warn() {
    return unicodeEnabled ? "△" : "!";
  },
  get fail() {
    return unicodeEnabled ? "✗" : "x";
  },
  get bullet() {
    return unicodeEnabled ? "•" : "-";
  },
};

export const out = {
  write(line = ""): void {
    process.stdout.write(`${line}\n`);
  },
  error(line: string): void {
    process.stderr.write(`${line}\n`);
  },
};

/** A dependency free spinner. Silent in non-TTY environments. */
export function spinner(text: string) {
  const frames = unicodeEnabled
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["-", "\\", "|", "/"];
  const active = process.stdout.isTTY && !process.env.CI;
  let i = 0;
  let timer: NodeJS.Timeout | null = null;

  if (active) {
    timer = setInterval(() => {
      process.stdout.write(`\r${c.cyan(frames[i++ % frames.length]!)} ${text}`);
    }, 80);
    timer.unref?.();
  }

  return {
    stop(): void {
      if (timer) {
        clearInterval(timer);
        process.stdout.write(`\r${" ".repeat(text.length + 4)}\r`);
      }
    },
  };
}
