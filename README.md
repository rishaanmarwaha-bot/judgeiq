# OCDL Judge Analytics

**Online Competitive Dance League — Judge Scoring Analytics Platform**

Analyze judge scoring data from dance competitions to surface bias, consistency, rank-order agreement (Kendall's τ), and Z-score outliers. Outputs an interactive web dashboard and a polished multi-sheet Excel workbook.

---

## Features

| Feature | Description |
|---|---|
| **Bias Detection** | Compares each judge's mean score to the panel average |
| **Consistency Scoring** | Inverse coefficient of variation — 100 = perfectly consistent |
| **Kendall's Tau** | Pairwise rank-order correlation between all judge pairs |
| **Z-Score Outliers** | Flags individual scores more than 2σ from a judge's distribution |
| **Spearman ρ** | Correlation between each judge's scores and final placements |
| **Excel Export** | 5-sheet workbook: Summary, Judge Stats, Score Matrix, Correlations, Outliers |
| **JSON Export** | Full results as structured JSON |

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd ocdl-judge-analytics

# Install Python dependencies
pip install -r analytics/requirements.txt

# Install Node.js dependencies
npm install
```

### 2. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Upload Data

Drop your competition JSON file onto the upload zone and click **Run Analysis**. Use `analytics/sample_data.json` to test immediately.

---

## Python CLI (Standalone)

You can run the analytics engine directly without the web interface:

```bash
cd ocdl-judge-analytics
python analytics/analyze.py analytics/sample_data.json ./output/
```

This generates:
- `output/ocdl_judge_analytics.xlsx` — Excel workbook
- `output/ocdl_judge_analytics.json` — JSON summary

---

## Input JSON Format

The input must be a JSON **array** of competitor entries:

```json
[
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
  }
]
```

### Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `competitor_id` | string | Yes | Unique identifier |
| `competitor_name` | string | Yes | Display name |
| `division` | string | Yes | Competition division |
| `judge_scores` | object | Yes | Judge name → numeric score |
| `final_placement` | integer | Yes | Final placement (1 = winner) |

- You can have any number of judges — their names become column headers automatically.
- Multiple divisions in the same file are supported.

---

## Excel Workbook Sheets

| Sheet | Contents |
|---|---|
| **Summary** | High-level stats: competitor count, divisions, highlight judges |
| **Judge Stats** | Mean, std dev, bias, consistency, Spearman ρ per judge |
| **Score Matrix** | Full competitor × judge score table |
| **Correlations** | Kendall's τ pairwise matrix (color-coded by strength) |
| **Outliers** | Z-score flagged entries (red = high, orange = low) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Charts | Recharts |
| Analytics Engine | Python 3.8+, Pandas, SciPy, NumPy, openpyxl |
| API | Next.js Route Handler (Node.js child_process → Python subprocess) |

---

## Project Structure

```
ocdl-judge-analytics/
├── analytics/
│   ├── analyze.py          # Python analytics engine
│   ├── requirements.txt    # Python dependencies
│   └── sample_data.json    # Sample competition data (10 competitors, 3 judges)
├── app/
│   ├── api/
│   │   └── analyze/
│   │       └── route.ts    # API route (runs Python subprocess)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx            # Main upload + dashboard page
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── postcss.config.js
```

---

## API Reference

### `POST /api/analyze`

Accepts `multipart/form-data` with a single field `file` containing the JSON file.

**Response:**
```json
{
  "summary": { ... },
  "judge_stats": [ ... ],
  "kendall_tau_matrix": { ... },
  "outliers": [ ... ],
  "excel_base64": "<base64-encoded .xlsx>"
}
```

### `GET /api/analyze`

Health check — returns service info.

---

## Python Analytics Methods

### Per-Judge Statistics

- **Mean** — arithmetic mean of all scores
- **Std Dev** — sample standard deviation (ddof=1)
- **Bias** — judge mean minus panel average mean
- **Consistency** — `100 - (std_dev / |mean|) * 100`, capped 0–100
- **Spearman ρ** — rank correlation with `final_placement`

### Kendall's Tau

Computed for every judge pair using `scipy.stats.kendalltau`. Measures the proportion of concordant minus discordant rank pairs.

### Z-Score Outlier Detection

For each judge column:
```
z = (score - judge_mean) / judge_std
```
Entries with `|z| > 2.0` are flagged.

---

## Requirements

- **Node.js** 18+
- **Python** 3.8+
- Python packages: `pandas`, `scipy`, `openpyxl`, `numpy`

```bash
pip install -r analytics/requirements.txt
npm install
```
