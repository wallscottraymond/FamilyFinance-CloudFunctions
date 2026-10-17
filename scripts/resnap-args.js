/**
 * Argument parsing for `resnap-period-suppression.js` (round 4 defect 4). Kept separate so it is
 * unit-tested without touching Firestore. `--user` MUST be followed by a uid: a bare `--user`
 * (or `--user --write`) is an error — never silently "all users".
 */
function parse_resnap_args(argv) {
  const out = { write: false, user: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") out.write = true;
    else if (a === "--user") {
      const v = argv[i + 1];
      if (v === undefined || v === "" || v.startsWith("--")) {
        throw new Error("--user needs a user id (e.g. --user abc123); refusing to run for all users");
      }
      out.user = v;
      i++;
    } else if (a.startsWith("--user=")) {
      const v = a.slice("--user=".length);
      if (!v) throw new Error("--user needs a user id (e.g. --user abc123); refusing to run for all users");
      out.user = v;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

module.exports = { parse_resnap_args };
