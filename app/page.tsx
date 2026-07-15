"use client";

import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  ComposedChart,
  Area,
  Scatter,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Legend,
} from "recharts";

// ─── Color tokens ────────────────────────────────────────────────────────────

const C = {
  navy: "#0F1B2D",
  navyCard: "#162032",
  navyBorder: "#243550",
  navyHover: "#1E2F47",
  gold: "#C9A84C",
  goldDim: "rgba(201,168,76,0.12)",
  red: "#E8524A",
  redDim: "rgba(232,82,74,0.12)",
  blue: "#4A8FE8",
  blueDim: "rgba(74,143,232,0.12)",
  yellow: "#F5C842",
  green: "#4AE88A",
  textPrimary: "#FFFFFF",
  textSecondary: "#8BA7C7",
  textMuted: "#4A6380",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface DivisionJudgeStat {
  Severity_Rank: number;
  Judge_ID: string | number;
  Judge_Full_Name: string;
  Number_of_Scores: number;
  Mean: number;
  Score_StdDev: number | null;
  Consistency_Ratio: number | null;
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
  format: "tabroom" | "tabroom_multi" | "legacy_array" | "unknown";
  label: string;
  tournament_name?: string;
  tournament_names?: string[];
  judge_count?: number;
  division_count?: number;
  divisions?: string[];
  total_ballots?: number;
  entry_count?: number;
}

type SeverityLevel = "critical" | "high" | "moderate" | "watch" | "normal";

interface RecommendedAction {
  type: "normalization" | "placement" | "monitoring" | "feedback";
  title: string;
  detail: string;
}

interface JudgeRecommendation {
  judge_name: string;
  division: string;
  severity_level: SeverityLevel;
  headline: string;
  small_sample: boolean;
  statistically_significant: boolean;
  suggested_adjustment: number | null;
  erratic: boolean;
  actions: RecommendedAction[];
  feedback_note: string | null;
}

interface AnalysisResult {
  format_info: FormatInfo;
  summary: Summary;
  division_stats: Record<string, DivisionJudgeStat[]>;
  division_summary: Record<string, DivisionSummary>;
  recommendations?: Record<string, JudgeRecommendation[]>;
  excel_base64: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalPDF(x: number, mean: number, std: number): number {
  if (std === 0) return 0;
  return (
    (1 / (std * Math.sqrt(2 * Math.PI))) *
    Math.exp(-0.5 * Math.pow((x - mean) / std, 2))
  );
}

function formatPValue(val: number | null): string {
  if (val === null || val === undefined) return "N/A";
  return val.toExponential(2).toUpperCase().replace("E+0", "E+").replace("E-0", "E-");
}

function rowSeverityBg(abs: number): string {
  if (abs > 1.5) return "rgba(232,82,74,0.13)";
  if (abs > 1.0) return "rgba(245,200,66,0.10)";
  return "transparent";
}

function rowSeverityBorder(abs: number): string {
  if (abs > 1.5) return `1px solid rgba(232,82,74,0.25)`;
  if (abs > 1.0) return `1px solid rgba(245,200,66,0.20)`;
  return `1px solid ${C.navyBorder}`;
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: C.navyCard,
        border: `1px solid ${C.navyBorder}`,
        borderRadius: 12,
        padding: "12px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 120,
      }}
    >
      <span style={{ color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ color: accent || C.gold, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {value}
      </span>
    </div>
  );
}

// ─── Division Toggle ──────────────────────────────────────────────────────────

function DivisionToggle({
  divisions,
  active,
  onChange,
}: {
  divisions: string[];
  active: string;
  onChange: (div: string) => void;
}) {
  const options = divisions.length > 1 ? ["all", ...divisions] : divisions;
  return (
    <div style={{ display: "flex", gap: 8, padding: "4px", background: C.navyCard, border: `1px solid ${C.navyBorder}`, borderRadius: 50, width: "fit-content", flexWrap: "wrap" }}>
      {options.map((div) => {
        const isActive = div === active;
        return (
          <button
            key={div}
            onClick={() => onChange(div)}
            style={{
              padding: "8px 22px",
              borderRadius: 50,
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              transition: "all 0.2s",
              background: isActive ? C.gold : "transparent",
              color: isActive ? C.navy : C.textSecondary,
            }}
          >
            {div === "all" ? "All Divisions" : div}
          </button>
        );
      })}
    </div>
  );
}

// ─── Extreme Judge Cards ──────────────────────────────────────────────────────

type TaggedRow = DivisionJudgeStat & { _div?: string };

function ExtremeJudgeCards({ rows }: { rows: TaggedRow[] }) {
  const top5 = [...rows]
    .sort((a, b) => b.Absolute_Severity - a.Absolute_Severity)
    .slice(0, 5);

  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
      {top5.map((j, idx) => {
        const isHigh = j.Bias_Direction === "High-Side";
        const borderColor = isHigh ? C.red : C.blue;
        const bgColor = isHigh ? C.redDim : C.blueDim;
        return (
          <div
            key={`${j.Judge_Full_Name}-${j._div}`}
            style={{
              background: bgColor,
              border: `2px solid ${borderColor}`,
              borderRadius: 14,
              padding: "16px 20px",
              minWidth: 180,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <span style={{ position: "absolute", top: 12, right: 14, fontSize: 11, fontWeight: 700, color: C.textMuted }}>
              #{idx + 1}
            </span>
            <p style={{ color: C.textPrimary, fontWeight: 700, fontSize: 14, lineHeight: 1.3, paddingRight: 24 }}>
              {j.Judge_Full_Name}
            </p>
            {j._div && (
              <span style={{ fontSize: 10, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {j._div}
              </span>
            )}
            <p style={{ color: C.textSecondary, fontSize: 12 }}>
              Mean: <span style={{ color: C.textPrimary, fontWeight: 600, fontFamily: "monospace" }}>{j.Mean.toFixed(2)}</span>
            </p>
            <p style={{ color: C.textSecondary, fontSize: 12 }}>
              Z:{" "}
              <span style={{ color: isHigh ? C.red : C.blue, fontWeight: 700, fontFamily: "monospace" }}>
                {j.Z_Severity_Index > 0 ? "+" : ""}{j.Z_Severity_Index.toFixed(3)}
              </span>
            </p>
            <span
              style={{
                display: "inline-block",
                padding: "3px 10px",
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 700,
                background: isHigh ? "rgba(232,82,74,0.2)" : "rgba(74,143,232,0.2)",
                color: borderColor,
                width: "fit-content",
              }}
            >
              {j.Bias_Direction}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Recommendations Panel ────────────────────────────────────────────────────

const SEV_META: Record<SeverityLevel, { label: string; color: string; dim: string }> = {
  critical: { label: "Critical", color: "#E8524A", dim: "rgba(232,82,74,0.12)" },
  high: { label: "High", color: "#F0842C", dim: "rgba(240,132,44,0.12)" },
  moderate: { label: "Moderate", color: "#F5C842", dim: "rgba(245,200,66,0.10)" },
  watch: { label: "Watch", color: "#4A8FE8", dim: "rgba(74,143,232,0.12)" },
  normal: { label: "Cleared", color: "#4AE88A", dim: "rgba(74,232,138,0.08)" },
};

const ACTION_META: Record<RecommendedAction["type"], { icon: string; label: string }> = {
  monitoring: { icon: "👁", label: "Monitoring" },
  normalization: { icon: "🎚", label: "Score Normalization" },
  placement: { icon: "🧭", label: "Round Placement" },
  feedback: { icon: "✉️", label: "Judge Feedback" },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard unavailable */
        }
      }}
      style={{
        background: copied ? "rgba(74,232,138,0.15)" : "rgba(255,255,255,0.06)",
        border: `1px solid ${copied ? "rgba(74,232,138,0.4)" : C.navyBorder}`,
        color: copied ? C.green : C.textSecondary,
        borderRadius: 8,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        transition: "all 0.15s",
        flexShrink: 0,
      }}
    >
      {copied ? "Copied ✓" : "Copy note"}
    </button>
  );
}

function RecommendationCard({ rec, showDivision }: { rec: JudgeRecommendation; showDivision: boolean }) {
  const [expanded, setExpanded] = useState(rec.severity_level === "critical");
  const meta = SEV_META[rec.severity_level];

  return (
    <div
      style={{
        background: C.navyCard,
        border: `1px solid ${C.navyBorder}`,
        borderLeft: `4px solid ${meta.color}`,
        borderRadius: 12,
        padding: "16px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            background: meta.dim,
            color: meta.color,
            border: `1px solid ${meta.color}44`,
            borderRadius: 20,
            padding: "3px 12px",
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {meta.label}
        </span>
        <span style={{ color: C.textPrimary, fontWeight: 700, fontSize: 15 }}>{rec.judge_name}</span>
        {showDivision && (
          <span style={{ color: C.gold, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {rec.division}
          </span>
        )}
        {rec.small_sample && (
          <span style={{ color: C.textMuted, fontSize: 11, fontStyle: "italic" }}>small sample — provisional</span>
        )}
        {rec.suggested_adjustment !== null && (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 13,
              color: rec.suggested_adjustment >= 0 ? C.green : C.red,
            }}
            title="Suggested per-ballot adjustment to align this judge with the division mean"
          >
            {rec.suggested_adjustment >= 0 ? "+" : ""}
            {rec.suggested_adjustment.toFixed(2)} pts
          </span>
        )}
      </div>

      <p style={{ color: C.textSecondary, fontSize: 13, lineHeight: 1.55, margin: "10px 0 0" }}>{rec.headline}</p>

      {rec.actions.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              background: "none",
              border: "none",
              color: C.gold,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
              marginTop: 12,
            }}
          >
            {expanded ? "▾ Hide" : "▸ Show"} recommended actions ({rec.actions.length})
          </button>

          {expanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              {rec.actions.map((a, i) => (
                <div
                  key={i}
                  style={{
                    background: "rgba(15,27,45,0.55)",
                    border: `1px solid ${C.navyBorder}`,
                    borderRadius: 10,
                    padding: "12px 16px",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
                    <span style={{ marginRight: 8 }}>{ACTION_META[a.type].icon}</span>
                    <span style={{ color: C.textMuted, fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", marginRight: 8 }}>
                      {ACTION_META[a.type].label}
                    </span>
                    {a.title}
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55, color: C.textSecondary }}>{a.detail}</p>
                </div>
              ))}

              {rec.feedback_note && (
                <div
                  style={{
                    background: "rgba(201,168,76,0.06)",
                    border: `1px dashed rgba(201,168,76,0.4)`,
                    borderRadius: 10,
                    padding: "12px 16px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <span style={{ color: C.gold, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      Ready-to-send feedback note
                    </span>
                    <CopyButton text={rec.feedback_note} />
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: C.textSecondary, fontStyle: "italic" }}>
                    “{rec.feedback_note}”
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecommendationsPanel({ recs, showDivision }: { recs: JudgeRecommendation[]; showDivision: boolean }) {
  const [filter, setFilter] = useState<SeverityLevel | "flagged">("flagged");

  const counts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, high: 0, moderate: 0, watch: 0, normal: 0 };
    recs.forEach((r) => c[r.severity_level]++);
    return c;
  }, [recs]);

  const flaggedCount = recs.length - counts.normal;

  const visible = useMemo(() => {
    if (filter === "flagged") return recs.filter((r) => r.severity_level !== "normal");
    return recs.filter((r) => r.severity_level === filter);
  }, [recs, filter]);

  const chips: { key: SeverityLevel | "flagged"; label: string; count: number; color?: string }[] = [
    { key: "flagged", label: "All Flagged", count: flaggedCount },
    ...(Object.keys(SEV_META) as SeverityLevel[]).map((k) => ({
      key: k,
      label: SEV_META[k].label,
      count: counts[k],
      color: SEV_META[k].color,
    })),
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {chips.map(({ key, label, count, color }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              disabled={count === 0}
              style={{
                padding: "7px 16px",
                borderRadius: 50,
                border: `1px solid ${active ? color ?? C.gold : C.navyBorder}`,
                background: active ? (color ? `${color}22` : C.goldDim) : "transparent",
                color: count === 0 ? C.textMuted : active ? color ?? C.gold : C.textSecondary,
                fontWeight: 700,
                fontSize: 12.5,
                cursor: count === 0 ? "default" : "pointer",
                opacity: count === 0 ? 0.45 : 1,
                transition: "all 0.15s",
              }}
            >
              {label} <span style={{ opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {flaggedCount === 0 && filter === "flagged" ? (
        <div
          style={{
            background: "rgba(74,232,138,0.05)",
            border: `1px solid rgba(74,232,138,0.25)`,
            borderRadius: 12,
            padding: "28px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ color: C.green, fontWeight: 700, fontSize: 15, margin: 0 }}>✓ No judges flagged</p>
          <p style={{ color: C.textMuted, fontSize: 13, marginTop: 6 }}>
            Every judge is scoring within the normal range for this pool. No interventions recommended.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p style={{ color: C.textMuted, fontSize: 13, textAlign: "center", padding: "24px 0" }}>
          No judges at this severity level.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visible.map((rec) => (
            <RecommendationCard key={`${rec.division}-${rec.judge_name}`} rec={rec} showDivision={showDivision} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Judge Severity Chart (diverging Z bars) ──────────────────────────────────

const ZBarTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const p = payload[0]?.payload;
    return (
      <div style={{ background: C.navyCard, border: `1px solid ${C.navyBorder}`, borderRadius: 10, padding: "10px 14px" }}>
        <p style={{ color: C.textPrimary, fontWeight: 700, fontSize: 13 }}>{p.name}</p>
        <p style={{ color: C.textSecondary, fontSize: 12 }}>
          Z: <span style={{ fontWeight: 700, fontFamily: "monospace", color: p.z >= 0 ? C.red : C.blue }}>{(p.z > 0 ? "+" : "") + p.z.toFixed(3)}</span>
        </p>
        <p style={{ color: C.textSecondary, fontSize: 12 }}>Mean: <span style={{ fontFamily: "monospace" }}>{p.mean.toFixed(2)}</span> · {p.n} scores</p>
      </div>
    );
  }
  return null;
};

function JudgeSeverityChart({ rows }: { rows: DivisionJudgeStat[] }) {
  const data = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.Z_Severity_Index - a.Z_Severity_Index)
        .map((j) => ({
          name: j.Judge_Full_Name,
          z: j.Z_Severity_Index,
          mean: j.Mean,
          n: j.Number_of_Scores,
          abs: j.Absolute_Severity,
        })),
    [rows]
  );

  const maxAbs = Math.max(1.8, ...data.map((d) => Math.abs(d.z))) * 1.15;
  const height = Math.max(180, data.length * 30 + 60);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.navyBorder} horizontal={false} />
        <XAxis
          type="number"
          domain={[-maxAbs, maxAbs]}
          tick={{ fill: C.textMuted, fontSize: 10 }}
          tickFormatter={(v) => v.toFixed(1)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tick={{ fill: C.textSecondary, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ZBarTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <ReferenceLine x={0} stroke={C.textMuted} strokeWidth={1.5} />
        <ReferenceLine x={1.5} stroke={C.red} strokeDasharray="5 4" strokeOpacity={0.5} />
        <ReferenceLine x={-1.5} stroke={C.blue} strokeDasharray="5 4" strokeOpacity={0.5} />
        <Bar dataKey="z" radius={[0, 5, 5, 0]} maxBarSize={18} isAnimationActive>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={
                d.abs > 1.5
                  ? d.z >= 0 ? C.red : C.blue
                  : d.abs > 1.0
                  ? d.z >= 0 ? "#F87171" : "#60A5FA"
                  : "#4A6380"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Score Distribution Chart ─────────────────────────────────────────────────

const DistTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const p = payload[0]?.payload;
    if (p?.name) {
      return (
        <div style={{ background: C.navyCard, border: `1px solid ${C.navyBorder}`, borderRadius: 10, padding: "10px 14px" }}>
          <p style={{ color: C.textPrimary, fontWeight: 700, fontSize: 13 }}>{p.name}</p>
          <p style={{ color: C.textSecondary, fontSize: 12 }}>Mean: <span style={{ color: p.direction === "High-Side" ? C.red : C.blue, fontWeight: 600, fontFamily: "monospace" }}>{p.x?.toFixed(2)}</span></p>
          <p style={{ color: C.textSecondary, fontSize: 12 }}>Z: <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{(p.z > 0 ? "+" : "") + p.z?.toFixed(3)}</span></p>
          <p style={{ color: p.direction === "High-Side" ? C.red : C.blue, fontSize: 11, marginTop: 2 }}>{p.direction}</p>
        </div>
      );
    }
  }
  return null;
};

function ScoreDistributionChart({
  divStats,
  divSummary,
}: {
  divStats: DivisionJudgeStat[];
  divSummary: DivisionSummary;
}) {
  const { mean, std } = divSummary;

  const curvePoints = useMemo(() => {
    if (std === 0 || !mean) return [];
    const xMin = mean - 3.5 * std;
    const xMax = mean + 3.5 * std;
    const step = (xMax - xMin) / 100;
    return Array.from({ length: 101 }, (_, i) => {
      const x = xMin + i * step;
      return { x: parseFloat(x.toFixed(3)), y: normalPDF(x, mean, std) };
    });
  }, [mean, std]);

  const judgePoints = useMemo(
    () =>
      divStats.map((j) => ({
        x: j.Mean,
        y: normalPDF(j.Mean, mean, std),
        name: j.Judge_Full_Name,
        direction: j.Bias_Direction,
        z: j.Z_Severity_Index,
        abs: j.Absolute_Severity,
      })),
    [divStats, mean, std]
  );

  const yMax = curvePoints.length > 0 ? Math.max(...curvePoints.map((p) => p.y)) : 1;
  const xMin = curvePoints[0]?.x ?? mean - 3 * std;
  const xMax = curvePoints[curvePoints.length - 1]?.x ?? mean + 3 * std;

  if (curvePoints.length === 0) {
    return (
      <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted }}>
        Insufficient data for distribution chart
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart margin={{ top: 20, right: 20, bottom: 30, left: 0 }}>
        <defs>
          <linearGradient id="bellGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={C.gold} stopOpacity={0.25} />
            <stop offset="95%" stopColor={C.gold} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={C.navyBorder} vertical={false} />
        <XAxis
          type="number"
          dataKey="x"
          domain={[xMin, xMax]}
          tick={{ fill: C.textMuted, fontSize: 10 }}
          tickFormatter={(v) => v.toFixed(0)}
          tickCount={8}
          axisLine={false}
          tickLine={false}
        />
        <YAxis type="number" domain={[0, yMax * 1.35]} hide />
        <Tooltip content={<DistTooltip />} cursor={{ stroke: C.navyBorder }} />
        <Area
          data={curvePoints}
          type="monotone"
          dataKey="y"
          stroke={C.gold}
          fill="url(#bellGrad)"
          strokeWidth={2.5}
          dot={false}
          activeDot={false}
          isAnimationActive
        />
        <Scatter data={judgePoints} isAnimationActive={false} r={6}>
          {judgePoints.map((p, i) => (
            <Cell
              key={i}
              fill={p.abs > 1.5 ? (p.direction === "High-Side" ? C.red : C.blue) : p.abs > 1.0 ? (p.direction === "High-Side" ? "#F87171" : "#60A5FA") : C.textMuted}
            />
          ))}
        </Scatter>
        <ReferenceLine x={mean} stroke={C.gold} strokeDasharray="6 3" strokeWidth={1.5} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Bias Breakdown Chart ─────────────────────────────────────────────────────

const BiasTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: C.navyCard, border: `1px solid ${C.navyBorder}`, borderRadius: 10, padding: "10px 14px" }}>
        <p style={{ color: C.textPrimary, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.fill, fontSize: 12, fontWeight: 600 }}>
            {p.name}: {p.value} judge{p.value !== 1 ? "s" : ""}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function BiasBreakdownChart({
  divisionStats,
}: {
  divisionStats: Record<string, DivisionJudgeStat[]>;
}) {
  const data = Object.entries(divisionStats).map(([div, rows]) => ({
    division: div,
    "High-Side": rows.filter((r) => r.Bias_Direction === "High-Side").length,
    "Low-Side": rows.filter((r) => r.Bias_Direction === "Low-Side").length,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 20, right: 10, bottom: 30, left: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.navyBorder} vertical={false} />
        <XAxis dataKey="division" tick={{ fill: C.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<BiasTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Legend
          formatter={(value) => (
            <span style={{ color: C.textSecondary, fontSize: 12 }}>{value}</span>
          )}
        />
        <Bar dataKey="High-Side" fill={C.red} radius={[5, 5, 0, 0]} maxBarSize={40} />
        <Bar dataKey="Low-Side" fill={C.blue} radius={[5, 5, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Severity Ranking Table ───────────────────────────────────────────────────

type SortKey = keyof DivisionJudgeStat;

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3, fontSize: 10 }}>
      {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );
}

function SeverityRankingTable({ rows }: { rows: DivisionJudgeStat[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("Severity_Rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let r = [...rows];
    if (search) {
      r = r.filter((row) =>
        row.Judge_Full_Name.toLowerCase().includes(search.toLowerCase())
      );
    }
    r.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls (insufficient data) always sort to the bottom, regardless of
      // direction — otherwise a null Consistency_Ratio coerced to 0 would
      // masquerade as the most consistent judge.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return r;
  }, [rows, search, sortKey, sortDir]);

  const headers: { key: SortKey; label: string }[] = [
    { key: "Severity_Rank", label: "Rank" },
    { key: "Judge_ID", label: "Judge ID" },
    { key: "Judge_Full_Name", label: "Judge Name" },
    { key: "Number_of_Scores", label: "# Scores" },
    { key: "Mean", label: "Mean" },
    { key: "Score_StdDev", label: "Std Dev" },
    { key: "Consistency_Ratio", label: "Consistency" },
    { key: "Z_Severity_Index", label: "Z-Index" },
    { key: "Absolute_Severity", label: "|Z|" },
    { key: "Bias_Direction", label: "Bias" },
    { key: "Mann_Whitney_U", label: "Mann-Whitney U" },
    { key: "p_value", label: "p-value" },
  ];

  return (
    <div>
      {/* Search bar */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by judge name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: C.navyCard,
            border: `1px solid ${C.navyBorder}`,
            borderRadius: 10,
            padding: "10px 16px",
            color: C.textPrimary,
            fontSize: 14,
            outline: "none",
            width: "100%",
            maxWidth: 360,
          }}
        />
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 20, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { color: "rgba(232,82,74,0.18)", border: "rgba(232,82,74,0.4)", label: "|Z| > 1.5 — High concern" },
          { color: "rgba(245,200,66,0.12)", border: "rgba(245,200,66,0.35)", label: "|Z| > 1.0 — Moderate" },
          { color: "rgba(74,232,138,0.10)", border: "rgba(74,232,138,0.3)", label: "|Z| < 0.5 — Normal range" },
        ].map(({ color, border, label }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: color, border: `1px solid ${border}`, display: "inline-block" }} />
            {label}
          </span>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: 14, border: `1px solid ${C.navyBorder}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#1B3A6B" }}>
              {headers.map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  style={{
                    padding: "12px 14px",
                    textAlign: "left",
                    color: C.textPrimary,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    userSelect: "none",
                    borderBottom: `1px solid ${C.navyBorder}`,
                  }}
                >
                  {label}
                  <SortIcon active={sortKey === key} dir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} style={{ textAlign: "center", padding: "32px", color: C.textMuted }}>
                  No judges match your search.
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const isHigh = row.Bias_Direction === "High-Side";
              const abs = row.Absolute_Severity;
              let rowBg = "transparent";
              if (abs > 1.5) rowBg = "rgba(232,82,74,0.09)";
              else if (abs > 1.0) rowBg = "rgba(245,200,66,0.07)";
              else if (abs < 0.5) rowBg = "rgba(74,232,138,0.05)";

              return (
                <tr
                  key={`${row.Judge_Full_Name}-${row.Severity_Rank}`}
                  style={{
                    background: rowBg,
                    borderBottom: `1px solid ${C.navyBorder}`,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = C.navyHover;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = rowBg;
                  }}
                >
                  <td style={{ padding: "11px 14px", fontWeight: 700, color: C.textSecondary }}>
                    {row.Severity_Rank}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "monospace", color: C.textMuted, fontSize: 12 }}>
                    {row.Judge_ID !== "" && row.Judge_ID !== null ? row.Judge_ID : "—"}
                  </td>
                  <td style={{ padding: "11px 14px", fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap" }}>
                    {row.Judge_Full_Name}
                  </td>
                  <td style={{ padding: "11px 14px", color: C.textSecondary }}>
                    {row.Number_of_Scores}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "monospace", color: C.textPrimary }}>
                    {row.Mean.toFixed(2)}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "monospace", color: C.textSecondary }}>
                    {row.Score_StdDev !== null && row.Score_StdDev !== undefined
                      ? row.Score_StdDev.toFixed(2)
                      : "—"}
                  </td>
                  <td
                    style={{
                      padding: "11px 14px",
                      fontFamily: "monospace",
                      fontWeight: 600,
                      color:
                        row.Consistency_Ratio === null || row.Consistency_Ratio === undefined
                          ? C.textMuted
                          : row.Consistency_Ratio > 1.5
                          ? C.red
                          : row.Consistency_Ratio < 0.75
                          ? C.green
                          : C.textSecondary,
                    }}
                    title="Judge's own score spread relative to the event's spread. <1 = more consistent than typical, >1 = less."
                  >
                    {row.Consistency_Ratio !== null && row.Consistency_Ratio !== undefined
                      ? `${row.Consistency_Ratio.toFixed(2)}×`
                      : "—"}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "monospace", fontWeight: 700, color: isHigh ? C.red : C.blue }}>
                    {row.Z_Severity_Index > 0 ? "+" : ""}{row.Z_Severity_Index.toFixed(4)}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "monospace", fontWeight: 700, color: abs > 1.5 ? C.red : abs > 1.0 ? C.yellow : abs < 0.5 ? C.green : C.textSecondary }}>
                    {row.Absolute_Severity.toFixed(4)}
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <span
                      style={{
                        padding: "4px 12px",
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 700,
                        background: isHigh ? "rgba(232,82,74,0.18)" : "rgba(74,143,232,0.18)",
                        color: isHigh ? C.red : C.blue,
                      }}
                    >
                      {row.Bias_Direction}
                    </span>
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "monospace", color: C.textSecondary }}>
                    {row.Mann_Whitney_U !== null ? (
                      row.Mann_Whitney_U.toFixed(1)
                    ) : (
                      <span>
                        <span style={{ color: C.textMuted }}>N/A</span>
                        {row.mw_na_reason && (
                          <span style={{ display: "block", fontSize: 10, color: C.textMuted, fontFamily: "sans-serif", marginTop: 2 }}>
                            {row.mw_na_reason}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "monospace", fontSize: 12, color: C.textSecondary }}>
                    {row.p_value !== null ? (
                      formatPValue(row.p_value)
                    ) : (
                      <span>
                        <span style={{ color: C.textMuted }}>N/A</span>
                        {row.mw_na_reason && (
                          <span style={{ display: "block", fontSize: 10, color: C.textMuted, fontFamily: "sans-serif", marginTop: 2 }}>
                            {row.mw_na_reason}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ color: C.textPrimary, fontWeight: 700, fontSize: 18, margin: 0 }}>{title}</h3>
      {sub && <p style={{ color: C.textMuted, fontSize: 13, marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.navyCard,
        border: `1px solid ${C.navyBorder}`,
        borderRadius: 16,
        padding: "24px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const [activeDivision, setActiveDivision] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".json"));
    if (files.length > 0) {
      setSelectedFiles(files);
      setError(null);
    } else {
      setError("Please upload valid JSON file(s).");
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setSelectedFiles(files);
      setError(null);
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setIsLoading(true);
    setError(null);
    setResults(null);
    try {
      // Single file → send as-is. Multiple files → merge client-side into one
      // multi-tournament array (the API dedupes overlapping ballots by ID).
      let uploadFile: File = selectedFiles[0];
      if (selectedFiles.length > 1) {
        const merged: unknown[] = [];
        for (const f of selectedFiles) {
          const text = await f.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new Error(`"${f.name}" is not valid JSON.`);
          }
          if (Array.isArray(parsed)) merged.push(...parsed);
          else merged.push(parsed);
        }
        uploadFile = new File([JSON.stringify(merged)], "combined_upload.json", {
          type: "application/json",
        });
      }

      const formData = new FormData();
      formData.append("file", uploadFile);
      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }
      const data = await response.json();
      setResults(data);
      const divs = Object.keys(data.division_stats);
      setActiveDivision(divs.length === 1 ? divs[0] : "all");
    } catch (err: any) {
      setError(err.message || "Analysis failed. Please check your file format and try again.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFiles]);

  const handleDownloadExcel = useCallback(() => {
    if (!results?.excel_base64) return;
    const binary = atob(results.excel_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "judgeiq_analytics.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [results]);

  const divisions = results ? Object.keys(results.division_stats) : [];
  const isAll = activeDivision === "all";

  // Per-division or all-divisions rows
  const activeRows: TaggedRow[] = isAll
    ? divisions.flatMap((div) => (results?.division_stats[div] ?? []).map((r) => ({ ...r, _div: div })))
    : (results?.division_stats[activeDivision] ?? []);

  const activeSummary = isAll ? null : results?.division_summary[activeDivision];

  // Recommendations for the active view, ordered by severity
  const sevOrder: Record<SeverityLevel, number> = { critical: 0, high: 1, moderate: 2, watch: 3, normal: 4 };
  const activeRecs: JudgeRecommendation[] = (
    results?.recommendations
      ? isAll
        ? divisions.flatMap((d) => results.recommendations?.[d] ?? [])
        : results.recommendations[activeDivision] ?? []
      : []
  )
    .slice()
    .sort((a, b) => sevOrder[a.severity_level] - sevOrder[b.severity_level]);
  const flaggedCount = activeRecs.filter((r) => r.severity_level !== "normal").length;

  // Aggregated stats for "All Divisions" mode
  const allModeTotals = isAll && results
    ? {
        total_judges: Object.values(results.division_summary).reduce((s, d) => s + d.total_judges, 0),
        total_scores: Object.values(results.division_summary).reduce((s, d) => s + d.total_scores, 0),
      }
    : null;

  return (
    <div style={{ background: C.navy, minHeight: "100vh" }}>

      {/* ── Hero / Upload ── */}
      <section style={{ padding: "80px 24px 60px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(201,168,76,0.1)",
              border: `1px solid rgba(201,168,76,0.3)`,
              borderRadius: 50,
              padding: "6px 18px",
              marginBottom: 20,
            }}
          >
            <span style={{ width: 7, height: 7, background: C.gold, borderRadius: "50%", display: "inline-block" }} />
            <span style={{ color: C.gold, fontSize: 13, fontWeight: 600 }}>Judge Analytics Platform</span>
          </div>

          <h1 style={{ fontSize: "clamp(40px, 7vw, 64px)", fontWeight: 800, color: C.textPrimary, margin: "0 0 16px", letterSpacing: "-0.03em" }}>
            Judge<span style={{ color: C.gold }}>IQ</span>
          </h1>
          <p style={{ fontSize: 18, color: C.textSecondary, maxWidth: 560, margin: "0 auto 32px", lineHeight: 1.6 }}>
            Premium judging analytics for competitive debate. Surface bias, quantify severity, and get concrete tab-room recommendations from any Tabroom export.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
            {[
              { icon: "⚖️", label: "Bias Detection" },
              { icon: "🧠", label: "Tab Room Recommendations" },
              { icon: "σ", label: "Z-Severity Index" },
              { icon: "U", label: "Mann-Whitney U" },
              { icon: "📊", label: "Data Visualizations" },
              { icon: "📥", label: "Excel Export" },
            ].map(({ icon, label }) => (
              <span
                key={label}
                style={{
                  background: C.navyCard,
                  border: `1px solid ${C.navyBorder}`,
                  borderRadius: 50,
                  padding: "7px 16px",
                  color: C.textSecondary,
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {icon} {label}
              </span>
            ))}
          </div>
        </div>

        {/* Upload card */}
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <Card>
            <h2 style={{ color: C.textPrimary, fontWeight: 700, fontSize: 18, margin: "0 0 6px" }}>
              Upload Tournament Data
            </h2>
            <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 24 }}>
              Accepts a Tabroom tournament JSON export file.
            </p>

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? C.gold : selectedFiles.length > 0 ? C.green : C.navyBorder}`,
                borderRadius: 12,
                padding: "40px 24px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.2s",
                background: isDragging
                  ? C.goldDim
                  : selectedFiles.length > 0
                  ? "rgba(74,232,138,0.05)"
                  : "rgba(15,27,45,0.5)",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                multiple
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
              {selectedFiles.length > 0 ? (
                <div>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
                  {selectedFiles.length === 1 ? (
                    <p style={{ color: C.green, fontWeight: 700, fontSize: 16 }}>{selectedFiles[0].name}</p>
                  ) : (
                    <>
                      <p style={{ color: C.green, fontWeight: 700, fontSize: 16 }}>
                        {selectedFiles.length} files selected — will be merged
                      </p>
                      <div style={{ marginTop: 8, maxHeight: 96, overflowY: "auto" }}>
                        {selectedFiles.map((f) => (
                          <p key={f.name} style={{ color: C.textSecondary, fontSize: 12, margin: "2px 0", fontFamily: "monospace" }}>
                            {f.name}
                          </p>
                        ))}
                      </div>
                    </>
                  )}
                  <p style={{ color: C.textMuted, fontSize: 13, marginTop: 6 }}>
                    {(selectedFiles.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)} KB total — Click to change
                  </p>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.35 }}>⬆</div>
                  <p style={{ color: C.textSecondary, fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
                    Drag & drop your JSON file(s) here
                  </p>
                  <p style={{ color: C.textMuted, fontSize: 13 }}>or click to browse — multiple rounds/tournaments merge automatically</p>
                  <p style={{ color: C.navyBorder, fontSize: 12, marginTop: 10, borderTop: `1px solid ${C.navyBorder}`, paddingTop: 10 }}>
                    Supported: .json (Tabroom export) — duplicate ballots across files are deduped
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div
                style={{
                  marginTop: 16,
                  background: "rgba(232,82,74,0.1)",
                  border: `1px solid rgba(232,82,74,0.35)`,
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <p style={{ color: C.red, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Error</p>
                <pre style={{ color: "#F8A4A0", fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", margin: 0 }}>
                  {error}
                </pre>
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={selectedFiles.length === 0 || isLoading}
              style={{
                marginTop: 20,
                width: "100%",
                padding: "14px 0",
                borderRadius: 12,
                border: "none",
                cursor: selectedFiles.length === 0 || isLoading ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 15,
                transition: "all 0.2s",
                background: selectedFiles.length === 0 || isLoading ? C.navyBorder : C.gold,
                color: selectedFiles.length === 0 || isLoading ? C.textMuted : C.navy,
              }}
            >
              {isLoading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <svg
                    style={{ animation: "spin 1s linear infinite", width: 18, height: 18 }}
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle opacity={0.25} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path opacity={0.75} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running Analysis...
                </span>
              ) : (
                "Run Analysis"
              )}
            </button>

            <p style={{ textAlign: "center", color: C.textMuted, fontSize: 12, marginTop: 14 }}>
              Use{" "}
              <code
                style={{
                  background: "rgba(255,255,255,0.06)",
                  padding: "2px 8px",
                  borderRadius: 5,
                  fontFamily: "monospace",
                  color: C.textSecondary,
                }}
              >
                analytics/sample_data.json
              </code>{" "}
              to test the application.
            </p>
          </Card>
        </div>
      </section>

      {/* ── Results ── */}
      {results && (
        <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 80px" }}>

          {/* Format Banner */}
          {results.format_info && (
            <div
              style={{
                marginBottom: 28,
                borderRadius: 12,
                border: `1px solid ${results.format_info.format === "unknown" ? "rgba(245,200,66,0.35)" : "rgba(201,168,76,0.35)"}`,
                background: results.format_info.format === "unknown" ? "rgba(245,200,66,0.06)" : C.goldDim,
                padding: "14px 20px",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 18, marginTop: 1 }}>
                {results.format_info.format === "unknown" ? "⚠️" : "✓"}
              </span>
              <div>
                <p style={{ color: results.format_info.format === "unknown" ? C.yellow : C.gold, fontWeight: 600, fontSize: 13, margin: 0 }}>
                  {results.format_info.label}
                </p>
                <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                  {results.format_info.judge_count !== undefined && (
                    <span style={{ color: C.textMuted, fontSize: 12 }}>{results.format_info.judge_count} judges</span>
                  )}
                  {results.format_info.division_count !== undefined && (
                    <span style={{ color: C.textMuted, fontSize: 12 }}>
                      {results.format_info.division_count} division{results.format_info.division_count !== 1 ? "s" : ""}
                    </span>
                  )}
                  {results.format_info.total_ballots !== undefined && (
                    <span style={{ color: C.textMuted, fontSize: 12 }}>{results.format_info.total_ballots} ballots</span>
                  )}
                  {results.format_info.divisions && results.format_info.divisions.length > 0 && (
                    <span style={{ color: C.textMuted, fontSize: 12 }}>({results.format_info.divisions.join(", ")})</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Header + Download */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 32 }}>
            <div>
              <h2 style={{ color: C.textPrimary, fontWeight: 800, fontSize: 28, margin: 0, letterSpacing: "-0.02em" }}>
                Analysis Results
              </h2>
              <p style={{ color: C.textMuted, fontSize: 13, marginTop: 6 }}>
                {results.summary.divisions.join(" · ")} — {results.summary.total_competitors} competitors, {results.summary.total_judges} judges
              </p>
            </div>
            <button
              onClick={handleDownloadExcel}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#1A6B35",
                border: `1px solid rgba(74,232,138,0.25)`,
                color: C.green,
                fontWeight: 700,
                fontSize: 14,
                padding: "11px 22px",
                borderRadius: 12,
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#1F8040")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#1A6B35")}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Excel Report
            </button>
          </div>

          {/* Division Toggle */}
          <div style={{ marginBottom: 28 }}>
            <DivisionToggle
              divisions={divisions}
              active={activeDivision}
              onChange={setActiveDivision}
            />
          </div>

          {/* Summary Stats Bar */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
            {isAll && allModeTotals ? (
              <>
                <StatPill label="Divisions" value={divisions.length} />
                <StatPill label="Total Judges" value={allModeTotals.total_judges} accent={C.blue} />
                <StatPill label="Total Scores" value={allModeTotals.total_scores} accent={C.textSecondary} />
                <StatPill label="Total Competitors" value={results.summary.total_competitors} accent={C.textSecondary} />
              </>
            ) : activeSummary ? (
              <>
                <StatPill label="Division Mean" value={activeSummary.mean.toFixed(2)} />
                <StatPill label="Std Deviation" value={activeSummary.std.toFixed(2)} accent={C.textSecondary} />
                <StatPill label="Total Judges" value={activeSummary.total_judges} accent={C.blue} />
                <StatPill label="Total Scores" value={activeSummary.total_scores} accent={C.textSecondary} />
              </>
            ) : null}
          </div>

          {/* Top 5 Extreme Judge Cards */}
          {activeRows.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <SectionHeader
                title="Most Extreme Judges"
                sub={isAll ? "Top 5 by absolute Z-severity across all divisions" : "Top 5 by absolute Z-severity — red border = High-Side, blue = Low-Side"}
              />
              <ExtremeJudgeCards rows={activeRows} />
            </div>
          )}

          {/* Recommendations */}
          {activeRecs.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <Card>
                <SectionHeader
                  title={`Tab Room Recommendations${flaggedCount > 0 ? ` — ${flaggedCount} judge${flaggedCount === 1 ? "" : "s"} flagged` : ""}`}
                  sub="What to do about judges scoring statistically differently: normalization adjustments, round placement, monitoring, and ready-to-send judge feedback."
                />
                <RecommendationsPanel recs={activeRecs} showDivision={isAll} />
              </Card>
            </div>
          )}

          {/* Charts Row */}
          <div style={{ marginBottom: 28 }}>
            {isAll ? (
              /* All-divisions: full-width bias breakdown */
              <Card>
                <SectionHeader title="Bias Breakdown — All Divisions" sub="High-Side vs Low-Side judges per division" />
                <BiasBreakdownChart divisionStats={results.division_stats} />
              </Card>
            ) : (
              /* Single division: distribution + bias side by side */
              <div className="charts-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16 }}>
                <Card>
                  <SectionHeader
                    title="Score Distribution"
                    sub={`Bell curve for ${activeDivision} — dots show where each judge's mean falls`}
                  />
                  {activeSummary ? (
                    <ScoreDistributionChart divStats={activeRows} divSummary={activeSummary} />
                  ) : (
                    <p style={{ color: C.textMuted, textAlign: "center", padding: "60px 0" }}>No distribution data</p>
                  )}
                  <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
                    {[
                      { color: C.red, label: "High-Side outlier" },
                      { color: C.blue, label: "Low-Side outlier" },
                      { color: C.textMuted, label: "Within normal range" },
                    ].map(({ color, label }) => (
                      <span key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
                        {label}
                      </span>
                    ))}
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
                      <span style={{ width: 24, height: 2, background: C.gold, display: "inline-block" }} />
                      Division mean (μ)
                    </span>
                  </div>
                </Card>
                <Card>
                  <SectionHeader title="Bias Breakdown" sub="High-Side vs Low-Side judges by division" />
                  <BiasBreakdownChart divisionStats={results.division_stats} />
                </Card>
              </div>
            )}
          </div>

          {/* Judge Severity Chart — single division only (Z is relative to each division's pool) */}
          {!isAll && activeRows.length > 1 && (
            <div style={{ marginBottom: 28 }}>
              <Card>
                <SectionHeader
                  title="Judge Severity — Z-Score Comparison"
                  sub="Each bar is a judge's Z-severity vs the division pool. Dashed lines at ±1.5 mark the high-concern threshold."
                />
                <JudgeSeverityChart rows={activeRows} />
              </Card>
            </div>
          )}

          {/* Severity Ranking Table(s) */}
          {isAll ? (
            /* All-divisions: one table per division, stacked */
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {divisions.map((div) => (
                <Card key={div}>
                  <SectionHeader
                    title={`Severity Ranking — ${div}`}
                    sub="Click column headers to sort. Search by name to filter."
                  />
                  <SeverityRankingTable rows={results.division_stats[div] ?? []} />
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <SectionHeader
                title={`Severity Ranking — ${activeDivision}`}
                sub="Click column headers to sort. Search by name to filter."
              />
              <SeverityRankingTable rows={activeRows} />
            </Card>
          )}

        </section>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input::placeholder { color: ${C.textMuted}; }
        * { box-sizing: border-box; }
        @media (max-width: 768px) {
          .charts-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
