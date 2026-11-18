// Launch Radar's entry program (Node 22, standard library only).
//
// It reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// launch candidate with the model in lib/model.ts, writes the ranked board to /output/board.json,
// writes the dashboard's data to /output/data.js, copies this repository's dashboard/ and
// screenshots/ into /output, and finishes by writing /output/dossier.json with the vendored
// make.fun library, so the dossier is byte for byte what the scorer rebuilds from the same files.
//
// The board it writes is checked against the gate's shape before anything is copied: a board the
// gate would refuse stops the program with the reason, rather than handing in an invalid entry.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the scorer states them: only the text cap shapes bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of --name in the arguments (either form), or the fallback when it is absent. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const glued = process.argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

/** Stop with a reason on stderr and a nonzero exit, the way the harness expects a refusal. */
function refuse(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) refuse(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one flat directory's regular files into `to`, skipping names that start with a dot. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length === 0) refuse('dashboard/ is empty: the page is what the judge reads');
const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  refuse(`screenshots/ holds ${shots.length} images: hand in 3 or 4, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) refuse(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last, from the finished output, so it describes exactly what was handed in.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows ranked (${radar.early_size} beyond the watchlist), ${radar.live_size} live-token and ${radar.product_size} product rows set aside\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json in ${out}\n`,
);
