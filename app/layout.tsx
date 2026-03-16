import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OCDL Judge Analytics",
  description:
    "Online Competitive Dance League — Advanced judge scoring analytics platform for bias detection, consistency analysis, and Kendall's tau correlation.",
  keywords: ["dance", "competition", "judge", "analytics", "OCDL", "scoring"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-900 text-gray-100 antialiased`}>
        {/* Navigation */}
        <nav className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                  OC
                </div>
                <div>
                  <span className="text-white font-bold text-lg tracking-tight">
                    OCDL
                  </span>
                  <span className="text-indigo-400 font-medium text-lg ml-1">
                    Analytics
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm text-gray-400">
                <a
                  href="/"
                  className="hover:text-white transition-colors font-medium"
                >
                  Home
                </a>
                <span className="text-gray-700">|</span>
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main>{children}</main>

        {/* Footer */}
        <footer className="border-t border-gray-800 mt-24 py-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-500 text-sm">
            <p className="mb-1">
              <span className="text-indigo-400 font-semibold">OCDL Judge Analytics</span>
              {" "}— Online Competitive Dance League Scoring Intelligence
            </p>
            <p>
              Built with Next.js 14, Python, Pandas, SciPy &amp; Recharts
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
