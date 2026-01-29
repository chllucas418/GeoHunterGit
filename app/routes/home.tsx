import type { Route } from "./+types/home";
import { Link } from "react-router";
import type { Location } from "~/types/shared";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "GeoHunter - Discover New Locations" },
    { name: "description", content: "Identify hidden gems and prove your geographical skills." },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as any;
  const db = env.DB as D1Database;

  const { results } = await db.prepare("SELECT * FROM locations").all<any>();

  const locations = results.map(loc => ({
    ...loc,
    verifiedByGemini: !!loc.verified_by_gemini,
    difficultyRating: loc.difficulty_rating,
    qualityScore: loc.quality_score,
    imageUrl: loc.image_url,
  })) as Location[];

  return { locations };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { locations } = loaderData;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
      <header className="max-w-7xl mx-auto mb-12">
        <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
          GeoHunter Discovery
        </h1>
        <p className="text-slate-400 mt-2">Select a location and hunt for visual evidence.</p>
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
    </div>
  );
}
