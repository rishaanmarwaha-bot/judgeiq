import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

// Increase the maximum duration for the route (Vercel: 60s, local: unlimited)
export const maxDuration = 60;

/**
 * POST /api/analyze
 * Accepts multipart form data with a JSON file field named "file".
 * Runs the Python analytics engine and returns:
 * - JSON analysis results
 * - Base64-encoded Excel workbook
 */
export async function POST(request: NextRequest) {
  let sessionDir: string | null = null;

  try {
    // ── Parse multipart form data ──────────────────────────────────────────
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

    // ── Validate file size (10 MB limit) ──────────────────────────────────
    if (blob.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size exceeds the 10 MB limit." },
        { status: 400 }
      );
    }

    // ── Write uploaded file to a temp directory ───────────────────────────
    const sessionId = randomUUID();
    sessionDir = join(tmpdir(), `ocdl-${sessionId}`);
    mkdirSync(sessionDir, { recursive: true });

    const inputPath = join(sessionDir, "input.json");
    const outputDir = join(sessionDir, "output");
    mkdirSync(outputDir, { recursive: true });

    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    writeFileSync(inputPath, fileBuffer);

    // ── Validate JSON ──────────────────────────────────────────────────────
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(fileBuffer.toString("utf-8"));
    } catch {
      return NextResponse.json(
        { error: "Uploaded file is not valid JSON. Please check the file and try again." },
        { status: 400 }
      );
    }

    if (!Array.isArray(parsedInput) || parsedInput.length === 0) {
      return NextResponse.json(
        { error: "JSON must be a non-empty array of competitor entries." },
        { status: 400 }
      );
    }

    // ── Locate the Python script ───────────────────────────────────────────
    // The script lives at <project_root>/analytics/analyze.py
    const projectRoot = process.cwd();
    const scriptPath = join(projectRoot, "analytics", "analyze.py");

    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { error: `Python script not found at: ${scriptPath}` },
        { status: 500 }
      );
    }

    // ── Run the Python script ─────────────────────────────────────────────
    let stdout: string;
    try {
      // Use venv Python if available, otherwise fall back to system python3/python
      const pythonCmd = (() => {
        const venvPython = path.join(projectRoot, "analytics/venv/bin/python3");
        try {
          execSync(`"${venvPython}" --version`, { stdio: "pipe" });
          return `"${venvPython}"`;
        } catch {
          try {
            execSync("python3 --version", { stdio: "pipe" });
            return "python3";
          } catch {
            try {
              execSync("python --version", { stdio: "pipe" });
              return "python";
            } catch {
              throw new Error("Python not found. Please install Python 3.8+.");
            }
          }
        }
      })();

      stdout = execSync(
        `${pythonCmd} "${scriptPath}" "${inputPath}" "${outputDir}"`,
        {
          encoding: "utf-8",
          timeout: 55_000, // 55 second timeout
          maxBuffer: 50 * 1024 * 1024, // 50 MB stdout buffer
          cwd: projectRoot,
          env: {
            ...process.env,
            PYTHONPATH: projectRoot,
          },
        }
      );
    } catch (execError: any) {
      const stderr = execError.stderr ?? "";
      const message = execError.message ?? "Unknown execution error";

      // Check for common Python dependency errors
      if (stderr.includes("ModuleNotFoundError") || stderr.includes("ImportError")) {
        const missing = stderr.match(/No module named '([^']+)'/)?.[1] ?? "unknown";
        return NextResponse.json(
          {
            error: `Missing Python dependency: '${missing}'. Run: pip install -r analytics/requirements.txt`,
            detail: stderr.slice(0, 800),
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          error: "Python analysis script failed.",
          detail: (stderr || message).slice(0, 1000),
        },
        { status: 500 }
      );
    }

    // ── Parse the JSON output from Python ─────────────────────────────────
    let analysisResult: Record<string, unknown>;
    try {
      // Python prints JSON to stdout — find the first '{' to strip any leading log lines
      const jsonStart = stdout.indexOf("{");
      if (jsonStart === -1) {
        throw new Error("No JSON found in Python output.");
      }
      analysisResult = JSON.parse(stdout.slice(jsonStart));
    } catch {
      return NextResponse.json(
        {
          error: "Failed to parse output from the analysis script.",
          detail: stdout.slice(0, 500),
        },
        { status: 500 }
      );
    }

    // ── Read the generated Excel file and base64-encode it ─────────────────
    const excelPath = join(outputDir, "ocdl_judge_analytics.xlsx");
    let excelBase64 = "";

    if (existsSync(excelPath)) {
      const excelBuffer = readFileSync(excelPath);
      excelBase64 = excelBuffer.toString("base64");
    }

    // ── Build response ─────────────────────────────────────────────────────
    const response = {
      summary: analysisResult.summary,
      judge_stats: analysisResult.judge_stats,
      kendall_tau_matrix: analysisResult.kendall_tau_matrix,
      outliers: analysisResult.outliers,
      excel_base64: excelBase64,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error("[OCDL Analyze API] Unexpected error:", err);
    return NextResponse.json(
      { error: err?.message ?? "An unexpected server error occurred." },
      { status: 500 }
    );
  } finally {
    // ── Cleanup temp directory ─────────────────────────────────────────────
    if (sessionDir && existsSync(sessionDir)) {
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; not critical
      }
    }
  }
}

/**
 * GET /api/analyze — health check
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "OCDL Judge Analytics API",
    version: "1.0.0",
    endpoints: {
      "POST /api/analyze": "Upload a JSON file (multipart/form-data, field: 'file') to run analysis",
    },
  });
}
