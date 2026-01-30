import { getUserId, isDeveloper } from "~/lib/auth.server";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "GeoHunter - Discover New Locations" },
    { name: "description", content: "Identify hidden gems and prove your geographical skills." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as any;
  const db = env.DB as D1Database;
  const userId = await getUserId(request);
  const dev = await isDeveloper(request);

  const { results } = await db.prepare("SELECT * FROM locations").all<any>();

  const locations = results.map(loc => ({
    ...loc,
    verifiedByGemini: !!loc.verified_by_gemini,
    difficultyRating: loc.difficulty_rating,
    qualityScore: loc.quality_score,
    imageUrl: loc.image_url,
  })) as Location[];

  return { locations, isLoggedIn: !!userId, isDeveloper: dev };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { locations, isLoggedIn, isDeveloper } = loaderData;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
      <header className="max-w-7xl mx-auto mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
            GeoHunter Discovery
          </h1>
          <p className="text-slate-400 mt-2">Select a location and hunt for visual evidence.</p>
        </div>

        <nav className="flex items-center gap-4">
          {isLoggedIn ? (
            <>
              {isDeveloper && (
                <Link
                  to="/admin/add-location"
                  className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm font-medium hover:border-blue-500/50 transition-all text-blue-400"
                >
                  Developer Tool
                </Link>
              )}
              <Form method="post" action="/logout">
                <button
                  type="submit"
                  className="px-4 py-2 text-sm text-slate-500 hover:text-white transition-colors"
                >
                  Log Out
                </button>
              </Form>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Log In
              </Link>
              <Link
                to="/register"
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20"
              >
                Sign Up
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {locations.length === 0 ? (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-800 rounded-3xl">
            <p className="text-slate-500">No locations found. Add some to your collection!</p>
          </div>
        ) : (
          locations.map((loc) => (
            <Link
              key={loc.id}
              to={`/game/${loc.id}`}
              className="group relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 transition-all hover:scale-[1.02] hover:border-slate-700 hover:shadow-2xl active:scale-[0.98]"
            >
              <div className="aspect-video relative overflow-hidden">
                <img
                  src={loc.imageUrl}
                  alt="Location Mystery"
                  className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-700 blur-[2px] group-hover:blur-0"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />
                <div className="absolute bottom-4 left-4">
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1 bg-blue-600/50 backdrop-blur-md rounded-full text-xs font-bold uppercase tracking-wider border border-blue-400/30">
                      Difficulty: {loc.difficultyRating}/10
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <h2 className="text-xl font-bold group-hover:text-blue-400 transition-colors">
                  Mystery Location #{loc.id.slice(-4).toUpperCase()}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {loc.verifiedByGemini ? "✅ AI Verified" : "⏳ Pending Verification"}
                </p>
                <div className="mt-6 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Quality Score: {loc.qualityScore}%</span>
                  <span className="text-blue-400 font-bold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    Play Now →
                  </span>
                </div>
              </div>
            </Link>
          ))
        )}
      </main>

      <footer className="mt-12 text-center opacity-50 text-xs">
        <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
      </footer>
    </div>
  );
}
