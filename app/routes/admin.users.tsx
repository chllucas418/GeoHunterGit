import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireDeveloper } from "~/lib/auth.server";
import { useLoaderData, useFetcher, Link } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
    await requireDeveloper(request);
    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    const { results: users } = await db.prepare("SELECT id, email, display_name, current_elo, total_games FROM users ORDER BY created_at DESC").all<any>();
    return { users };
}

export async function action({ request, context }: ActionFunctionArgs) {
    await requireDeveloper(request);
    const formData = await request.formData();
    const intent = formData.get("intent");
    const userId = formData.get("userId") as string;

    const env = context.cloudflare.env as any;
    const db = env.DB as D1Database;

    if (intent === "delete") {
        // Cascading deletes usually need manual cleanup in D1 unless FKs are set to CASCADE
        // For safety, let's delete sessions first if needed, though D1 FKs exist.
        await db.prepare("DELETE FROM game_sessions WHERE user_id = ?").bind(userId).run();
        await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
        return { success: true };
    }

    if (intent === "edit") {
        const displayName = formData.get("displayName") as string;
        const elo = parseInt(formData.get("elo") as string);
        await db.prepare("UPDATE users SET display_name = ?, current_elo = ? WHERE id = ?").bind(displayName, elo, userId).run();
        return { success: true };
    }

    return null;
}

export default function AdminUsers() {
    const { users } = useLoaderData() as any;
    const fetcher = useFetcher();

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex items-center justify-between">
                    <div>
                        <Link to="/" className="text-blue-400 hover:underline text-sm mb-2 inline-block">← Back</Link>
                        <h1 className="text-3xl font-black">Admin: User Management</h1>
                    </div>
                </header>

                <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                    <table className="w-full text-left">
                        <thead className="bg-slate-950/50 border-b border-slate-800 text-xs text-slate-500 uppercase font-bold">
                            <tr>
                                <th className="px-6 py-4">User</th>
                                <th className="px-6 py-4">Elo</th>
                                <th className="px-6 py-4">Games</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {users.map((user: any) => (
                                <tr key={user.id} className="hover:bg-slate-800/20 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-200">{user.display_name || "Anonymous"}</div>
                                        <div className="text-xs text-slate-500">{user.email}</div>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-indigo-400">{Math.round(user.current_elo)}</td>
                                    <td className="px-6 py-4 text-slate-400">{user.total_games}</td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button
                                            onClick={() => {
                                                const newName = prompt("New display name:", user.display_name);
                                                if (newName) {
                                                    const fd = new FormData();
                                                    fd.append("intent", "edit");
                                                    fd.append("userId", user.id);
                                                    fd.append("displayName", newName);
                                                    fd.append("elo", user.current_elo.toString());
                                                    fetcher.submit(fd, { method: "post" });
                                                }
                                            }}
                                            className="text-xs font-bold text-blue-400 hover:underline"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (confirm("Delete this user permanently?")) {
                                                    const fd = new FormData();
                                                    fd.append("intent", "delete");
                                                    fd.append("userId", user.id);
                                                    fetcher.submit(fd, { method: "post" });
                                                }
                                            }}
                                            className="text-xs font-bold text-red-400 hover:underline"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
