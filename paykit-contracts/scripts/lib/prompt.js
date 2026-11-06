// Tiny terminal prompts. Private keys are read with hidden input (nothing is echoed).
const readline = require("readline");
const { ethers } = require("ethers");

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (s === "\r\n" || s === "\n" || s === "\r") rl.output.write("\n");
        else rl.output.write("*");
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

/** Ask for a PUBLIC address (0x… 40 hex chars). Empty input returns `fallback` if given. */
async function askAddress(label, fallback) {
  for (;;) {
    const hint = fallback ? ` [Enter = ${fallback}]` : "";
    const a = await ask(`${label}\n  -> PUBLIC address (0x…, 42 chars)${hint}: `);
    if (!a && fallback) return ethers.getAddress(fallback);
    if (ethers.isAddress(a)) return ethers.getAddress(a);
    console.log("  ✗ That is not a valid public address. Try again.");
  }
}

/** Ask for a PRIVATE key (64 hex chars, 0x optional). Input is hidden. Returns an ethers.Wallet. */
async function askPrivateKey(label, provider) {
  for (;;) {
    let k = await ask(`${label}\n  -> PRIVATE key (64 hex chars, input hidden): `, { hidden: true });
    if (k && !k.startsWith("0x")) k = "0x" + k;
    try {
      if (ethers.isAddress(k)) throw new Error("public");
      const w = new ethers.Wallet(k, provider);
      console.log(`  ✓ key accepted for ${w.address}`);
      return w;
    } catch (e) {
      console.log(
        e.message === "public"
          ? "  ✗ You pasted a PUBLIC address. This step needs the PRIVATE key because this wallet must sign."
          : "  ✗ Not a valid private key. Try again."
      );
    }
  }
}

/** Ask for a decimal amount, e.g. "2.5". */
async function askAmount(label, fallback) {
  for (;;) {
    const a = await ask(`${label} [Enter = ${fallback}]: `);
    const v = a || fallback;
    if (/^\d+(\.\d+)?$/.test(v) && Number(v) > 0) return v;
    console.log("  ✗ Enter a positive number like 2 or 2.5");
  }
}

module.exports = { ask, askAddress, askPrivateKey, askAmount };
