"use client";

import React, { useState, useCallback, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────────────────────

interface JudgeStat {
  judge: string;
  mean_score: number;
  std_dev: number;
  min_score: number;
  max_score: number;
  bias_vs_average: number;
  consistency_score: number;
  spearman_rho_placement: number | null;
  spearman_pval: number | null;
}

interface Outlier {
  competitor_id: string;
  competitor_name: string;
  division: string;
  judge: string;
  score: number;
  z_score: number;
  direction: "High" | "Low";
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

interface AnalysisResult {
  summary: Summary;
  judge_stats: JudgeStat[];
  kendall_tau_matrix: Record<string, Record<string, number | null>>;
  outliers: Outlier[];
  excel_base64: string;
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

const CustomBiasTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const value = payload[0].value as number;
    return (
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl">
        <p className="text-gray-300 text-sm font-medium mb-1">{label}</p>
        <p className={`text-sm font-bold ${value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-gray-400"}`}>
          Bias: {value > 0 ? "+" : ""}{value.toFixed(3)}
        </p>
        <p className="text-gray-500 text-xs mt-1">
          {value > 0 ? "Scores above average" : value < 0 ? "Scores below average" : "At average"}
        </p>
      </div>
    );
  }
  return null;
};

const CustomConsistencyTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const value = payload[0].value as number;
    return (
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl">
        <p className="text-gray-300 text-sm font-medium mb-1">{label}</p>
        <p className="text-indigo-400 text-sm font-bold">
          Consistency: {value.toFixed(1)}%
        </p>
        <p className="text-gray-500 text-xs mt-1">
          {value >= 85 ? "Very consistent" : value >= 70 ? "Moderately consistent" : "Low consistency"}
        </p>
      </div>
    );
  }
  return null;
};

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 flex flex-col gap-1">
      <p className="text-gray-400 text-xs uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-2xl font-bold ${accent || "text-white"}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs">{sub}</p>}
    </div>
  );
}

// ─── Judge Stats Table ───────────────────────────────────────────────────────

function JudgeStatsTable({ stats }: { stats: JudgeStat[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-indigo-900/50 border-b border-gray-700">
            {["Judge", "Mean", "Std Dev", "Min", "Max", "Bias", "Consistency", "Spearman ρ"].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-gray-300 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr
              key={s.judge}
              className={`border-b border-gray-800 ${i % 2 === 0 ? "bg-gray-900" : "bg-gray-800/50"} hover:bg-gray-700/50 transition-colors`}
            >
              <td className="px-4 py-3 font-semibold text-indigo-300">{s.judge}</td>
              <td className="px-4 py-3 text-gray-200">{s.mean_score.toFixed(2)}</td>
              <td className="px-4 py-3 text-gray-300">{s.std_dev.toFixed(3)}</td>
              <td className="px-4 py-3 text-gray-400">{s.min_score}</td>
              <td className="px-4 py-3 text-gray-400">{s.max_score}</td>
              <td className="px-4 py-3">
                <span className={`font-semibold ${s.bias_vs_average > 0 ? "text-green-400" : s.bias_vs_average < 0 ? "text-red-400" : "text-gray-400"}`}>
                  {s.bias_vs_average > 0 ? "+" : ""}{s.bias_vs_average.toFixed(3)}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-700 rounded-full h-1.5 max-w-16">
                    <div
                      className="bg-indigo-500 h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, s.consistency_score)}%` }}
                    />
                  </div>
                  <span className="text-gray-300 text-xs">{s.consistency_score.toFixed(1)}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                {s.spearman_rho_placement !== null ? (
                  <span className={`${Math.abs(s.spearman_rho_placement) > 0.7 ? "text-green-400" : Math.abs(s.spearman_rho_placement) > 0.4 ? "text-yellow-400" : "text-red-400"}`}>
                    {s.spearman_rho_placement.toFixed(4)}
                  </span>
                ) : (
                  <span className="text-gray-600">N/A</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Kendall Tau Matrix ──────────────────────────────────────────────────────

function TauMatrix({ matrix, judges }: { matrix: Record<string, Record<string, number | null>>; judges: string[] }) {
  const getColor = (val: number | null, isDiag: boolean) => {
    if (isDiag) return "bg-indigo-700/60 text-indigo-200 font-bold";
    if (val === null) return "bg-gray-800 text-gray-600";
    if (val >= 0.7) return "bg-green-900/50 text-green-300";
    if (val >= 0.4) return "bg-yellow-900/40 text-yellow-300";
    if (val >= 0) return "bg-orange-900/30 text-orange-300";
    return "bg-red-900/40 text-red-300";
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-indigo-900/50 border-b border-gray-700">
            <th className="px-4 py-3 text-left text-gray-300 font-semibold text-xs uppercase tracking-wider">Judge</th>
            {judges.map((j) => (
              <th key={j} className="px-4 py-3 text-center text-gray-300 font-semibold text-xs uppercase tracking-wider">{j}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {judges.map((j1, ri) => (
            <tr key={j1} className={`border-b border-gray-800 ${ri % 2 === 0 ? "bg-gray-900" : "bg-gray-800/50"}`}>
              <td className="px-4 py-3 font-semibold text-indigo-300">{j1}</td>
              {judges.map((j2) => {
                const val = matrix[j1]?.[j2] ?? null;
                const isDiag = j1 === j2;
                return (
                  <td key={j2} className={`px-4 py-3 text-center rounded ${getColor(val, isDiag)}`}>
                    {isDiag ? "1.00" : val !== null ? val.toFixed(4) : "N/A"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Outliers Table ──────────────────────────────────────────────────────────

function OutliersTable({ outliers }: { outliers: Outlier[] }) {
  if (outliers.length === 0) {
    return (
      <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">✓</div>
        <p className="text-green-400 font-semibold text-lg">No Outliers Detected</p>
        <p className="text-gray-400 text-sm mt-1">All judge scores fall within 2 standard deviations of the mean.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-red-800/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-red-950/50 border-b border-red-800/50">
            {["Competitor", "Division", "Judge", "Score", "Z-Score", "Direction"].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-red-300 font-semibold text-xs uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outliers.map((o, i) => (
            <tr
              key={`${o.competitor_id}-${o.judge}`}
              className={`border-b border-gray-800 ${i % 2 === 0 ? "bg-gray-900" : "bg-gray-800/50"} hover:bg-gray-700/50 transition-colors`}
            >
              <td className="px-4 py-3">
                <div className="font-medium text-gray-200">{o.competitor_name}</div>
                <div className="text-gray-500 text-xs">{o.competitor_id}</div>
              </td>
              <td className="px-4 py-3 text-gray-400">{o.division}</td>
              <td className="px-4 py-3 text-indigo-300 font-medium">{o.judge}</td>
              <td className="px-4 py-3 text-gray-200 font-mono">{o.score}</td>
              <td className="px-4 py-3 font-mono">
                <span className={`font-bold ${Math.abs(o.z_score) > 3 ? "text-red-400" : "text-orange-400"}`}>
                  {o.z_score > 0 ? "+" : ""}{o.z_score.toFixed(4)}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${o.direction === "High" ? "bg-red-900/60 text-red-300" : "bg-orange-900/60 text-orange-300"}`}>
                  {o.direction}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HomePage() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Drag & Drop handlers ─────────────────────────────────────────────────

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
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".json")) {
      setSelectedFile(file);
      setError(null);
    } else {
      setError("Please upload a valid JSON file.");
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  }, []);

  // ── Upload & Analyze ─────────────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return;

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      setResults(data);
    } catch (err: any) {
      setError(err.message || "Analysis failed. Please check your file format and try again.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFile]);

  // ── Download Excel ───────────────────────────────────────────────────────

  const handleDownloadExcel = useCallback(() => {
    if (!results?.excel_base64) return;
    const binary = atob(results.excel_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ocdl_judge_analytics.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  // ── Chart data ───────────────────────────────────────────────────────────

  const biasChartData = results?.judge_stats.map((s) => ({
    name: s.judge,
    bias: s.bias_vs_average,
  })) ?? [];

  const consistencyChartData = results?.judge_stats.map((s) => ({
    name: s.judge,
    consistency: s.consistency_score,
    std_dev: s.std_dev,
  })) ?? [];

  const radarData = results?.judge_stats.map((s) => ({
    metric: s.judge,
    Consistency: s.consistency_score,
    "Mean Score": s.mean_score,
    "Placement Corr": s.spearman_rho_placement !== null ? Math.abs(s.spearman_rho_placement) * 100 : 0,
  })) ?? [];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900">

      {/* ── Hero Section ── */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-gray-900 to-purple-950 opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
          <div className="text-center mb-16">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-indigo-900/50 border border-indigo-700/50 rounded-full px-4 py-1.5 text-indigo-300 text-sm font-medium mb-6">
              <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
              Online Competitive Dance League
            </div>

            <h1 className="text-5xl sm:text-6xl font-extrabold text-white tracking-tight mb-6">
              Judge{" "}
              <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Analytics
              </span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed mb-10">
              Upload your competition JSON data and instantly surface judge bias, consistency scores,
              Kendall&apos;s tau correlations, and Z-score outliers — exported to a polished Excel workbook.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-3 text-sm">
              {[
                { icon: "⚖️", label: "Bias Detection" },
                { icon: "📊", label: "Consistency Scoring" },
                { icon: "τ", label: "Kendall's Tau" },
                { icon: "σ", label: "Z-Score Outliers" },
                { icon: "📈", label: "Spearman Correlation" },
                { icon: "📥", label: "Excel Export" },
              ].map(({ icon, label }) => (
                <span
                  key={label}
                  className="bg-gray-800/80 border border-gray-700 rounded-full px-4 py-1.5 text-gray-300 font-medium"
                >
                  {icon} {label}
                </span>
              ))}
            </div>
          </div>

          {/* ── Upload Card ── */}
          <div className="max-w-2xl mx-auto">
            <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-2xl p-8 shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-2">Upload Competition Data</h2>
              <p className="text-gray-400 text-sm mb-6">
                Accepts a JSON array of competitor entries with judge scores and final placements.
              </p>

              {/* Dropzone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer
                  transition-all duration-200
                  ${isDragging
                    ? "border-indigo-500 bg-indigo-500/10"
                    : selectedFile
                    ? "border-green-600 bg-green-900/10"
                    : "border-gray-600 bg-gray-900/50 hover:border-indigo-600 hover:bg-indigo-900/10"
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleFileSelect}
                />

                {selectedFile ? (
                  <div>
                    <div className="text-4xl mb-3">✓</div>
                    <p className="text-green-400 font-semibold text-lg">{selectedFile.name}</p>
                    <p className="text-gray-400 text-sm mt-1">
                      {(selectedFile.size / 1024).toFixed(1)} KB — Click to change file
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="text-5xl mb-4 opacity-40">⬆</div>
                    <p className="text-gray-300 font-medium text-lg mb-1">
                      Drag & drop your JSON file here
                    </p>
                    <p className="text-gray-500 text-sm">or click to browse</p>
                    <p className="text-gray-600 text-xs mt-3">Supported: .json</p>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="mt-4 bg-red-900/30 border border-red-700/50 rounded-lg p-4 text-red-300 text-sm">
                  <span className="font-semibold">Error: </span>{error}
                </div>
              )}

              {/* Analyze Button */}
              <button
                onClick={handleAnalyze}
                disabled={!selectedFile || isLoading}
                className={`
                  mt-6 w-full py-3.5 rounded-xl font-bold text-base transition-all duration-200
                  ${!selectedFile || isLoading
                    ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                    : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-900/30 hover:shadow-indigo-700/40 active:scale-[0.98]"
                  }
                `}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-3">
                    <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Running Analysis...
                  </span>
                ) : (
                  "Run Analysis"
                )}
              </button>

              {/* Sample data note */}
              <p className="text-center text-gray-600 text-xs mt-4">
                Use{" "}
                <code className="bg-gray-700/60 px-1.5 py-0.5 rounded text-gray-400 font-mono">
                  analytics/sample_data.json
                </code>{" "}
                to test the application.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Results Section ── */}
      {results && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 animate-fade-in">

          {/* Header + download */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
            <div>
              <h2 className="text-3xl font-extrabold text-white">Analysis Results</h2>
              <p className="text-gray-400 mt-1 text-sm">
                {results.summary.divisions.join(" · ")} — {results.summary.total_competitors} competitors, {results.summary.total_judges} judges
              </p>
            </div>
            <button
              onClick={handleDownloadExcel}
              className="flex items-center gap-2 bg-green-700 hover:bg-green-600 text-white font-bold px-5 py-2.5 rounded-xl transition-colors shadow-lg shadow-green-900/30"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Excel Report
            </button>
          </div>

          {/* ── Summary Stats Grid ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
            <StatCard label="Competitors" value={results.summary.total_competitors} sub="Total entries analyzed" accent="text-indigo-300" />
            <StatCard label="Judges" value={results.summary.total_judges} sub="Scoring panel size" accent="text-purple-300" />
            <StatCard label="Divisions" value={results.summary.divisions.length} sub={results.summary.divisions.join(", ")} accent="text-blue-300" />
            <StatCard label="Outliers" value={results.outliers.length} sub={results.outliers.length > 0 ? "Flagged scores (|z|>2)" : "No outliers detected"} accent={results.outliers.length > 0 ? "text-red-400" : "text-green-400"} />
          </div>

          {/* ── Judge Highlights ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
            {[
              { label: "Most Generous", value: results.summary.most_generous_judge ?? "N/A", sub: "Highest avg bias", icon: "⬆", color: "text-green-400" },
              { label: "Most Strict", value: results.summary.most_strict_judge ?? "N/A", sub: "Lowest avg bias", icon: "⬇", color: "text-red-400" },
              { label: "Most Consistent", value: results.summary.most_consistent_judge ?? "N/A", sub: "Lowest score variation", icon: "⚖", color: "text-indigo-400" },
              { label: "Least Consistent", value: results.summary.least_consistent_judge ?? "N/A", sub: "Highest score variation", icon: "↕", color: "text-orange-400" },
            ].map(({ label, value, sub, icon, color }) => (
              <div key={label} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-col gap-1">
                <p className="text-gray-400 text-xs uppercase tracking-wider font-medium">{label}</p>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{icon}</span>
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                </div>
                <p className="text-gray-500 text-xs">{sub}</p>
              </div>
            ))}
          </div>

          {/* ── Charts Row ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">

            {/* Bias Chart */}
            <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-1">Judge Bias vs. Average</h3>
              <p className="text-gray-400 text-xs mb-5">
                Positive = scores above panel average &nbsp;·&nbsp; Negative = below average
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={biasChartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" tick={{ fill: "#9CA3AF", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomBiasTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 4" />
                  <Bar dataKey="bias" radius={[6, 6, 0, 0]} maxBarSize={60}>
                    {biasChartData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.bias > 0 ? "#4ade80" : entry.bias < 0 ? "#f87171" : "#6B7280"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Consistency Chart */}
            <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white mb-1">Consistency Scores</h3>
              <p className="text-gray-400 text-xs mb-5">
                100 = perfectly consistent &nbsp;·&nbsp; Lower = more variable scoring
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={consistencyChartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" tick={{ fill: "#9CA3AF", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#9CA3AF", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomConsistencyTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <ReferenceLine y={85} stroke="#6366f1" strokeDasharray="4 4" label={{ value: "85% threshold", fill: "#818cf8", fontSize: 11, position: "insideTopRight" }} />
                  <Bar dataKey="consistency" radius={[6, 6, 0, 0]} maxBarSize={60}>
                    {consistencyChartData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={
                          entry.consistency >= 85
                            ? "#818cf8"
                            : entry.consistency >= 70
                            ? "#a78bfa"
                            : "#c084fc"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Sections ── */}
          <div className="space-y-12">

            {/* Per-Judge Stats Table */}
            <div>
              <h3 className="text-xl font-bold text-white mb-4">Per-Judge Statistical Analysis</h3>
              <JudgeStatsTable stats={results.judge_stats} />
            </div>

            {/* Kendall's Tau Matrix */}
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Kendall&apos;s Tau Correlation Matrix</h3>
              <p className="text-gray-400 text-sm mb-4">
                Measures rank-order agreement between judges. &ge;0.7 = strong agreement (green), 0.4–0.7 = moderate (yellow), &lt;0.4 = weak (orange/red).
              </p>
              <TauMatrix matrix={results.kendall_tau_matrix} judges={results.summary.judge_names} />
            </div>

            {/* Outliers */}
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Z-Score Outlier Detection</h3>
              <p className="text-gray-400 text-sm mb-4">
                Scores flagged where |z| &gt; 2.0 — indicating unusually high or low scores relative to that judge&apos;s distribution.
              </p>
              <OutliersTable outliers={results.outliers} />
            </div>

          </div>
        </section>
      )}

      {/* ── How It Works Section (shown before results) ── */}
      {!results && !isLoading && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <h2 className="text-2xl font-bold text-white text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: "1",
                title: "Upload JSON",
                desc: "Provide your competition results as a JSON array with judge scores and final placements.",
                color: "from-indigo-600 to-indigo-800",
              },
              {
                step: "2",
                title: "Python Engine Runs",
                desc: "Our analytics engine computes bias, consistency, Kendall's tau, and Z-score outliers using Pandas & SciPy.",
                color: "from-purple-600 to-purple-800",
              },
              {
                step: "3",
                title: "View Dashboard",
                desc: "Explore interactive charts showing judge bias, consistency rankings, and correlation matrices.",
                color: "from-blue-600 to-blue-800",
              },
              {
                step: "4",
                title: "Download Excel",
                desc: "Get a multi-sheet Excel workbook with Summary, Judge Stats, Score Matrix, Correlations, and Outliers.",
                color: "from-green-600 to-green-800",
              },
            ].map(({ step, title, desc, color }) => (
              <div key={step} className="bg-gray-800 border border-gray-700 rounded-2xl p-6 flex flex-col gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-lg`}>
                  {step}
                </div>
                <h3 className="text-white font-bold text-lg">{title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* JSON format reference */}
          <div className="mt-16 bg-gray-800/50 border border-gray-700 rounded-2xl p-8">
            <h3 className="text-lg font-bold text-white mb-4">Expected JSON Format</h3>
            <pre className="bg-gray-900 border border-gray-700 rounded-xl p-6 text-sm text-green-300 font-mono overflow-x-auto leading-relaxed">
{`[
  {
    "competitor_id": "C001",
    "competitor_name": "Jane Doe",
    "division": "Open Ladies",
    "judge_scores": {
      "Judge A": 85,
      "Judge B": 78,
      "Judge C": 90
    },
    "final_placement": 1
  },
  ...
]`}
            </pre>
            <p className="text-gray-400 text-sm mt-4">
              All fields are required. <code className="bg-gray-700 px-1.5 py-0.5 rounded text-gray-300">judge_scores</code> keys become column headers in the analysis.
              Run <code className="bg-gray-700 px-1.5 py-0.5 rounded text-gray-300">analytics/sample_data.json</code> to see a working example.
            </p>
          </div>
        </section>
      )}

    </div>
  );
}
