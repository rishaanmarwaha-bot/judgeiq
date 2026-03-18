# JudgeIQ

**Intelligent judging analytics for competitive debate.**

Analyze judge scoring data from Tabroom tournament exports to surface bias, Z-severity scores, Mann-Whitney significance tests, rank-order agreement (Kendall's τ), and Z-score outliers. Outputs an interactive web dashboard and a per-division Excel workbook.

---

## Features

| Feature | Description |
|---|---|
| **Z-Severity Index** | How many std-devs a judge's mean is from the panel average |
| **Mann-Whitney U** | Statistical significance test: this judge vs all others |
| **Bias Direction** | High-Side / Low-Side classification |
| **Kendall's Tau** | Pairwise rank-order correlation between all judge pairs |
| **Z-Score Outliers** | Flags individual scores more than 2σ from a judge's distribution |
| **Excel Export** | Per-division sheets with severity color-coding |
| **Adaptive Parsing** | Auto-detects Tabroom single/multi-tournament or legacy array format |

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd judgeiq

# Install Python dependencies (in a virtual environment)
python3 -m venv analytics/venv
analytics/venv/bin/pip install -r analytics/requirements.txt

# Install Node.js dependencies
npm install
```

### 2. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Upload Data

Drop your Tabroom tournament JSON export onto the upload zone and click **Run Analysis**. Use `analytics/sample_data.json` to test immediately.

---

## Python CLI (Standalone)

```bash
analytics/venv/bin/python3 analytics/analyze.py analytics/sample_data.json ./output/
```

Generates:
- `output/judgeiq_analytics.xlsx` — per-division Excel workbook
- `output/judgeiq_analytics.json` — full JSON results

---

## Supported Input Formats

| Format | Description |
|---|---|
| **Tabroom single tournament** | `{ name, categories, judges, ... }` |
| **Tabroom multi-tournament** | Array of tournament objects |
| **Legacy array** | `[{ competitor_id, judge_scores, ... }]` |
| **Unknown** | Heuristic scan for numeric score values |

Tabroom exports may be UTF-8 or Latin-1 encoded — both are handled automatically.

---

## Excel Output

One sheet per division, each with these columns:

| Column | Description |
|---|---|
| Severity_Rank | 1 = most extreme judge |
| Judge_ID | Tabroom judge ID |
| Judge_Full_Name | First Last |
| Number_of_Scores | Ballot count |
| Mean | Average score (2 dp) |
| Z_Severity_Index | Signed z-score vs panel (4 dp) |
| Absolute_Severity | \|Z_Severity_Index\| (4 dp) |
| Bias_Direction | High-Side / Low-Side |
| Mann_Whitney_U | U statistic (1 dp) |
| p_value | Scientific notation e.g. 3.41E-04 |

Row colors: red `#FFD7D7` (>1.5), yellow `#FFFACD` (>1.0), white (≤1.0).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Charts | Recharts |
| Analytics Engine | Python 3.8+, Pandas, SciPy, NumPy, openpyxl |
| API | Next.js Route Handler → Python subprocess |

---

## Project Structure

```
judgeiq/
├── analytics/
│   ├── analyze.py          # Python analytics engine
│   ├── requirements.txt    # Python dependencies
│   └── sample_data.json    # Sample Tabroom tournament data
├── app/
│   ├── api/analyze/
│   │   └── route.ts        # API route (runs Python subprocess)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx            # Upload + dashboard page
├── package.json
└── next.config.js
```

---

## Requirements

- **Node.js** 18+
- **Python** 3.8+
- Python packages: `pandas`, `scipy`, `openpyxl`, `numpy`
