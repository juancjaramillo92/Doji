/* The swap a quitting app leaves behind, pure so laptop.test.mjs runs it.

   It waits for the app to go, unpacks the new one beside it, and puts it in
   its place — the old one set aside first and put back if the new one cannot
   take it, so a failed update leaves the app it found, never none. Then it
   opens whichever is there.

   The new one takes the old one's place only signed by the same signer, as
   the old one names it: downloaded by the app, the update carries no
   quarantine, so nothing else on the Mac would ever check who made it. A
   build signed by any other — the kept certificate lost, or a stranger's —
   is refused, and installed by hand. Every path is quoted for the shell: a bundle can
   live under a name with a space or an apostrophe in it. */
export const BUNDLE = 'Eugenia.app';

const quoted = (path) => `'${path.replaceAll("'", `'\\''`)}'`;

export function swapScript(pid, zip, unpacked, bundle) {
  const [z, u, b, old, fresh] = [zip, unpacked, bundle, `${bundle}.old`, `${unpacked}/${BUNDLE}`].map(quoted);
  return [
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done`,
    `rm -rf ${u}`,
    `signer=$(codesign -d -r- ${b} 2>/dev/null | sed -n 's/^designated => //p')`,
    `if ditto -x -k ${z} ${u} && [ -n "$signer" ] && codesign --verify --deep --strict -R="$signer" ${fresh}; then`,
    `  rm -rf ${old}`,
    `  if mv ${b} ${old}; then`,
    `    if mv ${fresh} ${b}; then rm -rf ${old}; else mv ${old} ${b}; fi`,
    `  fi`,
    `fi`,
    `open ${b}`,
  ].join('\n');
}
