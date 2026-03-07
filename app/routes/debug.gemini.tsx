import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { batchAnalyzeOfficialEvidence } from "~/lib/gemini.server";

export async function loader({ context }: LoaderFunctionArgs) {
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    // Get a random location with evidence
    const location = await db.prepare("SELECT * FROM locations ORDER BY RANDOM() LIMIT 1").first<any>();

    let evidence = [];
    if (location) {
        const res = await db.prepare("SELECT * FROM map_evidence WHERE location_id = ?").bind(location.id).all<any>();
        evidence = res.results || [];
    }

    // Parse boxes
    evidence = evidence.map((e: any) => ({
        ...e,
        box: typeof e.box === 'string' ? JSON.parse(e.box) : e.box
    }));

    return Response.json({ location, evidence, bucketUrl: env.ASSETS_BUCKET_URL || "" });
}

export async function action({ request, context }: ActionFunctionArgs) {
    const formData = await request.formData();
    const env = context.cloudflare.env as any;

    const imageUrl = formData.get("imageUrl") as string;
    const itemsJson = formData.get("items") as string;
    const items = JSON.parse(itemsJson);

    const startTime = Date.now();
    let logs: string[] = [];
    let result = null;
    let error = null;

    logs.push(`[${new Date().toISOString()}] Starting Batch Analysis...`);
    logs.push(`Target Image: ${imageUrl}`);
    logs.push(`Items to Analyze: ${items.length}`);

    try {
        result = await batchAnalyzeOfficialEvidence(
            imageUrl,
            items,
            env.GEMINI_BASE_URL,
            env.GEMINI_GATEWAY_TOKEN,
            env.GEMINI_API_KEY
        );

        logs.push(`[${new Date().toISOString()}] Analysis Complete.`);
        logs.push(`Response Items: ${result.length}`);

    } catch (e: any) {
        error = e.message;
        logs.push(`[ERROR] ${e.message}`);
        console.error(e);
    }

    const duration = Date.now() - startTime;
    logs.push(`Duration: ${duration}ms`);

    return Response.json({ success: !error, result, logs, duration, error });
}

export default function DebugGemini() {
    const { location, evidence } = useLoaderData<typeof loader>() as any;
    const actionData = useActionData<typeof action>() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    const itemsPayload = evidence?.map((e: any) => ({
        id: e.id,
        box: e.box,
        description: e.description
    })) || [];

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-mono">
            <h1 className="text-3xl font-bold text-yellow-400 mb-6">🛠️ Gemini AI Debugger</h1>

            <div className="grid grid-cols-2 gap-8">
                {/* LEFT: Input & Context */}
                <div className="space-y-6">
                    <div className="bg-slate-900 p-6 rounded-xl border border-white/10">
                        <h2 className="text-xl font-bold text-white mb-4">Target Context</h2>
                        {location ? (
                            <>
                                <img src={location.image_url} alt="Target" className="w-full h-64 object-cover rounded-lg mb-4 border border-white/20" />
                                <div className="space-y-2 text-sm text-slate-400">
                                    <p><strong className="text-slate-200">Location ID:</strong> {location.id}</p>
                                    <p><strong className="text-slate-200">Evidence Count:</strong> {evidence?.length || 0}</p>
                                </div>
                                <div className="mt-4 space-y-2">
                                    {evidence?.map((e: any) => (
                                        <div key={e.id} className="bg-black/40 p-2 rounded text-xs border-l-2 border-yellow-500">
                                            <p className="font-bold text-yellow-500">{e.description}</p>
                                            <p className="text-slate-500 font-mono mt-1">{JSON.stringify(e.box)}</p>
                                            <p className="text-slate-400 mt-1 italic">{e.ai_analysis || "No analysis stored."}</p>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : <p className="text-red-400">No locations found in DB.</p>}
                    </div>

                    <Form method="post">
                        <input type="hidden" name="imageUrl" value={location?.image_url || ""} />
                        <input type="hidden" name="items" value={JSON.stringify(itemsPayload)} />

                        <button
                            type="submit"
                            disabled={isSubmitting || !location}
                            className={`w-full py-4 rounded-xl font-bold text-lg uppercase tracking-wider transition-all
                                ${isSubmitting
                                    ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20"
                                }
                            `}
                        >
                            {isSubmitting ? "Connecting to Neural Net..." : "Initiate Test Sequence"}
                        </button>
                    </Form>
                </div>

                {/* RIGHT: Output & Logs */}
                <div className="space-y-6">
                    {actionData ? (
                        <div className={`p-6 rounded-xl border ${actionData.success ? "bg-green-950/30 border-green-500/30" : "bg-red-950/30 border-red-500/30"}`}>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className={`text-xl font-bold ${actionData.success ? "text-green-400" : "text-red-400"}`}>
                                    {actionData.success ? "Analysis Successful" : "Analysis Failed"}
                                </h2>
                                <span className="text-sm px-2 py-1 bg-black/30 rounded text-slate-400">
                                    {actionData.duration}ms
                                </span>
                            </div>

                            {/* Logs Console */}
                            <div className="bg-black p-4 rounded-lg font-mono text-xs text-slate-300 mb-6 h-40 overflow-y-auto border border-white/10">
                                {actionData.logs?.map((log: string, i: number) => (
                                    <div key={i} className="mb-1 border-b border-white/5 pb-1 last:border-0">
                                        {log}
                                    </div>
                                ))}
                            </div>

                            {/* Result JSON */}
                            {actionData.result && (
                                <div>
                                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Gemini Response Payload</h3>
                                    <pre className="bg-slate-900 p-4 rounded-lg overflow-x-auto text-xs text-green-300 border border-white/10">
                                        {JSON.stringify(actionData.result, null, 2)}
                                    </pre>
                                </div>
                            )}

                            {actionData.error && (
                                <div className="bg-red-500/10 p-4 rounded-lg border border-red-500/20 text-red-200 text-sm">
                                    <strong>Error Details:</strong> {actionData.error}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl">
                            <p className="text-lg">Waiting for initiation...</p>
                            <p className="text-sm max-w-xs text-center mt-2 opacity-50">Click the button to perform a live API test against the configured Gemini Endpoint.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
