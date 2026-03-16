#!/usr/bin/env python3
"""
OCDL Judge Analytics Engine
Analyzes competition judge scoring data and produces Excel + JSON output.

Usage: python analyze.py input.json output_dir/
"""

import json
import sys
import os
import math
from pathlib import Path
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats
import openpyxl
from openpyxl.styles import (
    PatternFill, Font, Alignment, Border, Side
)
from openpyxl.utils.dataframe import dataframe_to_rows
from openpyxl.chart import BarChart, Reference


def load_data(filepath: str) -> list[dict]:
    """Load competition JSON data."""
    with open(filepath, "r") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Input JSON must be an array of competitor entries.")
    return data


def extract_judge_names(data: list[dict]) -> list[str]:
    """Extract all unique judge names from the dataset."""
    names = set()
    for entry in data:
        names.update(entry.get("judge_scores", {}).keys())
    return sorted(names)


def build_score_matrix(data: list[dict], judges: list[str]) -> pd.DataFrame:
    """Build a DataFrame with competitors as rows and judges as columns."""
    rows = []
    for entry in data:
        row = {
            "competitor_id": entry.get("competitor_id", ""),
            "competitor_name": entry.get("competitor_name", ""),
            "division": entry.get("division", ""),
            "final_placement": entry.get("final_placement", None),
        }
        scores = entry.get("judge_scores", {})
        for judge in judges:
            row[judge] = scores.get(judge, np.nan)
        rows.append(row)
    return pd.DataFrame(rows)


def compute_judge_stats(df: pd.DataFrame, judges: list[str]) -> pd.DataFrame:
    """
    Compute per-judge statistics:
    - mean, std, min, max
    - bias: judge mean - overall average across all judges
    - consistency: inverse of coefficient of variation (0-100 scale)
    - correlation with final placement (Spearman rho)
    """
    # Overall average per competitor (mean across judges)
    score_cols = df[judges].copy()
    overall_avg = score_cols.mean(axis=1)

    records = []
    for judge in judges:
        col = df[judge].dropna()
        if col.empty:
            continue

        mean_score = float(col.mean())
        std_score = float(col.std(ddof=1)) if len(col) > 1 else 0.0
        min_score = float(col.min())
        max_score = float(col.max())

        # Bias: judge's mean minus the overall mean across all judges
        judge_avg = mean_score
        global_avg = float(overall_avg.mean())
        bias = judge_avg - global_avg

        # Consistency: 100 - coefficient of variation (capped 0-100)
        if mean_score != 0:
            cv = (std_score / abs(mean_score)) * 100
        else:
            cv = 0.0
        consistency = max(0.0, min(100.0, 100.0 - cv))

        # Spearman correlation with final placement
        placement_col = df["final_placement"].dropna()
        valid_mask = df[judge].notna() & df["final_placement"].notna()
        if valid_mask.sum() >= 3:
            rho, pval = stats.spearmanr(
                df.loc[valid_mask, judge],
                df.loc[valid_mask, "final_placement"]
            )
        else:
            rho, pval = np.nan, np.nan

        records.append({
            "judge": judge,
            "mean_score": round(mean_score, 3),
            "std_dev": round(std_score, 3),
            "min_score": round(min_score, 3),
            "max_score": round(max_score, 3),
            "bias_vs_average": round(bias, 3),
            "consistency_score": round(consistency, 3),
            "spearman_rho_placement": round(rho, 4) if not math.isnan(rho) else None,
            "spearman_pval": round(pval, 4) if not math.isnan(pval) else None,
        })

    return pd.DataFrame(records)


def compute_kendall_tau_matrix(df: pd.DataFrame, judges: list[str]) -> pd.DataFrame:
    """
    Compute pairwise Kendall's tau correlation between all judge pairs.
    Returns a DataFrame (matrix) with judges as index and columns.
    """
    matrix = pd.DataFrame(index=judges, columns=judges, dtype=float)
    for j in judges:
        matrix.loc[j, j] = 1.0

    for j1, j2 in combinations(judges, 2):
        valid = df[[j1, j2]].dropna()
        if len(valid) >= 3:
            tau, _ = stats.kendalltau(valid[j1], valid[j2])
        else:
            tau = np.nan
        matrix.loc[j1, j2] = round(tau, 4) if not math.isnan(tau) else np.nan
        matrix.loc[j2, j1] = round(tau, 4) if not math.isnan(tau) else np.nan

    return matrix.astype(float)


def detect_outliers(df: pd.DataFrame, judges: list[str], threshold: float = 2.0) -> pd.DataFrame:
    """
    Z-score outlier detection per judge column.
    Returns rows where any judge score deviates > threshold standard deviations.
    """
    outlier_rows = []
    score_cols = df[judges].copy()

    for judge in judges:
        col = score_cols[judge].dropna()
        if len(col) < 3:
            continue
        mean_j = col.mean()
        std_j = col.std(ddof=1)
        if std_j == 0:
            continue

        z_scores = (score_cols[judge] - mean_j) / std_j
        mask = z_scores.abs() > threshold

        for idx in df[mask].index:
            outlier_rows.append({
                "competitor_id": df.loc[idx, "competitor_id"],
                "competitor_name": df.loc[idx, "competitor_name"],
                "division": df.loc[idx, "division"],
                "judge": judge,
                "score": df.loc[idx, judge],
                "z_score": round(float(z_scores[idx]), 4),
                "direction": "High" if z_scores[idx] > 0 else "Low",
            })

    if outlier_rows:
        return pd.DataFrame(outlier_rows).sort_values("z_score", key=abs, ascending=False)
    return pd.DataFrame(columns=["competitor_id", "competitor_name", "division", "judge", "score", "z_score", "direction"])


def build_summary(df: pd.DataFrame, judges: list[str], judge_stats: pd.DataFrame) -> dict:
    """Build a high-level summary dictionary."""
    return {
        "total_competitors": int(len(df)),
        "total_judges": int(len(judges)),
        "divisions": list(df["division"].dropna().unique()),
        "judge_names": judges,
        "most_generous_judge": judge_stats.sort_values("bias_vs_average", ascending=False).iloc[0]["judge"]
        if not judge_stats.empty else None,
        "most_strict_judge": judge_stats.sort_values("bias_vs_average", ascending=True).iloc[0]["judge"]
        if not judge_stats.empty else None,
        "most_consistent_judge": judge_stats.sort_values("consistency_score", ascending=False).iloc[0]["judge"]
        if not judge_stats.empty else None,
        "least_consistent_judge": judge_stats.sort_values("consistency_score", ascending=True).iloc[0]["judge"]
        if not judge_stats.empty else None,
    }


# ---------------------------------------------------------------------------
# Excel Export
# ---------------------------------------------------------------------------

DARK_FILL = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")
HEADER_FILL = PatternFill(start_color="4F46E5", end_color="4F46E5", fill_type="solid")
ALT_FILL = PatternFill(start_color="374151", end_color="374151", fill_type="solid")
ACCENT_FILL = PatternFill(start_color="7C3AED", end_color="7C3AED", fill_type="solid")
DANGER_FILL = PatternFill(start_color="DC2626", end_color="DC2626", fill_type="solid")
WARNING_FILL = PatternFill(start_color="D97706", end_color="D97706", fill_type="solid")

WHITE_FONT = Font(color="FFFFFF", bold=False, name="Calibri", size=11)
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=11)
TITLE_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=14)

THIN_BORDER = Border(
    left=Side(style="thin", color="6B7280"),
    right=Side(style="thin", color="6B7280"),
    top=Side(style="thin", color="6B7280"),
    bottom=Side(style="thin", color="6B7280"),
)


def style_header_row(ws, row_num: int, num_cols: int):
    for col in range(1, num_cols + 1):
        cell = ws.cell(row=row_num, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER


def style_data_row(ws, row_num: int, num_cols: int, alt: bool = False):
    fill = ALT_FILL if alt else DARK_FILL
    for col in range(1, num_cols + 1):
        cell = ws.cell(row=row_num, column=col)
        cell.fill = fill
        cell.font = WHITE_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER


def write_dataframe_to_sheet(ws, df: pd.DataFrame, start_row: int = 1):
    """Write a DataFrame to a worksheet with styling."""
    cols = list(df.columns)
    num_cols = len(cols)

    # Header
    for col_idx, col_name in enumerate(cols, start=1):
        ws.cell(row=start_row, column=col_idx, value=str(col_name))
    style_header_row(ws, start_row, num_cols)

    # Data rows
    for row_offset, (_, row_data) in enumerate(df.iterrows()):
        r = start_row + row_offset + 1
        for col_idx, val in enumerate(row_data, start=1):
            if pd.isna(val) if not isinstance(val, str) else False:
                ws.cell(row=r, column=col_idx, value="N/A")
            else:
                ws.cell(row=r, column=col_idx, value=val)
        style_data_row(ws, r, num_cols, alt=(row_offset % 2 == 1))

    return start_row + len(df) + 1


def export_excel(
    df: pd.DataFrame,
    judges: list[str],
    judge_stats: pd.DataFrame,
    tau_matrix: pd.DataFrame,
    outliers: pd.DataFrame,
    summary: dict,
    output_path: str,
):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # remove default sheet

    # -------------------------------------------------------------------
    # Sheet 1: Summary
    # -------------------------------------------------------------------
    ws_summary = wb.create_sheet("Summary")
    ws_summary.sheet_view.showGridLines = False

    # Title
    ws_summary["A1"] = "OCDL Judge Analytics Report"
    ws_summary["A1"].font = TITLE_FONT
    ws_summary["A1"].fill = ACCENT_FILL
    ws_summary["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws_summary.merge_cells("A1:D1")
    ws_summary.row_dimensions[1].height = 30

    summary_items = [
        ("Total Competitors", summary["total_competitors"]),
        ("Total Judges", summary["total_judges"]),
        ("Divisions", ", ".join(summary["divisions"])),
        ("Judge Names", ", ".join(summary["judge_names"])),
        ("Most Generous Judge", summary.get("most_generous_judge", "N/A")),
        ("Most Strict Judge", summary.get("most_strict_judge", "N/A")),
        ("Most Consistent Judge", summary.get("most_consistent_judge", "N/A")),
        ("Least Consistent Judge", summary.get("least_consistent_judge", "N/A")),
    ]

    ws_summary["A3"] = "Metric"
    ws_summary["B3"] = "Value"
    style_header_row(ws_summary, 3, 2)

    for i, (label, value) in enumerate(summary_items):
        r = 4 + i
        ws_summary.cell(row=r, column=1, value=label)
        ws_summary.cell(row=r, column=2, value=str(value))
        style_data_row(ws_summary, r, 2, alt=(i % 2 == 1))

    ws_summary.column_dimensions["A"].width = 28
    ws_summary.column_dimensions["B"].width = 40

    # -------------------------------------------------------------------
    # Sheet 2: Judge Stats
    # -------------------------------------------------------------------
    ws_stats = wb.create_sheet("Judge Stats")
    ws_stats.sheet_view.showGridLines = False

    ws_stats["A1"] = "Per-Judge Statistical Analysis"
    ws_stats["A1"].font = TITLE_FONT
    ws_stats["A1"].fill = ACCENT_FILL
    ws_stats["A1"].alignment = Alignment(horizontal="center", vertical="center")
    num_stat_cols = len(judge_stats.columns)
    ws_stats.merge_cells(f"A1:{chr(64 + num_stat_cols)}1")
    ws_stats.row_dimensions[1].height = 30

    write_dataframe_to_sheet(ws_stats, judge_stats, start_row=3)

    for col_letter in "ABCDEFGHIJ"[:num_stat_cols]:
        ws_stats.column_dimensions[col_letter].width = 22

    # -------------------------------------------------------------------
    # Sheet 3: Score Matrix
    # -------------------------------------------------------------------
    ws_matrix = wb.create_sheet("Score Matrix")
    ws_matrix.sheet_view.showGridLines = False

    ws_matrix["A1"] = "Competitor Score Matrix"
    ws_matrix["A1"].font = TITLE_FONT
    ws_matrix["A1"].fill = ACCENT_FILL
    ws_matrix["A1"].alignment = Alignment(horizontal="center", vertical="center")
    display_cols = ["competitor_id", "competitor_name", "division", "final_placement"] + judges
    display_df = df[display_cols].copy()
    total_matrix_cols = len(display_cols)
    ws_matrix.merge_cells(f"A1:{chr(64 + total_matrix_cols)}1")
    ws_matrix.row_dimensions[1].height = 30

    write_dataframe_to_sheet(ws_matrix, display_df, start_row=3)

    ws_matrix.column_dimensions["A"].width = 14
    ws_matrix.column_dimensions["B"].width = 22
    ws_matrix.column_dimensions["C"].width = 18
    ws_matrix.column_dimensions["D"].width = 16
    for i, _ in enumerate(judges):
        ws_matrix.column_dimensions[chr(69 + i)].width = 14

    # -------------------------------------------------------------------
    # Sheet 4: Correlations (Kendall's Tau)
    # -------------------------------------------------------------------
    ws_corr = wb.create_sheet("Correlations")
    ws_corr.sheet_view.showGridLines = False

    ws_corr["A1"] = "Kendall's Tau Correlation Matrix"
    ws_corr["A1"].font = TITLE_FONT
    ws_corr["A1"].fill = ACCENT_FILL
    ws_corr["A1"].alignment = Alignment(horizontal="center", vertical="center")
    num_corr_cols = len(judges) + 1
    ws_corr.merge_cells(f"A1:{chr(64 + num_corr_cols)}1")
    ws_corr.row_dimensions[1].height = 30

    # Header row
    ws_corr.cell(row=3, column=1, value="Judge")
    for col_idx, judge in enumerate(judges, start=2):
        ws_corr.cell(row=3, column=col_idx, value=judge)
    style_header_row(ws_corr, 3, num_corr_cols)

    # Data rows
    for row_offset, judge_row in enumerate(judges):
        r = 4 + row_offset
        ws_corr.cell(row=r, column=1, value=judge_row)
        for col_idx, judge_col in enumerate(judges, start=2):
            val = tau_matrix.loc[judge_row, judge_col]
            ws_corr.cell(row=r, column=col_idx, value=round(float(val), 4) if not math.isnan(float(val)) else "N/A")
        style_data_row(ws_corr, r, num_corr_cols, alt=(row_offset % 2 == 1))

        # Color-code diagonal
        diag_cell = ws_corr.cell(row=r, column=row_offset + 2)
        diag_cell.fill = ACCENT_FILL

    for col_letter in "ABCDEFGHIJ"[:num_corr_cols]:
        ws_corr.column_dimensions[col_letter].width = 16

    # -------------------------------------------------------------------
    # Sheet 5: Outliers
    # -------------------------------------------------------------------
    ws_out = wb.create_sheet("Outliers")
    ws_out.sheet_view.showGridLines = False

    ws_out["A1"] = "Z-Score Outlier Detection (|z| > 2.0)"
    ws_out["A1"].font = TITLE_FONT
    ws_out["A1"].fill = DANGER_FILL
    ws_out["A1"].alignment = Alignment(horizontal="center", vertical="center")
    num_out_cols = len(outliers.columns) if not outliers.empty else 7
    ws_out.merge_cells(f"A1:{chr(64 + num_out_cols)}1")
    ws_out.row_dimensions[1].height = 30

    if outliers.empty:
        ws_out.cell(row=3, column=1, value="No outliers detected.")
        ws_out.cell(row=3, column=1).font = WHITE_FONT
        ws_out.cell(row=3, column=1).fill = DARK_FILL
    else:
        write_dataframe_to_sheet(ws_out, outliers, start_row=3)
        # Color-code high/low outliers
        for row_offset in range(len(outliers)):
            r = 5 + row_offset
            direction = outliers.iloc[row_offset]["direction"]
            fill = DANGER_FILL if direction == "High" else WARNING_FILL
            for col in range(1, num_out_cols + 1):
                cell = ws_out.cell(row=r, column=col)
                cell.fill = fill

    for col_letter in "ABCDEFG"[:num_out_cols]:
        ws_out.column_dimensions[col_letter].width = 20

    # Set tab colors
    ws_summary.sheet_properties.tabColor = "4F46E5"
    ws_stats.sheet_properties.tabColor = "7C3AED"
    ws_matrix.sheet_properties.tabColor = "0EA5E9"
    ws_corr.sheet_properties.tabColor = "10B981"
    ws_out.sheet_properties.tabColor = "DC2626"

    wb.save(output_path)


# ---------------------------------------------------------------------------
# JSON Export
# ---------------------------------------------------------------------------

def export_json(
    summary: dict,
    judge_stats: pd.DataFrame,
    tau_matrix: pd.DataFrame,
    outliers: pd.DataFrame,
    output_path: str,
):
    def safe_val(v):
        if isinstance(v, float) and math.isnan(v):
            return None
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            return float(v)
        return v

    def df_to_list(df: pd.DataFrame) -> list:
        result = []
        for _, row in df.iterrows():
            result.append({k: safe_val(v) for k, v in row.items()})
        return result

    tau_dict = {}
    for j1 in tau_matrix.index:
        tau_dict[j1] = {}
        for j2 in tau_matrix.columns:
            val = tau_matrix.loc[j1, j2]
            tau_dict[j1][j2] = safe_val(val)

    output = {
        "summary": summary,
        "judge_stats": df_to_list(judge_stats),
        "kendall_tau_matrix": tau_dict,
        "outliers": df_to_list(outliers),
    }

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2, default=str)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def analyze(input_path: str, output_dir: str) -> dict:
    """
    Run full analysis. Returns the result dict (same as JSON output).
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    data = load_data(input_path)
    judges = extract_judge_names(data)
    df = build_score_matrix(data, judges)

    judge_stats = compute_judge_stats(df, judges)
    tau_matrix = compute_kendall_tau_matrix(df, judges)
    outliers = detect_outliers(df, judges)
    summary = build_summary(df, judges, judge_stats)

    excel_path = os.path.join(output_dir, "ocdl_judge_analytics.xlsx")
    json_path = os.path.join(output_dir, "ocdl_judge_analytics.json")

    export_excel(df, judges, judge_stats, tau_matrix, outliers, summary, excel_path)
    export_json(summary, judge_stats, tau_matrix, outliers, json_path)

    # Build return dict (mirrors JSON structure)
    def safe_val(v):
        if isinstance(v, float) and math.isnan(v):
            return None
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            return float(v)
        return v

    def df_to_list(df_: pd.DataFrame) -> list:
        result = []
        for _, row in df_.iterrows():
            result.append({k: safe_val(v) for k, v in row.items()})
        return result

    tau_dict = {}
    for j1 in tau_matrix.index:
        tau_dict[j1] = {}
        for j2 in tau_matrix.columns:
            val = tau_matrix.loc[j1, j2]
            tau_dict[j1][j2] = safe_val(val)

    return {
        "summary": summary,
        "judge_stats": df_to_list(judge_stats),
        "kendall_tau_matrix": tau_dict,
        "outliers": df_to_list(outliers),
        "excel_path": excel_path,
        "json_path": json_path,
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python analyze.py input.json output_dir/", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    out_dir = sys.argv[2]

    result = analyze(input_file, out_dir)
    # Print JSON to stdout for subprocess capture
    print(json.dumps(result, indent=2, default=str))
