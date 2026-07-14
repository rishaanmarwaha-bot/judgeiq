import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BallotRecord {
  competitor_id: string;
  competitor_name: string;
  division: string;
  judge_name: string;
  score: number;
}

interface Entry {
  competitor_id: string;
  competitor_name: string;
  division: string;
  judge_scores: Record<string, number[]>;
}

interface DivisionJudgeStat {
  Severity_Rank: number;
  Judge_ID: string;
  Judge_Full_Name: string;
  Number_of_Scores: number;
  Mean: number;
  Z_Severity_Index: number;
  Absolute_Severity: number;
  Bias_Direction: "High-Side" | "Low-Side";
  Mann_Whitney_U: number | null;
  p_value: number | null;
  mw_na_reason: string | null;
}

interface DivisionSummary {
  mean: number;
  std: number;
  total_judges: number;
  total_scores: number;
  histogram: { bin_center: number; count: number }[];
}

interface Summary {
  total_competitors: number;
  total_judges: number;
  divisions: string[];
  judge_names: string[];
  most_generous_judge: string | null;
  most_strict_judge: string | null;
  most_consistent_judge: string | null;
  least_consistent_judge: string | null;
}

interface FormatInfo {
  format: string;
  label: string;
  tournament_name?: string;
  tournament_names?: string[];
  judge_count?: number;
  division_count?: number;
  divisions?: string[];
  total_ballots?: number;
  entry_count?: number;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[], ddof = 1): number {
  if (arr.length <= ddof) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - ddof));
}

function r(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/** Normal CDF — Abramowitz & Stegun approximation, error < 7.5e-8 */
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

/** Mann-Whitney U statistic + two-sided p-value via normal approximation */
function mannWhitneyU(
  a: number[],
  b: number[]
): { U: number; p: number; reason: null } | { U: null; p: null; reason: string } {
  if (a.length < 2)
    return { U: null, p: null, reason: `judge has only ${a.length} score${a.length === 1 ? "" : "s"} (min 2 required)` };
  if (b.length < 2)
    return { U: null, p: null, reason: "comparison pool too small (min 2 required)" };
  if (a.length * b.length > 50_000)
    return { U: null, p: null, reason: "dataset too large for pairwise computation" };

  let U = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) U += 1;
      else if (x === y) U += 0.5;
    }
  }

  const n1 = a.length;
  const n2 = b.length;
  const muU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  if (sigmaU === 0) return { U: null, p: null, reason: "all scores are identical (zero variance)" };

  const z = (U - muU) / sigmaU;
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  return { U: r(U, 1), p, reason: null };
}

function formatPValue(p: number | null): string {
  if (p === null || p === undefined) return "N/A";
  // Match Python format: "3.41E-04"
  const s = p.toExponential(2).toUpperCase();
  return s.replace(/E\+0*(\d)/, "E+$1").replace(/E-0*(\d)/, "E-$1");
}

// ─── Tabroom JSON Parsing ─────────────────────────────────────────────────────

function isTabroom(obj: unknown): boolean {
  return (
    typeof obj === "object" &&
    obj !== null &&
    !Array.isArray(obj) &&
    ("categories" in obj || "judges" in obj)
  );
}

function buildJudgeMap(list: unknown[]): {
  jmap: Record<string, string>;
  jidMap: Record<string, string>;
} {
  const jmap: Record<string, string> = {};
  const jidMap: Record<string, string> = {};
  for (const j of list ?? []) {
    if (typeof j !== "object" || j === null) continue;
    const o = j as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const name = `${o.first ?? ""} ${o.last ?? ""}`.trim();
    if (id && name) {
      jmap[id] = name;
      jidMap[name] = id;
    }
  }
  return { jmap, jidMap };
}

function aggregateBallots(records: BallotRecord[]): Entry[] {
  const compInfo: Record<string, { name: string; division: string }> = {};
  const byCompJudge: Record<string, number[]> = {};

  for (const r of records) {
    if (!compInfo[r.competitor_id]) {
      compInfo[r.competitor_id] = { name: r.competitor_name, division: r.division };
    }
    const k = `${r.competitor_id}|||${r.judge_name}`;
    (byCompJudge[k] ??= []).push(r.score);
  }

  return Object.entries(compInfo).map(([cid, info]) => {
    const judge_scores: Record<string, number[]> = {};
    for (const [k, scores] of Object.entries(byCompJudge)) {
      const [c, j] = k.split("|||");
      if (c === cid) judge_scores[j] = scores;
    }
    return { competitor_id: cid, competitor_name: info.name, division: info.division, judge_scores };
  });
}

function parseTournament(data: Record<string, unknown>): {
  entries: Entry[];
  meta: { tournament_name: string; judge_count: number; divisions: string[]; total_ballots: number };
  judgeIdMap: Record<string, string>;
} {
  const { jmap: topJmap, jidMap } = buildJudgeMap((data.judges as unknown[]) ?? []);
  const ballots: BallotRecord[] = [];
  const divsSeen: string[] = [];

  for (const cat of (data.categories as unknown[]) ?? []) {
    if (typeof cat !== "object" || cat === null) continue;
    const c = cat as Record<string, unknown>;
    const divName = String(c.name ?? c.abbr ?? "Unknown").trim();

    const { jmap: catJmap } = buildJudgeMap((c.judges as unknown[]) ?? []);
    const mergedJmap = { ...catJmap, ...topJmap }; // top-level takes precedence

    // Collect rounds, tagging each with its event name. Analytics group by
    // EVENT (e.g. "Dramatic Interp", "Lincoln Douglas") rather than by the
    // broad category (e.g. "Speech", "Debate"), because different events use
    // different point scales (speech ~50-100, debate ~20-30, POI its own
    // range). Pooling events with different scales makes judges on one scale
    // look like severe outliers purely from the scale gap — a false bias
    // signal. Comparing judges only within the same event fixes this.
    const roundsWithEvent: { round: unknown; eventName: string }[] = [];
    for (const ev of (c.events as unknown[]) ?? []) {
      const evObj = ev as Record<string, unknown>;
      const evName = String(evObj.name ?? evObj.abbr ?? divName).trim();
      for (const rnd of (evObj.rounds as unknown[]) ?? []) {
        roundsWithEvent.push({ round: rnd, eventName: evName });
      }
    }
    if (roundsWithEvent.length === 0) {
      for (const rnd of (c.rounds as unknown[]) ?? []) {
        roundsWithEvent.push({ round: rnd, eventName: divName });
      }
    }

    const divsHad = new Set<string>();
    for (const { round: rnd, eventName } of roundsWithEvent) {
      const sections = ((rnd as Record<string, unknown>).sections ??
        (rnd as Record<string, unknown>).panels ??
        []) as unknown[];

      for (const sec of sections) {
        for (const ballot of ((sec as Record<string, unknown>).ballots as unknown[]) ?? []) {
          const b = ballot as Record<string, unknown>;
          if (b.bye || b.forfeit) continue;

          // Judge lookup — fall back to the raw ID when no roster name exists.
          // Some Tabroom exports (e.g. single-round exports) omit the judges
          // roster entirely; the ballot then carries only a bare judge ID.
          // Analytics key on this label, so "Judge 2751055" works fine as an
          // identity when no name is available.
          const judgeId =
            typeof b.judge === "object" && b.judge !== null
              ? String((b.judge as Record<string, unknown>).id ?? "").trim()
              : String(b.judge ?? "").trim();
          if (!judgeId) continue; // no judge at all → unscoreable
          const judgeName = mergedJmap[judgeId] ?? `Judge ${judgeId}`;

          // Competitor
          const compRaw = b.competitor ?? b.entry;
          let compId: string, compName: string;
          if (typeof compRaw === "object" && compRaw !== null) {
            const co = compRaw as Record<string, unknown>;
            compId = String(co.id ?? "");
            compName = String(co.name ?? co.code ?? compId);
          } else if (compRaw != null) {
            compId = String(compRaw);
            compName = compId;
          } else {
            compId = String(b.entry_id ?? "");
            compName = compId;
          }

          // Collect each speaker-point score as its own data point
          const pts: number[] = [];
          for (const s of (b.scores as unknown[]) ?? []) {
            if (typeof s !== "object" || s === null) continue;
            const so = s as Record<string, unknown>;
            if (so.tag === "point") {
              const v = parseFloat(String(so.value));
              if (!isNaN(v)) pts.push(v);
            }
          }
          if (pts.length === 0 || pts.every((v) => v === 0)) continue;

          divsHad.add(eventName);
          for (const pt of pts) {
            ballots.push({
              competitor_id: compId,
              competitor_name: compName,
              division: eventName,
              judge_name: judgeName,
              score: pt,
            });
          }
        }
      }
    }
    for (const d of Array.from(divsHad)) {
      if (!divsSeen.includes(d)) divsSeen.push(d);
    }
  }

  const entries = aggregateBallots(ballots);
  const allJudges = new Set<string>();
  entries.forEach((e) => Object.keys(e.judge_scores).forEach((j) => allJudges.add(j)));

  return {
    entries,
    meta: {
      tournament_name: String(data.name ?? "Unknown Tournament"),
      judge_count: allJudges.size,
      divisions: divsSeen,
      total_ballots: ballots.length,
    },
    judgeIdMap: jidMap,
  };
}

function loadData(json: unknown): {
  entries: Entry[];
  formatInfo: FormatInfo;
  judgeIdMap: Record<string, string>;
} {
  // Single Tabroom tournament
  if (isTabroom(json)) {
    const { entries, meta, judgeIdMap } = parseTournament(json as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error(
        `Tabroom tournament detected but no scorable ballots found. Ensure rounds have speaker point scores (tag='point') that are not byes or forfeits.`
      );
    }
    return {
      entries,
      judgeIdMap,
      formatInfo: {
        format: "tabroom",
        label: `Tabroom tournament detected: ${meta.tournament_name}`,
        tournament_name: meta.tournament_name,
        judge_count: meta.judge_count,
        division_count: meta.divisions.length,
        divisions: meta.divisions,
        total_ballots: meta.total_ballots,
      },
    };
  }

  // Multi-tournament array
  if (Array.isArray(json) && json.length > 0 && json.every((d) => isTabroom(d))) {
    let allEntries: Entry[] = [];
    const allDivisions: string[] = [];
    const allJudgeIdMap: Record<string, string> = {};
    let totalBallots = 0;
    const names: string[] = [];

    for (const t of json) {
      const { entries, meta, judgeIdMap } = parseTournament(t as Record<string, unknown>);
      allEntries = allEntries.concat(entries);
      totalBallots += meta.total_ballots;
      names.push(meta.tournament_name);
      Object.assign(allJudgeIdMap, judgeIdMap);
      for (const d of meta.divisions) {
        if (!allDivisions.includes(d)) allDivisions.push(d);
      }
    }

    if (allEntries.length === 0)
      throw new Error("Multi-tournament Tabroom export detected but no scorable ballots found.");

    const allJudges = new Set<string>();
    allEntries.forEach((e) => Object.keys(e.judge_scores).forEach((j) => allJudges.add(j)));

    const namesStr =
      names.slice(0, 3).join(", ") + (names.length > 3 ? ` (+${names.length - 3} more)` : "");

    return {
      entries: allEntries,
      judgeIdMap: allJudgeIdMap,
      formatInfo: {
        format: "tabroom_multi",
        label: `Multi-tournament Tabroom export: ${namesStr}`,
        tournament_names: names,
        judge_count: allJudges.size,
        division_count: allDivisions.length,
        divisions: allDivisions,
        total_ballots: totalBallots,
      },
    };
  }

  // Legacy array with judge_scores
  if (
    Array.isArray(json) &&
    json.length > 0 &&
    json.every((d) => typeof d === "object" && d !== null && "judge_scores" in d)
  ) {
    const entries = (json as Record<string, unknown>[]).map((d) => {
      const js = (d as { judge_scores?: Record<string, unknown> }).judge_scores ?? {};
      return {
        ...d,
        judge_scores: Object.fromEntries(
          Object.entries(js).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])
        ),
      } as Entry;
    });
    const allJudges = new Set<string>();
    entries.forEach((e) => Object.keys(e.judge_scores ?? {}).forEach((j) => allJudges.add(j)));
    return {
      entries,
      judgeIdMap: {},
      formatInfo: {
        format: "legacy_array",
        label: `Custom format detected — found ${allJudges.size} judges with scoring data`,
        judge_count: allJudges.size,
        entry_count: entries.length,
      },
    };
  }

  throw new Error(
    "Could not extract scoring data from this JSON. Supported formats: Tabroom tournament export (object with 'categories'/'judges'), Tabroom multi-tournament array, or an array of objects with a 'judge_scores' key."
  );
}

// ─── Analytics ────────────────────────────────────────────────────────────────

function extractJudgeNames(entries: Entry[]): string[] {
  const names = new Set<string>();
  entries.forEach((e) => Object.keys(e.judge_scores).forEach((j) => names.add(j)));
  return Array.from(names).sort();
}

function computeDivisionJudgeStats(
  entries: Entry[],
  judges: string[],
  judgeIdMap: Record<string, string>
): DivisionJudgeStat[] {
  // Build per-judge score arrays (flatten individual speaker point scores)
  const judgeScores: Record<string, number[]> = {};
  for (const judge of judges) {
    const scores = entries.flatMap((e) => e.judge_scores[judge] ?? []);
    if (scores.length > 0) judgeScores[judge] = scores;
  }

  const validJudges = Object.keys(judgeScores);
  if (validJudges.length < 2) return [];

  const judgeMeans = Object.fromEntries(validJudges.map((j) => [j, avg(judgeScores[j])]));
  const meansArr = Object.values(judgeMeans);
  const meanOfMeans = avg(meansArr);
  const stdOfMeans = stdDev(meansArr, 1);

  const records = validJudges.map((judge) => {
    const scores = judgeScores[judge];
    const meanScore = judgeMeans[judge];
    const zSeverity = stdOfMeans > 0 ? (meanScore - meanOfMeans) / stdOfMeans : 0;
    const absSeverity = Math.abs(zSeverity);

    // Pool all other judges' scores for Mann-Whitney
    const otherScores: number[] = [];
    for (const [j2, sc] of Object.entries(judgeScores)) {
      if (j2 !== judge) otherScores.push(...sc);
    }

    const mw = mannWhitneyU(scores, otherScores);

    return {
      Judge_ID: judgeIdMap[judge] ?? "",
      Judge_Full_Name: judge,
      Number_of_Scores: scores.length,
      Mean: r(meanScore, 2),
      Z_Severity_Index: r(zSeverity, 4),
      Absolute_Severity: r(absSeverity, 4),
      Bias_Direction: (zSeverity >= 0 ? "High-Side" : "Low-Side") as "High-Side" | "Low-Side",
      Mann_Whitney_U: mw.U,
      p_value: mw.p,
      mw_na_reason: mw.reason,
    };
  });

  records.sort((a, b) => b.Absolute_Severity - a.Absolute_Severity);
  return records.map((rec, i) => ({ Severity_Rank: i + 1, ...rec }));
}

function computeDivisionSummary(entries: Entry[], judges: string[]): DivisionSummary {
  const allScores: number[] = [];
  const activeJudges: string[] = [];

  for (const judge of judges) {
    const scores = entries.flatMap((e) => e.judge_scores[judge] ?? []);
    if (scores.length > 0) {
      allScores.push(...scores);
      activeJudges.push(judge);
    }
  }

  if (allScores.length === 0) return { mean: 0, std: 0, total_judges: 0, total_scores: 0, histogram: [] };

  const m = r(avg(allScores), 3);
  const s = r(stdDev(allScores, 1), 3);

  const histogram: { bin_center: number; count: number }[] = [];
  if (s > 0 && allScores.length >= 4) {
    const nBins = Math.min(20, Math.max(8, Math.floor(Math.sqrt(allScores.length))));
    const minVal = Math.min(...allScores);
    const maxVal = Math.max(...allScores);
    const binWidth = (maxVal - minVal) / nBins;
    if (binWidth > 0) {
      const counts = new Array<number>(nBins).fill(0);
      for (const v of allScores) {
        const idx = Math.min(Math.floor((v - minVal) / binWidth), nBins - 1);
        counts[idx]++;
      }
      for (let i = 0; i < nBins; i++) {
        histogram.push({ bin_center: r(minVal + (i + 0.5) * binWidth, 2), count: counts[i] });
      }
    }
  }

  return { mean: m, std: s, total_judges: activeJudges.length, total_scores: allScores.length, histogram };
}

function buildSummary(
  entries: Entry[],
  judges: string[],
  divisionStats: Record<string, DivisionJudgeStat[]>
): Summary {
  const allRows = Object.values(divisionStats).flat();
  const divisions = Array.from(new Set(entries.map((e) => e.division).filter(Boolean)));

  const pick = (cmp: (a: DivisionJudgeStat, b: DivisionJudgeStat) => number): string | null =>
    allRows.length === 0 ? null : [...allRows].sort(cmp)[0].Judge_Full_Name;

  return {
    total_competitors: entries.length,
    total_judges: judges.length,
    divisions,
    judge_names: judges,
    most_generous_judge: pick((a, b) => b.Z_Severity_Index - a.Z_Severity_Index),
    most_strict_judge: pick((a, b) => a.Z_Severity_Index - b.Z_Severity_Index),
    most_consistent_judge: pick((a, b) => a.Absolute_Severity - b.Absolute_Severity),
    least_consistent_judge: pick((a, b) => b.Absolute_Severity - a.Absolute_Severity),
  };
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

const STAT_COLS: (keyof DivisionJudgeStat)[] = [
  "Severity_Rank", "Judge_ID", "Judge_Full_Name", "Number_of_Scores",
  "Mean", "Z_Severity_Index", "Absolute_Severity", "Bias_Direction",
  "Mann_Whitney_U", "p_value", "mw_na_reason",
];

function exportExcel(divisionStats: Record<string, DivisionJudgeStat[]>): Buffer {
  const wb = XLSX.utils.book_new();

  for (const [divName, rows] of Object.entries(divisionStats)) {
    const sheetName = divName.slice(0, 31);

    if (rows.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([[`No data for division: ${divName}`]]);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      continue;
    }

    const header = STAT_COLS.map(String);
    const dataRows = rows.map((row) =>
      STAT_COLS.map((col) => {
        const v = row[col];
        if (col === "p_value") return formatPValue(v as number | null);
        if (col === "mw_na_reason") return v ? `N/A — ${v}` : "";
        if (col === "Mann_Whitney_U" && v === null) return `N/A — ${row.mw_na_reason ?? "unknown"}`;
        if (v === null || v === undefined) return "N/A";
        return v;
      })
    );

    const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);

    // Column widths
    ws["!cols"] = STAT_COLS.map((col) => ({
      wch: Math.max(String(col).length, ...rows.map((r) => String(r[col] ?? "N/A").length)) + 4,
    }));

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "No file uploaded. Please attach a JSON file with the field name 'file'." },
        { status: 400 }
      );
    }

    const blob = file as Blob;
    const filename = (file as File).name ?? "input.json";

    if (!filename.endsWith(".json")) {
      return NextResponse.json(
        { error: "Uploaded file must be a JSON file (.json extension)." },
        { status: 400 }
      );
    }

    if (blob.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File size exceeds the 10 MB limit." }, { status: 400 });
    }

    // Parse JSON (try UTF-8, fall back to latin-1 for Tabroom exports)
    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(fileBuffer.toString("utf-8"));
    } catch {
      try {
        parsedInput = JSON.parse(fileBuffer.toString("latin1"));
      } catch {
        return NextResponse.json(
          { error: "Uploaded file is not valid JSON. Please check the file and try again." },
          { status: 400 }
        );
      }
    }

    // Load & parse data
    let entries: Entry[], formatInfo: FormatInfo, judgeIdMap: Record<string, string>;
    try {
      ({ entries, formatInfo, judgeIdMap } = loadData(parsedInput));
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    const judges = extractJudgeNames(entries);
    const divisions = Array.from(new Set(entries.map((e) => e.division).filter(Boolean)));

    // Per-division stats
    const divisionStats: Record<string, DivisionJudgeStat[]> = {};
    const divisionSummary: Record<string, DivisionSummary> = {};

    for (const div of divisions) {
      const divEntries = entries.filter((e) => e.division === div);
      const divJudges = judges.filter((j) => divEntries.some((e) => (e.judge_scores[j]?.length ?? 0) > 0));
      divisionStats[div] = computeDivisionJudgeStats(divEntries, divJudges, judgeIdMap);
      divisionSummary[div] = computeDivisionSummary(divEntries, divJudges);
    }

    const summary = buildSummary(entries, judges, divisionStats);
    const excelBase64 = exportExcel(divisionStats).toString("base64");

    return NextResponse.json({
      format_info: formatInfo,
      summary,
      division_stats: divisionStats,
      division_summary: divisionSummary,
      excel_base64: excelBase64,
    });
  } catch (err: unknown) {
    console.error("[JudgeIQ] Unexpected error:", err);
    return NextResponse.json(
      { error: (err as Error)?.message ?? "An unexpected server error occurred." },
      { status: 500 }
    );
  }
}

/** GET /api/analyze — health check */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "JudgeIQ Judging Analytics API",
    version: "2.0.0",
    engine: "TypeScript (no Python dependency)",
  });
}
