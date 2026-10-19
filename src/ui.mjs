// Terminal output helpers. Respects NO_COLOR and non-TTY output.

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const wrap = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  cyan: wrap("36"),
};

export function out(text = "") {
  process.stdout.write(`${text}\n`);
}

export function err(text = "") {
  process.stderr.write(`${text}\n`);
}
