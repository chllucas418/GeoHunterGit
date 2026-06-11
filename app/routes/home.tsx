import { Suspense } from "react";
import type { Route } from "./+types/home";
import { Link, Form, Await, redirect } from "react-router";
import type { Location } from "~/types/shared";
import { getUserId, isDeveloper, getUserRole } from "~/lib/auth.server";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "GeoHunter - Expedition Command Center" },
    { name: "description", content: "Field operations headquarters for global exploration." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as any;
  const db = env.DB as D1Database;
  const userId = await getUserId(request);
  const dev = await isDeveloper(request);
  const role = await getUserRole(request);

  // Redirect students and teachers to their dashboards
  if (role === 'student' && userId) {
    throw redirect("/join");
  }

  if (role === 'teacher' && userId) {
    throw redirect("/teacher/dashboard");
  }

  // Get stats for dashboard
  const statsPromise = db.prepare(`
    SELECT
      COUNT(*) as totalLocations,
      SUM(CASE WHEN verified_by_gemini = 1 THEN 1 ELSE 0 END) as verifiedLocations,
      AVG(quality_score) as avgQuality
    FROM locations
  `).first<any>();

  // Get active rooms count
  const roomsPromise = db.prepare(`
    SELECT COUNT(*) as activeRooms FROM rooms WHERE status IN ('WAITING', 'PLAYING')
  `).first<any>();

  return {
    isLoggedIn: !!userId,
    isDeveloper: dev,
    role,
    statsPromise,
    roomsPromise,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { isLoggedIn, isDeveloper } = loaderData;

  return (
    <div className="min-h-screen relative">
      {/* Full-bleed topographic hero */}
      <div className="relative h-[85vh] flex flex-col justify-end px-6 md:px-12 pb-16 overflow-hidden">

        {/* Background layers */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a1210] via-[#0e1a14] to-[#0e1a14]" />

        {/* Large topographic watermark behind */}
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.04]">
          <svg viewBox="0 0 400 400" className="w-[80vw] max-w-[900px] h-auto">
            <circle cx="200" cy="200" r="30" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <circle cx="200" cy="200" r="60" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <circle cx="200" cy="200" r="90" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <circle cx="200" cy="200" r="120" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <circle cx="200" cy="200" r="150" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <circle cx="200" cy="200" r="180" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <path d="M20 200 Q110 120 200 200 Q290 280 380 200" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <path d="M20 140 Q110 60 200 140 Q290 220 380 140" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <path d="M20 260 Q110 180 200 260 Q290 340 380 260" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <path d="M20 80 Q110 0 200 80 Q290 160 380 80" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <path d="M20 320 Q110 240 200 320 Q290 400 380 320" fill="none" stroke="#c9a84c" strokeWidth="1"/>
            <line x1="200" y1="0" x2="200" y2="400" stroke="#c9a84c" strokeWidth="0.5"/>
            <line x1="0" y1="200" x2="400" y2="200" stroke="#c9a84c" strokeWidth="0.5"/>
            <line x1="0" y1="0" x2="400" y2="400" stroke="#c9a84c" strokeWidth="0.5"/>
            <line x1="400" y1="0" x2="0" y2="400" stroke="#c9a84c" strokeWidth="0.5"/>
          </svg>
        </div>

        {/* Corner decorations */}
        <div className="absolute top-6 left-6 md:top-8 md:left-12">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-teal animate-pulse" />
            <span className="text-[9px] font-mono text-teal uppercase tracking-[0.4em]">System Online</span>
          </div>
        </div>

        <div className="absolute top-6 right-6 md:top-8 md:right-12">
          <nav className="flex items-center gap-3">
            <Link to="/leaderboard" className="text-[9px] font-mono text-stone hover:text-cream uppercase tracking-widest transition-colors">
              Rankings
            </Link>
            {isLoggedIn ? (
              <>
                {isDeveloper && (
                  <div className="flex gap-2 ml-4 pl-4 border-l border-brass/20">
                    <Link to="/admin/add-location" className="text-[9px] font-mono text-brass/60 hover:text-brass uppercase tracking-widest transition-colors">Deploy</Link>
                    <Link to="/admin/locations" className="text-[9px] font-mono text-brass/60 hover:text-brass uppercase tracking-widest transition-colors">Manage</Link>
                    <Link to="/admin/datasets" className="text-[9px] font-mono text-brass/60 hover:text-brass uppercase tracking-widest transition-colors">Sets</Link>
                    <Link to="/admin/users" className="text-[9px] font-mono text-brass/60 hover:text-brass uppercase tracking-widest transition-colors">Agents</Link>
                  </div>
                )}
                <Form method="post" action="/logout">
                  <button type="submit" className="text-[9px] font-mono text-rust/60 hover:text-rust uppercase tracking-widest transition-colors ml-4 pl-4 border-l border-brass/20">
                    Disconnect
                  </button>
                </Form>
              </>
            ) : (
              <>
                <Link to="/login" className="text-[9px] font-mono text-stone hover:text-cream uppercase tracking-widest transition-colors">
                  Access
                </Link>
              </>
            )}
          </nav>
        </div>

        {/* Main content */}
        <div className="relative z-10 max-w-6xl mx-auto w-full">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-brass/40" />
              <span className="text-[9px] font-mono text-brass uppercase tracking-[0.4em]">Field Operations</span>
            </div>

            <h1 className="text-6xl md:text-7xl lg:text-8xl font-heading font-black text-cream leading-[0.9] tracking-tight mb-2">
              GeoHunter
            </h1>
            <p className="text-lg md:text-xl font-body text-stone-light tracking-wide max-w-xl ml-1">
              Expedition Command Center — Identify hidden targets across the globe.
            </p>
          </div>

          {/* Stats bar */}
          <Suspense fallback={<StatsBarSkeleton />}>
            <Await resolve={loaderData.statsPromise}>
              {(stats) => (
                <Await resolve={loaderData.roomsPromise}>
                  {(rooms) => (
                    <div className="flex items-end gap-8 md:gap-16 mb-8">
                      <div>
                        <div className="text-[9px] font-mono text-stone/50 uppercase tracking-[0.3em] mb-1">Active Rooms</div>
                        <div className="text-4xl md:text-5xl font-heading font-black text-teal">{rooms?.activeRooms || 0}</div>
                      </div>
                      <div className="h-10 w-px bg-brass/20" />
                      <div>
                        <div className="text-[9px] font-mono text-stone/50 uppercase tracking-[0.3em] mb-1">Targets Catalogued</div>
                        <div className="text-4xl md:text-5xl font-heading font-black text-brass">{stats?.totalLocations || 0}</div>
                      </div>
                      <div className="h-10 w-px bg-brass/20 hidden md:block" />
                      <div className="hidden md:block">
                        <div className="text-[9px] font-mono text-stone/50 uppercase tracking-[0.3em] mb-1">Quality Index</div>
                        <div className="text-4xl md:text-5xl font-heading font-black text-amber">{(stats?.avgQuality || 0).toFixed(0)}<span className="text-xl text-stone/40">%</span></div>
                      </div>
                    </div>
                  )}
                </Await>
              )}
            </Await>
          </Suspense>

          {/* Primary action buttons */}
          <div className="flex flex-col sm:flex-row gap-4">
            {isLoggedIn ? (
              <>
                <Link
                  to="/join"
                  className="group inline-flex items-center gap-3 px-8 py-4 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass font-mono text-sm font-bold uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Enter Operations
                </Link>
                <Link
                  to="/teacher/dashboard"
                  className="group inline-flex items-center gap-3 px-8 py-4 bg-teal/10 hover:bg-teal/20 border border-teal/30 text-teal font-mono text-sm font-bold uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Mission Control
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/join"
                  className="group inline-flex items-center gap-3 px-8 py-4 bg-brass/10 hover:bg-brass/20 border border-brass/30 text-brass font-mono text-sm font-bold uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Begin Expedition
                </Link>
                <Link
                  to="/register"
                  className="group inline-flex items-center gap-3 px-8 py-4 bg-[#1a1a18]/60 hover:bg-[#1a1a18] border border-brass/20 text-stone-light font-mono text-sm font-bold uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Register Agent
                </Link>
              </>
            )}
          </div>

          {/* Coordinate grid decoration */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brass/20 to-transparent" />
        </div>
      </div>

      {/* Second section: How it works */}
      <div className="relative px-6 md:px-12 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-12">
            <div className="h-px flex-1 bg-brass/10" />
            <span className="text-[9px] font-mono text-stone/40 uppercase tracking-[0.4em]">Protocol Overview</span>
            <div className="h-px flex-1 bg-brass/10" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="relative p-8 bg-[#0a1210]/50 border border-brass/10 rounded-sm">
              <div className="absolute -top-3 left-8 px-3 py-1 bg-[#0e1a14] border border-brass/20">
                <span className="text-[9px] font-mono text-brass uppercase tracking-widest">Phase 01</span>
              </div>
              <div className="mt-4">
                <div className="text-4xl mb-4">🎯</div>
                <h3 className="font-heading text-xl font-black text-cream mb-2">Locate Target</h3>
                <p className="text-sm text-stone-light leading-relaxed">
                  An image of a landmark is shown. Students analyze visual clues and pinpoint the location on the map.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative p-8 bg-[#0a1210]/50 border border-brass/10 rounded-sm">
              <div className="absolute -top-3 left-8 px-3 py-1 bg-[#0e1a14] border border-brass/20">
                <span className="text-[9px] font-mono text-brass uppercase tracking-widest">Phase 02</span>
              </div>
              <div className="mt-4">
                <div className="text-4xl mb-4">📡</div>
                <h3 className="font-heading text-xl font-black text-cream mb-2">Scan Intel</h3>
                <p className="text-sm text-stone-light leading-relaxed">
                  Draw bounding boxes on evidence areas. AI analysis validates observations and awards bonus points.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative p-8 bg-[#0a1210]/50 border border-brass/10 rounded-sm">
              <div className="absolute -top-3 left-8 px-3 py-1 bg-[#0e1a14] border border-brass/20">
                <span className="text-[9px] font-mono text-brass uppercase tracking-widest">Phase 03</span>
              </div>
              <div className="mt-4">
                <div className="text-4xl mb-4">⚡</div>
                <h3 className="font-heading text-xl font-black text-cream mb-2">Deploy Powers</h3>
                <p className="text-sm text-stone-light leading-relaxed">
                  Earn energy through accuracy. Use strategic abilities to sabotage opponents or protect your multiplier.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom divider */}
          <div className="mt-16 flex items-center gap-3">
            <div className="h-px flex-1 bg-brass/10" />
            <span className="text-[9px] font-mono text-stone/30 uppercase tracking-[0.4em]">Engineered by Lucas Cheung</span>
            <div className="h-px flex-1 bg-brass/10" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsBarSkeleton() {
  return (
    <div className="flex items-end gap-8 md:gap-16 mb-8">
      <div className="animate-pulse">
        <div className="h-3 w-20 bg-brass/10 rounded mb-1" />
        <div className="h-10 w-16 bg-brass/10 rounded" />
      </div>
      <div className="h-10 w-px bg-brass/20" />
      <div className="animate-pulse">
        <div className="h-3 w-20 bg-brass/10 rounded mb-1" />
        <div className="h-10 w-16 bg-brass/10 rounded" />
      </div>
    </div>
  );
}