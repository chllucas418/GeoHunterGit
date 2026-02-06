import { Suspense } from "react";
import type { Route } from "./+types/home";
import { Link, Form, Await, redirect } from "react-router";
import type { Location } from "~/types/shared";
import { getUserId, isDeveloper, getUserRole } from "~/lib/auth.server";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "GeoHunter - Global Exploration Protocol" },
    { name: "description", content: "Identify hidden gems and prove your geographical skills." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as any;
  const db = env.DB as D1Database;
  const userId = await getUserId(request);
  const dev = await isDeveloper(request);

  // Defer the slow database query
  const locationsPromise = db.prepare(`
    SELECT id, difficulty_rating, quality_score, verified_by_gemini 
    FROM locations 
    ORDER BY created_at DESC
  `).all<any>()
    .then(({ results }) => results.map(loc => ({
      ...loc,
      verifiedByGemini: !!loc.verified_by_gemini,
      difficultyRating: loc.difficulty_rating,
      qualityScore: loc.quality_score,
      imageUrl: `/resources/image/${loc.id}`,
    })) as Location[]);

  // Role Check
  const role = await getUserRole(request);
  if (role === 'student' && userId) {
    // Students accessing base URL should go to Join screen
    throw redirect("/join");
  }

  return {
    locations: locationsPromise,
    isLoggedIn: !!userId,
    isDeveloper: dev,
    role
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { locations, isLoggedIn, isDeveloper } = loaderData;

  return (
    <div className="min-h-screen p-6 md:p-12 relative z-10">

      {/* --- Hero Header --- */}
      <header className="max-w-7xl mx-auto mb-16 relative">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 animate-float">
          <div className="space-y-2">
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-white/40 drop-shadow-2xl">
              GeoHunter
            </h1>
            <p className="text-lg md:text-xl text-blue-200/60 font-light tracking-wide max-w-lg glass-panel px-6 py-2 rounded-full inline-block">
              Global Exploration Protocol // Version 2.0
            </p>
          </div>

          <nav className="flex items-center gap-4 glass-panel p-2 rounded-2xl md:ml-auto transition-transform hover:scale-105 duration-500">
            <Link
              to="/leaderboard"
              className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-blue-100/80 hover:bg-white/10 rounded-xl transition-all"
            >
              Leaderboard
            </Link>

            {isLoggedIn ? (
              <>
                {!isDeveloper && (
                  <Link
                    to="/profile"
                    className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-indigo-300 hover:text-white hover:bg-indigo-500/20 rounded-xl transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)]"
                  >
                    My Data
                  </Link>
                )}

                {isDeveloper && (
                  <div className="flex gap-1 border-l border-white/10 pl-2 ml-2">
                    <Link to="/admin/add-location" className="w-10 h-10 flex items-center justify-center bg-blue-500/20 hover:bg-blue-500/40 rounded-lg text-blue-300 transition-colors" title="Deploy">+L</Link>
                    <Link to="/admin/create-teacher" className="w-10 h-10 flex items-center justify-center bg-yellow-500/20 hover:bg-yellow-500/40 rounded-lg text-yellow-300 transition-colors" title="Add Teacher">+T</Link>
                    <Link to="/admin/users" className="w-10 h-10 flex items-center justify-center bg-purple-500/20 hover:bg-purple-500/40 rounded-lg text-purple-300 transition-colors" title="Agents">A</Link>
                    <Link to="/admin/locations" className="w-10 h-10 flex items-center justify-center bg-emerald-500/20 hover:bg-emerald-500/40 rounded-lg text-emerald-300 transition-colors" title="Manage">M</Link>
                  </div>
                )}

                <Form method="post" action="/logout">
                  <button type="submit" className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-red-300/60 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all ml-2">
                    Abort
                  </button>
                </Form>
              </>
            ) : (
              <>
                <Link to="/login" className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-white/60 hover:text-white hover:bg-white/5 rounded-xl transition-all">
                  Login
                </Link>
                <Link to="/register" className="px-8 py-3 bg-white text-black text-xs font-black uppercase tracking-widest rounded-xl hover:bg-blue-50 hover:shadow-[0_0_20px_white] transition-all transform hover:-translate-y-1">
                  Initialize
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* --- Main Grid with Suspense --- */}
      <main className="max-w-8xl mx-auto">
        <Suspense fallback={<GridSkeleton />}>
          <Await resolve={locations}>
            {(resolvedLocations) => (
              resolvedLocations.length === 0 ? (
                <div className="glass-panel p-20 rounded-[3rem] text-center border-dashed border-white/10 ml-1">
                  <p className="text-2xl text-white/20 font-light">No signals detected. Deploy new locations to begin hunting.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                  {resolvedLocations.map((loc) => (
                    <Link
                      key={loc.id}
                      to={`/game/${loc.id}`}
                      className="group glass-card relative rounded-[2.5rem] overflow-hidden h-[400px] flex flex-col justify-end"
                    >
                      {/* Background Image Layer */}
                      <div className="absolute inset-0 z-0">
                        <img
                          src={loc.imageUrl}
                          alt="Mystery"
                          className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110 group-hover:contrast-110"
                          loading="lazy"
                        />
                        {/* Frosted Gradient Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-80 group-hover:opacity-60 transition-opacity duration-500" />
                      </div>

                      {/* Floating Stats Badge */}
                      <div className="absolute top-6 right-6 z-20 flex flex-col gap-2 items-end">
                        <div className={`px-4 py-2 backdrop-blur-md rounded-2xl text-[10px] font-black uppercase tracking-widest border border-white/10 shadow-lg ${loc.difficultyRating > 7 ? 'bg-red-500/20 text-red-200' :
                          loc.difficultyRating > 4 ? 'bg-yellow-500/20 text-yellow-200' : 'bg-emerald-500/20 text-emerald-200'
                          }`}>
                          DR-{loc.difficultyRating.toFixed(2)}
                        </div>
                      </div>

                      {/* Content Content */}
                      <div className="relative z-10 p-8 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-500">
                        <div className="flex items-center gap-3 mb-3 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                          <div className="h-[1px] w-8 bg-blue-400/50" />
                          <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-blue-200">
                            {loc.verifiedByGemini ? "AI Verified" : "Unverified"}
                          </span>
                        </div>

                        <h2 className="text-4xl font-black text-white leading-none mb-2 tracking-tight group-hover:text-glow transition-all">
                          SECTOR {loc.id.slice(-4).toUpperCase()}
                        </h2>

                        <div className="flex items-center justify-between border-t border-white/10 pt-4 mt-4">
                          <div className="flex flex-col">
                            <span className="text-[9px] uppercase tracking-widest text-white/40 font-bold">Signal Quality</span>
                            <span className="text-lg font-mono text-white/80">{loc.qualityScore}%</span>
                          </div>

                          <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center bg-white/5 group-hover:bg-white group-hover:text-black transition-all duration-300">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )
            )}
          </Await>
        </Suspense>
      </main>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="glass-panel rounded-[2.5rem] h-[400px] animate-pulse relative overflow-hidden bg-white/5 mx-auto w-full">
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent skew-x-12 animate-aurora-1" />
          <div className="absolute bottom-6 left-6 right-6">
            <div className="h-4 bg-white/10 rounded-full w-2/3 mb-4" />
            <div className="h-10 bg-white/10 rounded-2xl w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
